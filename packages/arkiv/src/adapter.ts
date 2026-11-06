import {
  type AnchorAdapter,
  AnchorEntityKeySchema,
  AnchorError,
  type AnchorErrorCode,
  AnchorPayloadSchema,
} from "@trustora/shared";
import { type ArkivClients, type ArkivConnectOptions, connectArkiv } from "./arkivClients.js";
import { loadArkivConfig } from "./config.js";

const MAX_RETRIES = 2;
const BACKOFF_MS = [500, 1_500];
/** A read must fit inside ProofTrack's 8 second limit on a whole check. */
const READ_TIMEOUT_MS = 3_000;
/** A write waits for its transaction to land in a block. */
const WRITE_TIMEOUT_MS = 60_000;
const NETWORK_NAME = "Arkiv Rabdi testnet";
const SECONDS_PER_DAY = 86_400;

const chainOf = (error: unknown): Record<string, unknown>[] => {
  const links: Record<string, unknown>[] = [];
  let current = error;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth += 1) {
    links.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return links;
};

/**
 * Keeps a code and drops everything else. SDK errors can carry the RPC URL, and the
 * URL holds the access key, so no message, cause or stack from them is ever kept.
 * Arkiv's docs do not document rate-limit errors, so this also goes by HTTP status,
 * the standard JSON-RPC limit code and the wording of the message.
 */
export const toAnchorError = (error: unknown): AnchorError => {
  if (error instanceof AnchorError) return error;
  const links = chainOf(error);
  const text = links.map((link) => `${String(link.name)} ${String(link.message)}`).join(" ");
  const has = (key: string, values: unknown[]) => links.some((link) => values.includes(link[key]));

  let code: AnchorErrorCode = "UNAVAILABLE";
  if (has("status", [429]) || has("code", [-32005, 429]) || /rate.?limit|too many requests/i.test(text)) {
    code = "RATE_LIMITED";
  } else if (has("status", [401, 403]) || /unauthori[sz]ed|forbidden|quota/i.test(text)) {
    code = "UNAUTHORIZED";
  } else if (/insufficient funds|exceeds the balance|no tglm/i.test(text)) {
    code = "INSUFFICIENT_FUNDS";
  } else if (/timeout|timed out/i.test(text)) {
    code = "TIMEOUT";
  }
  return new AnchorError(code);
};

export interface ArkivAnchorAdapterOptions {
  connection: ArkivConnectOptions;
  anchorAddress: string;
  entityDays: number;
  /** For tests. */
  connect?: (options: ArkivConnectOptions) => Promise<ArkivClients>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  writeTimeoutMs?: number;
  readTimeoutMs?: number;
}

export const createArkivAnchorAdapter = (options: ArkivAnchorAdapterOptions): AnchorAdapter => {
  const { connection, anchorAddress, entityDays } = options;
  const connect = options.connect ?? connectArkiv;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = options.now ?? (() => new Date());
  const writeTimeoutMs = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
  const readTimeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;

  let clients: Promise<ArkivClients> | undefined;
  const getClients = () => {
    clients ??= connect(connection).catch((error: unknown) => {
      clients = undefined;
      throw error;
    });
    return clients;
  };

  const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AnchorError("TIMEOUT")), timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** Retries rate limits only: a write that timed out may still land. */
  const run = async <T>(task: () => Promise<T>, timeoutMs: number): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withTimeout(task(), timeoutMs);
      } catch (error) {
        const failure = toAnchorError(error);
        if (failure.code !== "RATE_LIMITED" || attempt >= MAX_RETRIES) throw failure;
        await sleep(BACKOFF_MS[attempt] ?? 1_500);
      }
    }
  };

  /** Arkiv expires by block, so a date is an estimate from the current block timing. */
  const estimateExpiry = async (expiresAtBlock: bigint): Promise<string | null> => {
    try {
      const api = await getClients();
      const { currentBlock, currentBlockTime, blockDuration } = await run(() => api.timing(), readTimeoutMs);
      const seconds = currentBlockTime + Number(expiresAtBlock - currentBlock) * blockDuration;
      return new Date(seconds * 1000).toISOString();
    } catch {
      return null;
    }
  };

  return {
    anchorAddress,
    network: NETWORK_NAME,

    async publishAnchor(payload) {
      const parsed = AnchorPayloadSchema.safeParse(payload);
      if (!parsed.success) throw new AnchorError("INVALID_PAYLOAD");
      const api = await run(getClients, writeTimeoutMs);
      const { entityKey, expiresAtBlock } = await run(() => api.create(parsed.data, entityDays), writeTimeoutMs);
      const key = AnchorEntityKeySchema.safeParse(entityKey);
      if (!key.success) throw new AnchorError("UNAVAILABLE");
      const estimated = await estimateExpiry(expiresAtBlock);
      const fallback = new Date(now().getTime() + entityDays * SECONDS_PER_DAY * 1000).toISOString();
      return { entityKey: key.data, expiresAt: estimated ?? fallback };
    },

    async readAnchor(entityKey) {
      const key = AnchorEntityKeySchema.safeParse(entityKey);
      if (!key.success) throw new AnchorError("INVALID_KEY");
      const api = await run(getClients, readTimeoutMs);
      const row = await run(() => api.read(key.data), readTimeoutMs);
      // Arkiv reports an expired entity exactly like one that never existed.
      if (!row) return { status: "not_found" };
      const payload = AnchorPayloadSchema.safeParse(row.columns);
      if (!payload.success) throw new AnchorError("INVALID_ENTITY");
      return {
        status: "found",
        ownerAddress: row.ownerAddress.toLowerCase(),
        payload: payload.data,
        expiresAt: await estimateExpiry(row.expiresAtBlock),
      };
    },
  };
};

/** Returns undefined when Arkiv is disabled or not fully configured. */
export const createArkivAdapterFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): AnchorAdapter | undefined => {
  const config = loadArkivConfig(env);
  if (config.status !== "ready") return undefined;
  return createArkivAnchorAdapter({
    connection: {
      accessKey: config.accessKey,
      privateKey: config.privateKey,
      requestTimeoutMs: READ_TIMEOUT_MS,
    },
    anchorAddress: config.anchorAddress,
    entityDays: config.entityDays,
  });
};
