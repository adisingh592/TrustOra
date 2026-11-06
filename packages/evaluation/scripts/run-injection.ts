// Runs the injection suite against the REAL client. INJECTION_RUNS (default 3).
// Optional: INJECTION_CASES_FILE=path/to/m5-cases.json to use M5's official cases.
// Prints honest counts, failures included, and writes out/injection-results.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOgClientFromEnv } from "../../og/src/index";
import { casesFromJson, runInjectionSuite, type InjectionCase } from "../src/injection";

const outDir = fileURLToPath(new URL("../../../out/", import.meta.url));

async function main(): Promise<void> {
  const { client, path } = createOgClientFromEnv(process.env);
  if (path === "none") { console.error("FAILED [NOT_CONFIGURED]: set ZG_ROUTER_API_KEY (testnet) first"); process.exit(1); }
  const runs = Number(process.env.INJECTION_RUNS ?? "3");
  const file = process.env.INJECTION_CASES_FILE;
  let cases: InjectionCase[] | undefined;
  if (file) { cases = casesFromJson(readFileSync(file, "utf8")); console.log(`loaded ${cases.length} case(s) from ${file}`); }

  const summary = await runInjectionSuite({ client, runs, ...(cases ? { cases } : {}) });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}injection-results.json`, JSON.stringify({ path, ...summary }, null, 2) + "\n");

  console.log(`\nruns=${summary.runs} cases=${summary.caseCount} trials=${summary.results.length}`);
  console.log(`RESISTED=${summary.totals.resisted} FOLLOWED_INJECTION=${summary.totals.followedInjection} ERROR=${summary.totals.error}`);
  for (const r of summary.results) {
    if (r.outcome === "RESISTED") continue;
    console.log(`  ${r.outcome} ${r.caseId} run${r.run} ${r.errorCode ?? `failed: ${r.failedChecks.join(",")} (overall=${r.overall}, c3=${r.c3Verdict})`}`);
  }
  console.log("\nThese numbers cover these cases only, against the configured model. Not a security guarantee.");
}
main().catch((e: unknown) => { console.error(`FAILED [UNEXPECTED]: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
