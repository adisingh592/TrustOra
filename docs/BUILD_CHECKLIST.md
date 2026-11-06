# Build and release checklist

Status reflects repository code and available tests as of 2026-11-06.

## Implemented and locally tested

- [x] Wallet nonce authentication, session checks, project participant authorization.
- [x] Client and freelancer project workflows, invitation acceptance, agreement signing, submissions, revision/dispute paths.
- [x] Arc escrow contract, deployment preflight, browser transaction preparation, and server verification logic.
- [x] 0G router/evaluation client with advisory-only structured output and honest unavailable behavior.
- [x] ProofTrack event/timeline helpers and independent Arc event verification in the application.
- [x] SQLite/Prisma schema and safe additive database update utility.
- [x] SQLite fixed-window throttles on nonce issuance and authenticated mutation routes (not a network-wide rate limiter).
- [x] 184 unit/API tests and 14 local Hardhat tests pass on the current dependency set.
- [x] Web TypeScript check and Next.js production build pass.
- [x] Production dependency audit (`npm audit --omit=dev`) reports zero findings.
- [x] CI workflow added for install, tests, contract compilation, type checks, build, and dependency audit.

## Implemented but not live verified

- [ ] Arc escrow deployment and live two-wallet lifecycle. No deployment address is configured; do not claim a live escrow transaction.
- [ ] Real 0G inference request and returned report. Current provider tests are mocked; credentials are not included.
- [ ] Live Mirror Node transaction verification of an actual TRUSTORA settlement.

## Not implemented

- [ ] Hedera x402 v2 exact end-to-end payment, facilitator client, reservation integration in a real payment flow, and settlement record creation. A persistent budget reservation primitive exists but does not execute payments.
- [ ] Public ProofTrack verification portal.
- [ ] Production-grade database operations, monitoring, backups, and incident response.
- [ ] Independent security audit and production readiness review.

## Known dependency issue

The full npm audit reports 49 development/tooling findings (19 low, 19 moderate, 11 high), primarily in the existing Hardhat 2 / toolbox dependency tree. A safe Hardhat major migration is separate work. These findings remain visible and are not suppressed; production dependencies currently audit clean.
