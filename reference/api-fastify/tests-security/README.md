# Security tests

Part 1 is here now: `wallet-auth.test.ts`, `upload-validator.test.ts`, `secret-scan.test.ts`.
Run them with `pnpm --filter @trustora/security-tests test`.

## Verification-integrity checklist for Part 2

These are TODO. None of them has been written or run yet. Each one waits for the owner's code to exist. M5 writes and runs the tests; the owner fixes any finding.

| Done | Check | What it must prove | Code owner |
| --- | --- | --- | --- |
| [ ] | Contract negative tests | Wrong caller, double release, double refund, wrong state and deadline cases all revert | M1 |
| [ ] | Prompt-injection cases | Instructions hidden in a submission cannot change the evaluation result or trigger any payment | M3 |
| [ ] | Tampered transaction hash | A changed or made-up hash is never recorded as `VERIFIED` | M1, M2 |
| [ ] | Wrong contract | A real transaction to a different contract fails verification | M1, M2 |
| [ ] | Wrong amount | A funding transaction for a different amount fails verification | M1, M2 |
| [ ] | Wrong agreementHash | A funding transaction for a different agreement fails verification | M1, M2 |
| [ ] | Request ID labelling | An inference request ID is never labelled or stored as a transaction hash | M2, M3 |
| [ ] | Public `/verify` leak test | The public page exposes no private file path, deliverable content, secret or personal data | M2, M4 |
| [ ] | IDOR checks | A logged-in user cannot read or change another user's project, milestone or submission by changing an ID | M2 |
| [ ] | Honesty audit | The UI and README claim nothing untested or unverified, and fixtures are never shown as real | M4, M5 |
