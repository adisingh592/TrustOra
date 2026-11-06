import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredEvent } from "@trustora/prooftrack";
import {
  AnchorError,
  type AnchorErrorCode,
  type AnchorPayload,
  AnchorPayloadSchema,
} from "@trustora/shared";
import { describe, expect, it, vi } from "vitest";
import { createArkivAdapterFromEnv, createArkivAnchorAdapter, toAnchorError } from "./adapter.js";
import type { ArkivClients } from "./arkivClients.js";
import { loadArkivConfig, MAX_ARKIV_LIFETIME_DAYS } from "./config.js";
import { canonicalJson, computeEventDigest } from "./digest.js";
import { MOCK_AnchorAdapter } from "./mocks.js";
import { buildAnchorPayload, digestOfStoredEvent } from "./payload.js";
import { ANCHOR_UNREADABLE_REASON, createArkivAnchorVerifier } from "./verifier.js";

// All values are fake and built at run time. Nothing here uses the network.
const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PRIVATE_KEY = `0x${"7".repeat(64)}` as const; // secret-scan:allow
const FAKE_ACCESS_KEY = "FIXTURE_ACCESS_KEY_VALUE";
const ANCHOR_ADDRESS = `0x${"a".repeat(40)}`;
const ENTITY_KEY = `0x${"e".repeat(64)}`;
const PROJECT = "TRU-PROJ-2026-0000001";

const source = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "source-event",
  publicProjectId: PROJECT,
  milestoneId: "private-milestone-id",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:01.000Z"),
  ecosystem: "ARC",
  network: "Arc Testnet",
  chainId: 5042002,
  eventType: "MILESTONE_FUNDED",
  referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
  referenceValue: `0x${"b".repeat(64)}`,
  verificationStatus: "VERIFIED",
  statusReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  summary: "Funding transaction for this milestone.",
  expected: { amountBaseUnits: "50000000", agreementHash: "c".repeat(64) },
  ...over,
});

const anchorEvent = (over: Partial<StoredEvent> = {}): StoredEvent =>
  source({
    id: "anchor-event",
    ecosystem: "ARKIV",
    eventType: "EVIDENCE_ANCHORED",
    referenceType: "STORAGE_REFERENCE",
    referenceValue: ENTITY_KEY,
    verificationStatus: "PENDING",
    expected: { sourceEventId: "source-event" },
    ...over,
  });

