// Real-call smoke test. Needs ZG_ROUTER_API_KEY (testnet) in YOUR local env. Never prints keys.
// Writes out/real-inference.json ONLY when a real response with a request ID came back.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOgClientFromEnv, OgError, RouterClient } from "../src/index";

const outDir = fileURLToPath(new URL("../../../out/", import.meta.url));

async function main(): Promise<void> {
  const { client, path } = createOgClientFromEnv(process.env);
  console.log(`path: ${path}`);
  if (path === "none") throw new OgError("NOT_CONFIGURED", "set ZG_ROUTER_API_KEY (testnet) in your shell first");
  if (client instanceof RouterClient) {
    console.log(`models: ${(await client.listModels()).join(", ") || "(none)"}`);
  }
  const res = await client.chat({
    system: "You are a connectivity probe. Reply with exactly one word.",
    user: "Say OK.",
    temperature: 0,
    maxTokens: 16,
  });
  const record = {
    capturedAt: new Date().toISOString(),
    path,
    requestId: res.requestId,
    requestIdType: "INFERENCE_REQUEST_ID", // NOT a transaction hash; no explorer link
    requestIdSource: res.requestIdSource,
    chatId: res.chatId,
    modelId: res.modelId,
    providerAddress: res.providerAddress,
    teeVerified: res.teeVerified,
    teeVerifiedBy: res.teeVerifiedBy,
    trustModeRequested: res.trustModeRequested,
    content: res.content,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}real-inference.json`, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
  console.log("wrote out/real-inference.json (teeVerified is router-reported unless teeVerifiedBy=sdk-independent)");
}

main().catch((e: unknown) => {
  const code = e instanceof OgError ? e.code : "UNEXPECTED";
  console.error(`FAILED [${code}]: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
