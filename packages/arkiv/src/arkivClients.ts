import { AnchorError, type AnchorPayload } from "@trustora/shared";

export const ANCHOR_SCHEMA_NAME = "trustora.proofanchor.v1";

/** The only part of this package that touches the Arkiv SDK. */
export interface ArkivClients {
  create(payload: AnchorPayload, days: number): Promise<{ entityKey: string; expiresAtBlock: bigint }>;
  /** Null when no live entity has this key: never created, deleted or expired. */
  read(entityKey: string): Promise<{
    ownerAddress: string;
    expiresAtBlock: bigint;
    columns: Record<string, unknown>;
  } | null>;
  timing(): Promise<{ currentBlock: bigint; currentBlockTime: number; blockDuration: number }>;
}

export interface ArkivConnectOptions {
  accessKey: string;
  privateKey: `0x${string}`;
  requestTimeoutMs: number;
}

/**
 * Imported on first use, so with Arkiv disabled the SDK is never even loaded.
 * Calls confirmed against SDK 1.0.1's README, source and types, and the docs at
 * docs.arkiv.network/start-here/first-entity/.
 */
export const connectArkiv = async (options: ArkivConnectOptions): Promise<ArkivClients> => {
  const [sdk, { rabdi }, schema, { http }, { privateKeyToAccount }] = await Promise.all([
    import("@arkiv-network/sdk"),
    import("@arkiv-network/sdk/chains"),
    import("@arkiv-network/sdk/schema"),
    import("viem"),
    import("viem/accounts"),
  ]);

  // Exactly these columns. Only hashes, references and public identifiers.
  const ProofAnchor = schema.defineSchema(ANCHOR_SCHEMA_NAME, {
    projectId: schema.str().indexed(),
    eventType: schema.str(),
    eventDigest: schema.str(),
    subjectDigest: schema.str().optional(),
    network: schema.str(),
    reference: schema.str(),
    occurredAt: schema.str(),
  });

  // rabdi() puts the access key in the RPC URL, and http() with no URL sends it.
  const chain = rabdi({ accessKey: options.accessKey });
  const transport = http(undefined, { timeout: options.requestTimeoutMs });
  const publicClient = sdk.createPublicClient({ chain, transport });
  const walletClient = sdk.createWalletClient({
    chain,
    transport,
    account: privateKeyToAccount(options.privateKey),
  });

  return {
    async create(payload, days) {
      const { entityKey, expiresAt } = await walletClient.createEntity(
        ProofAnchor,
        {
          projectId: payload.projectId,
          eventType: payload.eventType,
          eventDigest: payload.eventDigest,
          ...(payload.subjectDigest ? { subjectDigest: payload.subjectDigest } : {}),
          network: payload.network,
          reference: payload.reference,
          occurredAt: payload.occurredAt,
        },
        { expiration: sdk.ExpirationTime.fromDays(days) },
      );
      return { entityKey, expiresAtBlock: expiresAt };
    },

    async read(entityKey) {
      try {
        const row = await publicClient.getEntity(entityKey as `0x${string}`, ProofAnchor);
        return {
          ownerAddress: row.$owner,
          expiresAtBlock: row.$expiresAt,
          columns: {
            projectId: row.projectId.value,
            eventType: row.eventType.value,
            eventDigest: row.eventDigest.value,
            ...(row.subjectDigest ? { subjectDigest: row.subjectDigest.value } : {}),
            network: row.network.value,
            reference: row.reference.value,
            occurredAt: row.occurredAt.value,
          },
        };
      } catch (error) {
        if (error instanceof sdk.NoEntityFoundError) return null;
        if (error instanceof schema.SchemaMismatchError) throw new AnchorError("INVALID_ENTITY");
        throw error;
      }
    },

    timing: () => publicClient.getBlockTiming(),
  };
};