describe("computeEventDigest", () => {
  const input = {
    projectId: PROJECT,
    type: "MILESTONE_FUNDED",
    ecosystem: "ARC",
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    reference: `0x${"b".repeat(64)}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  it("is lowercase SHA-256 hex and stable across calls", () => {
    expect(computeEventDigest(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventDigest(input)).toBe(computeEventDigest({ ...input }));
  });

  it("does not depend on key order", () => {
    const reversed = Object.fromEntries(Object.entries(input).reverse()) as typeof input;
    expect(computeEventDigest(reversed)).toBe(computeEventDigest(input));
  });

  it.each(Object.keys(input) as (keyof typeof input)[])("changes when %s changes", (field) => {
    expect(computeEventDigest({ ...input, [field]: `${input[field]}x` })).not.toBe(computeEventDigest(input));
  });

  it("ignores any other field", () => {
    const extra = { ...input, title: "private", privateFilePath: "/x" };
    expect(computeEventDigest(extra)).toBe(computeEventDigest(input));
  });

  it("canonical JSON sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [{ f: 1, e: 2 }] } })).toBe('{"a":{"c":[{"e":2,"f":1}],"d":1},"b":1}');
  });
});

describe("buildAnchorPayload (R1)", () => {
  const ALLOWED = ["eventDigest", "eventType", "network", "occurredAt", "projectId", "reference"];

  it("has exactly the allowed keys", () => {
    const { subjectDigest, ...rest } = buildAnchorPayload(source());
    expect(Object.keys(rest).sort()).toEqual(ALLOWED);
    expect(subjectDigest).toBe("c".repeat(64));
  });

  it("leaves subjectDigest out when there is nothing to hash", () => {
    expect(Object.keys(buildAnchorPayload(source({ expected: {} }))).sort()).toEqual(ALLOWED);
  });

  it("uses the deliverable hash when there is no agreement hash, without 0x", () => {
    const payload = buildAnchorPayload(source({ expected: { deliverableSha256: `0x${"D".repeat(64)}` } }));
    expect(payload.subjectDigest).toBe("d".repeat(64));
  });

  it("carries nothing private from the event", () => {
    const text = JSON.stringify(
      buildAnchorPayload(
        source({
          summary: "SECRET_SUMMARY",
          expected: {
            amountBaseUnits: "987654321",
            freelancerWallet: `0x${"f".repeat(40)}`,
            clientWallet: `0x${"1".repeat(40)}`,
            sourceEventId: "SECRET_ID",
          },
        }),
      ),
    );
    for (const forbidden of ["SECRET_SUMMARY", "987654321", "f".repeat(40), "1".repeat(40), "SECRET_ID", "private-milestone-id"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it.each(["fileName", "privateFilePath", "criteria", "title", "description", "wallet", "amount"])(
    "the schema refuses a payload with %s",
    (field) => {
      const payload = { ...buildAnchorPayload(source()), [field]: "x" };
      expect(AnchorPayloadSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("refuses a reference too long for Arkiv's 128-byte strings", () => {
    const long = source({ referenceValue: "x".repeat(129) });
    expect(() => buildAnchorPayload(long)).toThrow(AnchorError);
  });

  it("the schema columns written to Arkiv are exactly the payload's fields", () => {
    const code = readFileSync(join(here, "arkivClients.ts"), "utf8");
    const block = /defineSchema\(ANCHOR_SCHEMA_NAME, \{([\s\S]*?)\}\);/.exec(code)![1]!;
    const columns = [...block.matchAll(/^\s*(\w+): schema\./gm)].map((m) => m[1]);
    expect(columns.sort()).toEqual(Object.keys(AnchorPayloadSchema.shape).sort());
    expect(code).toContain('ANCHOR_SCHEMA_NAME = "trustora.proofanchor.v1"');
  });
});

describe("the Arkiv verifier", () => {
  const setup = async (over: { owner?: string; tamper?: Partial<AnchorPayload>; event?: Partial<StoredEvent> } = {}) => {
    const adapter = new MOCK_AnchorAdapter(ANCHOR_ADDRESS);
    const stored = source(over.event);
    const { entityKey } = await adapter.publishAnchor(buildAnchorPayload(source()));
    if (over.owner) adapter.setOwner(entityKey, over.owner);
    if (over.tamper) adapter.tamper(entityKey, over.tamper);
    const verifier = createArkivAnchorVerifier({ adapter, getEvent: async (id) => (id === stored.id ? stored : null) });
    return { adapter, entityKey, verify: () => verifier(anchorEvent({ referenceValue: entityKey })) };
  };

  it("MATCH when owner, digest and project all agree", async () => {
    expect((await (await setup()).verify()).outcome).toBe("MATCH");
  });

  it("MATCH when the owner differs only by case (Arkiv returns mixed case)", async () => {
    const { verify } = await setup({ owner: ANCHOR_ADDRESS.toUpperCase().replace("0X", "0x") });
    expect((await verify()).outcome).toBe("MATCH");
  });

  it("MISMATCH: wrong owner, even with perfect content (R2)", async () => {
    const result = await (await setup({ owner: `0x${"9".repeat(40)}` })).verify();
    expect(result.outcome).toBe("MISMATCH");
    expect(result.reason).toMatch(/not written by our anchor address/);
  });

  it("MISMATCH: wrong digest", async () => {
    const result = await (await setup({ tamper: { eventDigest: "0".repeat(64) } })).verify();
    expect(result.outcome).toBe("MISMATCH");
    expect(result.reason).toMatch(/digest/);
  });

  it("MISMATCH: wrong project", async () => {
    const result = await (await setup({ tamper: { projectId: "TRU-PROJ-2026-0000002" } })).verify();
    expect(result.outcome).toBe("MISMATCH");
    expect(result.reason).toMatch(/different project/);
  });

  it.each<[string, Partial<StoredEvent>]>([
    ["reference", { referenceValue: `0x${"9".repeat(64)}` }],
    ["occurredAt", { occurredAt: new Date("2026-06-01T00:00:00.000Z") }],
    ["event type", { eventType: "PAYMENT_RELEASED" }],
  ])("MISMATCH: our own event's %s no longer matches the anchor", async (_label, event) => {
    expect((await (await setup({ event })).verify()).outcome).toBe("MISMATCH");
  });

  it("MISMATCH: the source event is in another project", async () => {
    const result = await (await setup({ event: { publicProjectId: "TRU-PROJ-2026-0000002" } })).verify();
    expect(result.outcome).toBe("MISMATCH");
  });

  it("MISMATCH: the entity does not fit our schema", async () => {
    const { adapter, verify } = await setup();
    adapter.readFailure = "INVALID_ENTITY";
    expect((await verify()).outcome).toBe("MISMATCH");
  });

  it.each<[string, (a: MOCK_AnchorAdapter, key: string) => void]>([
    ["not found", (a, key) => a.remove(key)],
    ["expired", (a, key) => a.expire(key)],
    ["rate limited", (a) => { a.readFailure = "RATE_LIMITED"; }],
    ["timed out", (a) => { a.readFailure = "TIMEOUT"; }],
    ["unavailable", (a) => { a.readFailure = "UNAVAILABLE"; }],
    ["an unexpected error", (a) => { a.readFailure = new Error("connect failed: /srv/secret-path"); }],
  ])("UNAVAILABLE, never VERIFIED or FAILED: %s", async (_label, breakIt) => {
    const { adapter, entityKey, verify } = await setup();
    breakIt(adapter, entityKey);
    const result = await verify();
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(result.reason).toBe(ANCHOR_UNREADABLE_REASON);
  });

  it("UNAVAILABLE with no adapter", async () => {
    const verifier = createArkivAnchorVerifier({ adapter: undefined, getEvent: async () => source() });
    expect((await verifier(anchorEvent())).outcome).toBe("UNAVAILABLE");
  });

  it("UNAVAILABLE when the source event cannot be found or is not named", async () => {
    const adapter = new MOCK_AnchorAdapter(ANCHOR_ADDRESS);
    const missing = createArkivAnchorVerifier({ adapter, getEvent: async () => null });
    expect((await missing(anchorEvent())).outcome).toBe("UNAVAILABLE");
    const present = createArkivAnchorVerifier({ adapter, getEvent: async () => source() });
    expect((await present(anchorEvent({ expected: {} }))).outcome).toBe("UNAVAILABLE");
  });
});

describe("loadArkivConfig", () => {
  const ready = { ARKIV_ENABLED: "true", ARKIV_ACCESS_KEY: FAKE_ACCESS_KEY, ARKIV_PRIVATE_KEY: FAKE_PRIVATE_KEY };

  it.each([[{}], [{ ARKIV_ENABLED: "" }], [{ ARKIV_ENABLED: "false" }], [{ ARKIV_ENABLED: "1" }], [{ ...ready, ARKIV_ENABLED: "TRUE" }]])(
    "is disabled unless ARKIV_ENABLED is exactly true: %j",
    (env) => {
      expect(loadArkivConfig(env)).toEqual({ status: "disabled" });
      expect(createArkivAdapterFromEnv(env)).toBeUndefined();
    },
  );

  it.each<[string, object, string]>([
    ["no access key", { ARKIV_ACCESS_KEY: "" }, "MISSING_ACCESS_KEY"],
    ["no private key", { ARKIV_PRIVATE_KEY: "" }, "INVALID_PRIVATE_KEY"],
    ["short private key", { ARKIV_PRIVATE_KEY: "0x1234" }, "INVALID_PRIVATE_KEY"],
    ["non-hex private key", { ARKIV_PRIVATE_KEY: `0x${"z".repeat(64)}` }, "INVALID_PRIVATE_KEY"],
    ["0 days", { ARKIV_ENTITY_DAYS: "0" }, "INVALID_ENTITY_DAYS"],
    ["366 days", { ARKIV_ENTITY_DAYS: "366" }, "INVALID_ENTITY_DAYS"],
    ["fractional days", { ARKIV_ENTITY_DAYS: "1.5" }, "INVALID_ENTITY_DAYS"],
    ["text days", { ARKIV_ENTITY_DAYS: "soon" }, "INVALID_ENTITY_DAYS"],
  ])("is not configured with %s, and names no value", (_label, change, reason) => {
    const env = { ...ready, ...change };
    expect(loadArkivConfig(env)).toEqual({ status: "not_configured", reason });
    expect(createArkivAdapterFromEnv(env)).toBeUndefined();
  });

  it("defaults to 30 days and accepts the bounds, capping at Arkiv's real maximum", () => {
    const days = (value?: string) => {
      const config = loadArkivConfig({ ...ready, ...(value ? { ARKIV_ENTITY_DAYS: value } : {}) });
      return config.status === "ready" ? config.entityDays : null;
    };
    expect(days()).toBe(30);
    expect(days("1")).toBe(1);
    expect(days("182")).toBe(182);
    expect(days("183")).toBe(MAX_ARKIV_LIFETIME_DAYS);
    expect(days("365")).toBe(MAX_ARKIV_LIFETIME_DAYS);
  });

  it("derives a lowercase anchor address, and the adapter does not expose the key", () => {
    const adapter = createArkivAdapterFromEnv(ready)!;
    expect(adapter.anchorAddress).toMatch(/^0x[0-9a-f]{40}$/);
    const shown = JSON.stringify(adapter);
    expect(shown).not.toContain(FAKE_PRIVATE_KEY);
    expect(shown).not.toContain(FAKE_ACCESS_KEY);
  });
});

describe("the adapter over the SDK", () => {
  const payload: AnchorPayload = {
    projectId: PROJECT,
    eventType: "MILESTONE_FUNDED",
    eventDigest: "a".repeat(64),
    network: "Arc Testnet",
    reference: `0x${"b".repeat(64)}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  const fakeClients = (over: Partial<ArkivClients> = {}): ArkivClients => ({
    create: vi.fn(async () => ({ entityKey: `0x${"A".repeat(64)}`, expiresAtBlock: 1_000n })),
    read: vi.fn(async () => ({
      ownerAddress: `0x${"AB".repeat(20)}`,
      expiresAtBlock: 1_000n,
      columns: { ...payload },
    })),
    timing: vi.fn(async () => ({ currentBlock: 500n, currentBlockTime: 1_000_000, blockDuration: 2 })),
    ...over,
  });

  const adapterWith = (clients: ArkivClients, over: object = {}) => {
    const sleep = vi.fn(async () => undefined);
    const connect = vi.fn(async () => clients);
    const adapter = createArkivAnchorAdapter({
      connection: { accessKey: FAKE_ACCESS_KEY, privateKey: FAKE_PRIVATE_KEY, requestTimeoutMs: 1000 },
      anchorAddress: ANCHOR_ADDRESS,
      entityDays: 30,
      connect,
      sleep,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      ...over,
    });
    return { adapter, sleep, connect };
  };

  const rateLimit = () => Object.assign(new Error("HTTP request failed"), { status: 429 });

  it("publishes with the configured days, and returns a lowercase key and estimated expiry", async () => {
    const clients = fakeClients();
    const result = await adapterWith(clients).adapter.publishAnchor(payload);
    expect(clients.create).toHaveBeenCalledWith(payload, 30);
    expect(result.entityKey).toBe(`0x${"a".repeat(64)}`);
    expect(result.expiresAt).toBe(new Date((1_000_000 + 500 * 2) * 1000).toISOString());
  });

  it("refuses a payload with extra fields before anything is sent", async () => {
    const clients = fakeClients();
    const attempt = adapterWith(clients).adapter.publishAnchor({ ...payload, title: "private" } as AnchorPayload);
    await expect(attempt).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(clients.create).not.toHaveBeenCalled();
  });

  it("refuses a returned key in the wrong format", async () => {
    const clients = fakeClients({ create: vi.fn(async () => ({ entityKey: "not-a-key", expiresAtBlock: 1n })) });
    await expect(adapterWith(clients).adapter.publishAnchor(payload)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("publishing still succeeds if the expiry estimate fails, using the configured days", async () => {
    const clients = fakeClients({ timing: vi.fn(async () => { throw new Error("down"); }) });
    const result = await adapterWith(clients).adapter.publishAnchor(payload);
    expect(result.expiresAt).toBe("2026-01-31T00:00:00.000Z");
  });

  it("retries a rate limit at most twice, with backoff, then gives up", async () => {
    const clients = fakeClients({ create: vi.fn(async () => { throw rateLimit(); }) });
    const { adapter, sleep } = adapterWith(clients);
    await expect(adapter.publishAnchor(payload)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(clients.create).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1500]);
  });

  it("succeeds if a retry succeeds", async () => {
    let calls = 0;
    const clients = fakeClients({
      create: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw rateLimit();
        return { entityKey: ENTITY_KEY, expiresAtBlock: 1_000n };
      }),
    });
    expect((await adapterWith(clients).adapter.publishAnchor(payload)).entityKey).toBe(ENTITY_KEY);
  });

  it("does not retry other failures: a write that failed may still land", async () => {
    const clients = fakeClients({ create: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(adapterWith(clients).adapter.publishAnchor(payload)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(clients.create).toHaveBeenCalledTimes(1);
  });

  it("times out a write and a read that never answer, without retrying", async () => {
    const never = () => new Promise<never>(() => undefined);
    const clients = fakeClients({ create: vi.fn(never), read: vi.fn(never) });
    const { adapter } = adapterWith(clients, { writeTimeoutMs: 5, readTimeoutMs: 5 });
    await expect(adapter.publishAnchor(payload)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(adapter.readAnchor(ENTITY_KEY)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(clients.create).toHaveBeenCalledTimes(1);
  });

  it("reads an entity, lowercasing the owner", async () => {
    const result = await adapterWith(fakeClients()).adapter.readAnchor(ENTITY_KEY);
    expect(result).toEqual({
      status: "found",
      ownerAddress: `0x${"ab".repeat(20)}`,
      payload,
      expiresAt: new Date((1_000_000 + 500 * 2) * 1000).toISOString(),
    });
  });

  it("reports no live entity as not_found", async () => {
    const clients = fakeClients({ read: vi.fn(async () => null) });
    expect(await adapterWith(clients).adapter.readAnchor(ENTITY_KEY)).toEqual({ status: "not_found" });
  });

  it("refuses a malformed key before anything is sent", async () => {
    const clients = fakeClients();
    await expect(adapterWith(clients).adapter.readAnchor("0x1234")).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(clients.read).not.toHaveBeenCalled();
  });

  it("refuses an entity with unexpected or extra columns", async () => {
    for (const columns of [{ ...payload, extra: "x" }, { ...payload, eventDigest: "short" }, {}]) {
      const clients = fakeClients({
        read: vi.fn(async () => ({ ownerAddress: ANCHOR_ADDRESS, expiresAtBlock: 1n, columns })),
      });
      await expect(adapterWith(clients).adapter.readAnchor(ENTITY_KEY)).rejects.toMatchObject({ code: "INVALID_ENTITY" });
    }
  });

  it("a read gives a null expiry if the estimate fails", async () => {
    const clients = fakeClients({ timing: vi.fn(async () => { throw new Error("down"); }) });
    const result = await adapterWith(clients).adapter.readAnchor(ENTITY_KEY);
    expect(result).toMatchObject({ status: "found", expiresAt: null });
  });

  it("connects once, and again after a failed connection", async () => {
    const clients = fakeClients();
    const connect = vi
      .fn<() => Promise<ArkivClients>>()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValue(clients);
    const { adapter } = adapterWith(clients, { connect });
    await expect(adapter.readAnchor(ENTITY_KEY)).rejects.toBeInstanceOf(AnchorError);
    await adapter.readAnchor(ENTITY_KEY);
    await adapter.readAnchor(ENTITY_KEY);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  describe("sanitizing (R7)", () => {
    const url = `https://rpc.rabdi.db-chain.testnet.arkiv.network/${FAKE_ACCESS_KEY}`;
    const leaky = (message: string, over: object = {}) =>
      Object.assign(new Error(`${message} URL: ${url} key ${FAKE_PRIVATE_KEY}`, { cause: new Error(url) }), over);

    it.each<[string, Error, AnchorErrorCode]>([
      ["HTTP 429", leaky("HTTP request failed", { status: 429 }), "RATE_LIMITED"],
      ["JSON-RPC limit code", leaky("limit", { code: -32005 }), "RATE_LIMITED"],
      ["rate limit wording", leaky("rate limit exceeded"), "RATE_LIMITED"],
      ["HTTP 401", leaky("nope", { status: 401 }), "UNAUTHORIZED"],
      ["HTTP 403", leaky("nope", { status: 403 }), "UNAUTHORIZED"],
      ["quota wording", leaky("monthly quota reached"), "UNAUTHORIZED"],
      ["no funds", leaky("insufficient funds for gas"), "INSUFFICIENT_FUNDS"],
      ["timeout", leaky("The request timed out"), "TIMEOUT"],
      ["anything else", leaky("socket hang up"), "UNAVAILABLE"],
    ])("maps %s to a code and drops every detail", (_label, error, code) => {
      const result = toAnchorError(error);
      expect(result.code).toBe(code);
      const shown = `${result.message} ${result.stack} ${JSON.stringify(result)} ${String(result.cause)}`;
      expect(shown).not.toContain(FAKE_ACCESS_KEY);
      expect(shown).not.toContain(FAKE_PRIVATE_KEY);
      expect(result.cause).toBeUndefined();
    });

    it("finds the status on a nested cause", () => {
      const nested = Object.assign(new Error("outer"), { cause: Object.assign(new Error("inner"), { status: 429 }) });
      expect(toAnchorError(nested).code).toBe("RATE_LIMITED");
    });

    it("keeps an AnchorError as it is", () => {
      expect(toAnchorError(new AnchorError("INVALID_ENTITY")).code).toBe("INVALID_ENTITY");
    });

    it("a thrown SDK error never reaches the caller", async () => {
      const clients = fakeClients({ read: vi.fn(async () => { throw leaky("failed"); }) });
      const error = await adapterWith(clients).adapter.readAnchor(ENTITY_KEY).catch((e: Error) => e);
      expect(error).toBeInstanceOf(AnchorError);
      expect(String((error as Error).stack)).not.toContain(FAKE_ACCESS_KEY);
    });
  });
});

describe("source rules", () => {
  const sources = readdirSync(here)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => [name, readFileSync(join(here, name), "utf8")] as const);

  it("the SDK is only ever loaded on first use, so nothing runs while disabled (R8)", () => {
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(/^import [^;]*from "@arkiv-network\/sdk/m);
    }
    expect(sources.find(([name]) => name === "arkivClients.ts")![1]).toContain('import("@arkiv-network/sdk")');
  });

  it("never describes anchors as lasting forever (R3)", () => {
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(/permanent|immutable|forever|cannot be changed/i);
    }
  });

  it("nothing can trigger a release or refund (R9)", () => {
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(/release|refund|escrow/i);
    }
  });

  it("nothing logs", () => {
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(/console\.|\.log\(/);
    }
  });
});
