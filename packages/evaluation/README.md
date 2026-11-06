# packages/evaluation: deliverable evaluation (M3)

Advisory, criteria-based evaluation of a milestone deliverable via `packages/og`. No import of `packages/arc`:
there is no path from an AI verdict to escrow.

- `src/schema.ts` zod input/output contracts (strict: model output may not add fields or an `overall`).
- `src/prompt.ts` system prompt, per-call random boundary, sanitiser, 24,000-char cap, `promptHash`.
- `src/evaluator.ts` `Evaluator.evaluate()`, `computeOverall()`, `extractJson()`, `health()`.
- `src/injection.ts` 10 `M3-PRELIM` probes + `casesFromJson()` for M5's official cases.
- `src/criteria-draft.ts` optional `draftCriteria()` — `DRAFT_NOT_BINDING`.
- `fixtures/FIXTURE_sample-input.ts` the only content sent to a real model. Ground truth: **c3 FAILS**.
- `docs/EVALUATOR-LIMITS.md`, `docs/INTERFACE-NOTES-FOR-M2.md`.

## Real runs (need your local `ZG_ROUTER_API_KEY`)
```bash
npx tsx packages/evaluation/scripts/evaluate-fixture.ts        # -> out/real-evaluation.json
INJECTION_RUNS=3 npx tsx packages/evaluation/scripts/run-injection.ts   # -> out/injection-results.json
```
`INJECTION_CASES_FILE=path.json` swaps in M5's cases.

## Tests
`npx tsx --test packages/evaluation/test/*.test.ts` — `MOCK_` clients: proves **logic only**, not that 0G works
and not that a real model resists injection.
