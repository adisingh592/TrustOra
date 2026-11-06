#!/usr/bin/env node
// Live smoke test against the Arkiv Rabdi testnet. Not part of pnpm test.
// It spends test GLM and writes one FAKE public entity that expires after 1 day.
//
//   node --env-file=api/.env scripts/arkiv-smoke.mjs
//
// Needs ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY for a dedicated, funded testnet account.
// Prints only the entity key and the read-back result. Never prints a key or raw error.
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "arkiv", "package.json"));
const load = (id) => import(pathToFileURL(require.resolve(id).replace(/\.cjs$/, ".js")).href);

const accessKey = process.env.ARKIV_ACCESS_KEY;
const privateKey = process.env.ARKIV_PRIVATE_KEY;
if (!accessKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) {
  console.log("Skipped: set ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY to run this live check.");
  process.exit(0);
}

try {
  const sdk = await load("@arkiv-network/sdk");
  const { rabdi } = await load("@arkiv-network/sdk/chains");
  const schema = await load("@arkiv-network/sdk/schema");
  const { http } = await load("viem");
  const { privateKeyToAccount } = await load("viem/accounts");

  // Must match arkiv/src/arkivClients.ts.
  const ProofAnchor = schema.defineSchema("trustora.proofanchor.v1", {
    projectId: schema.str().indexed(),
    eventType: schema.str(),
    eventDigest: schema.str(),
    subjectDigest: schema.str().optional(),
    network: schema.str(),
    reference: schema.str(),
    occurredAt: schema.str(),
  });

  const chain = rabdi({ accessKey });
  const account = privateKeyToAccount(privateKey);
  const publicClient = sdk.createPublicClient({ chain, transport: http() });
  const walletClient = sdk.createWalletClient({ chain, transport: http(), account });

  const digest = randomBytes(32).toString("hex");
  const { entityKey } = await walletClient.createEntity(
    ProofAnchor,
    {
      projectId: "TRU-PROJ-2026-0000000",
      eventType: "MILESTONE_FUNDED",
      eventDigest: digest,
      network: "FIXTURE_SMOKE_TEST",
      reference: "FIXTURE_SMOKE_TEST",
      occurredAt: new Date().toISOString(),
    },
    { expiration: sdk.ExpirationTime.fromDays(1) },
  );
  console.log("Entity key:", entityKey);

  const row = await publicClient.getEntity(entityKey, ProofAnchor);
  const ownerMatches = row.$owner.toLowerCase() === account.address.toLowerCase();
  const digestMatches = row.eventDigest.value === digest;
  console.log("Read back:", { ownerMatches, digestMatches });
  process.exit(ownerMatches && digestMatches ? 0 : 1);
} catch (error) {
  // SDK errors can contain the RPC URL, which holds the access key.
  console.log("Smoke test failed:", error instanceof Error ? error.name : "unknown error");
  process.exit(1);
}
