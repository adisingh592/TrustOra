// Real evaluation of the FIXTURE deliverable. Needs ZG_ROUTER_API_KEY in your local env.
// Writes out/real-evaluation.json only on a real, schema-valid report.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOgClientFromEnv } from "../../og/src/index";
import { Evaluator } from "../src/evaluator";
import { buildFixtureInput, FIXTURE_SUBMISSION_HASH } from "../fixtures/FIXTURE_sample-input";

const outDir = fileURLToPath(new URL("../../../out/", import.meta.url));

async function main(): Promise<void> {
  const { client, path } = createOgClientFromEnv(process.env);
  console.log(`path: ${path}`);
  if (path === "none") { console.error("FAILED [NOT_CONFIGURED]: set ZG_ROUTER_API_KEY (testnet) first"); process.exit(1); }
  const evaluator = new Evaluator({ client });
  const outcome = await evaluator.evaluate(buildFixtureInput(true));
  if (!outcome.ok) {
    console.error(`FAILED [${outcome.error.code}]: ${outcome.error.message}`);
    process.exit(1);
  }
  const record = { capturedAt: new Date().toISOString(), path, fixtureSubmissionHash: FIXTURE_SUBMISSION_HASH, report: outcome.report };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}real-evaluation.json`, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record, null, 2));
  const c3 = outcome.report.criteria.find((c) => c.id === "c3");
  console.log(`\noverall=${outcome.report.overall} c3=${c3?.verdict} (ground truth: c3 must NOT be PASS — the Desk Lamp image has no alt)`);
  console.log(`requestId=${outcome.report.requestId} (INFERENCE_REQUEST_ID, not a tx hash)`);
  console.log(`health after run: ${(await evaluator.health()).status}`);
}
main().catch((e: unknown) => { console.error(`FAILED [UNEXPECTED]: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
