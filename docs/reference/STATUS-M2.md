# M2 Status & Implementation Matrix

> **Archival note (merge, 2026-11-07):** this document describes the Fastify service now parked at
> [`reference/api-fastify/`](../../reference/api-fastify/). It is not the live product (see the root
> `README.md` and [`docs/MERGE-NOTES.md`](../MERGE-NOTES.md)). File paths below are relative to that
> directory (e.g. `apps/api/src/...` now means `reference/api-fastify/api/src/...`) and are kept as
> originally written rather than rewritten path-by-path.

Last updated: 2026-11-07. Baseline: Monorepo test suites passing across all packages; TypeScript compiles cleanly (`tsc --noEmit`); `pnpm security:scan` and `scripts/secret-scan.mjs --history` both report 0 findings; `pnpm --filter @trustora/api db:check` passes 13/13.

Status values:
- **IMPLEMENTED**: Fully built and verified with automated test suites.
- **MOCKED / ADAPTER-READY**: Wired through dynamic adapter loader (`CHAIN_ADAPTER=mock|arc`, `EVALUATION_ADAPTER=heuristic|zerog`). Ready to load real implementations when environment variables are supplied.
- **PARTIAL**: Works with a documented gap.
- **BLOCKED-ON-OTHERS**: Depends on external contracts or off-chain service deployments.

---

## 1. Authentication & Security

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| SIWE Nonce, Verify, Logout, Me | IMPLEMENTED | `apps/api/src/auth/routes.ts`, `auth/auth.test.ts` (replay prevention, expiry, domain validation, tampered cookie tests) |
| Session Cookies (HMAC, httpOnly, SameSite=Lax) | IMPLEMENTED | `apps/api/src/auth/session.ts` |
| Production `SESSION_SECRET` (≥32 chars) | IMPLEMENTED | `apps/api/src/auth/config.ts`, `apps/api/src/serverConfig.ts` |
| CORS Configuration | IMPLEMENTED | `@fastify/cors` configured with `CORS_ORIGIN` in `apps/api/src/app.ts` |
| Security Headers (`nosniff`, `DENY`, `strict-origin`) | IMPLEMENTED | Fastify `onSend` security hook in `apps/api/src/app.ts` |
| SEC-001: Lowercase Wallet Normalization | IMPLEMENTED | `apps/api/src/auth/users.ts`, `apps/api/src/projects/routes.ts` |
| SEC-002: AgreementVersion DB Triggers | IMPLEMENTED | SQLite triggers in Prisma migrations; documented in `apps/api/prisma/migrations/README.md` |
| SEC-003: Milestone Amounts & ID Validation | IMPLEMENTED | `packages/shared/src/schemas.ts`, `apps/api/src/milestones/milestoneRoutes.ts` |
| SEC-004: SQLite Side-Files & Private Storage Gitignored | IMPLEMENTED | `.gitignore` covers `*.db-journal`, `*.db-wal`, `*.db-shm`, `.storage` |

---

## 2. Projects & Agreements

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| Create / List / Read Project (`/projects`) | IMPLEMENTED | `apps/api/src/projects/routes.ts`, `projects.test.ts` |
| Agreement Versions & Immutability | IMPLEMENTED | 4 DB triggers prevent term tampering post-acceptance |
| Accept / Agree Workflow (Dual Acceptance) | IMPLEMENTED | Transitions project and milestones to `AGREED` upon mutual signature |
| Outsider Access Protection (404) | IMPLEMENTED | Non-participants receive 404 (IDOR protection) |
| Payment Mode Support (`ARC_ESCROW` / `EXTERNAL_PAYMENT`) | IMPLEMENTED | `Project.paymentMode` stored and validated via shared schemas |

---

## 3. Milestones & Evidence Submission (Phase 1)

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| `POST .../funding-proof` | IMPLEMENTED | `apps/api/src/milestones/milestoneRoutes.ts`, verifies against `EscrowAdapter`, sets milestone `FUNDED`, emits `MILESTONE_FUNDED` ProofEvent. |
| `POST .../deliverable` (Upload) | IMPLEMENTED | Uses `@fastify/multipart` and M5's `uploadValidator` (size, MIME, magic bytes, zip slip checks). Generates SHA-256 hash. Freelancer only. |
| `GET .../deliverable` (Download) | IMPLEMENTED | Authenticated streaming download for client, freelancer, and arbiter. |
| `POST .../submit-proof` | IMPLEMENTED | Verifies on-chain submit work receipt, confirms deliverable SHA-256 matches chain payload, sets `WORK_SUBMITTED`. Emits `WORK_SUBMITTED` ProofEvent. |
| `POST .../release-proof` | IMPLEMENTED | Verifies release payment transaction via `EscrowAdapter`, sets milestone `APPROVED`/`RELEASED`. Emits `PAYMENT_RELEASED` ProofEvent. |
| Idempotency & Tx Reuse Prevention | IMPLEMENTED | Proactive natural key lookup (`REFERENCE_ALREADY_USED`) prevents reusing same tx hash across projects. |

---

## 4. ProofTrack Evidence Timeline

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| `recordEvent`, Allowed Combinations, Idempotency | IMPLEMENTED | `packages/prooftrack/src/rules.ts`, `core.test.ts` |
| Deterministic Event Ordering & Timeline | IMPLEMENTED | `packages/prooftrack/src/timeline.ts` |
| Event & Project Verification (`verifyEvent`, `verifyProject`) | IMPLEMENTED | `packages/prooftrack/src/verification.ts` |
| Timeline Query (`GET /projects/:id/prooftrack`) | IMPLEMENTED | `apps/api/src/prooftrack/routes.ts`, includes formatted `explorerUrl` for blockchain events. |
| Single Event Verification (`POST .../events/:id/verify`) | IMPLEMENTED | `apps/api/src/prooftrack/routes.ts` |
| Public Audit Verification (`GET /verify/:publicProjectId`) | IMPLEMENTED | `apps/api/src/infrastructure/routes.ts`, provides sanitized public audit timeline without auth. |
| Arkiv Public Anchoring (`POST .../events/:id/anchor`) | IMPLEMENTED | `packages/arkiv`, optional, enabled when `ARKIV_ENABLED=true`. |

---

## 5. TAEVA (Evaluation & Advisory AI)

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| `POST .../evaluate`, `GET .../evaluation` | IMPLEMENTED | `apps/api/src/taeva/routes.ts`, `taeva.test.ts` |
| Mandatory AI Consent Enforcement | IMPLEMENTED | Enforces `submission.aiConsent === true` before running evaluation (`AI_CONSENT_REQUIRED`). |
| Honesty Rule (R2) Adherence | IMPLEMENTED | Deterministic heuristic does not fabricate `ZERO_G` request IDs or fake `ProofEvent` records. Only authentic `ZERO_G_INFERENCE` generates ProofTrack event. |
| Dynamic 0G Adapter Wiring | ADAPTER-READY | `apps/api/src/adapters/loader.ts` dynamically loads `@trustora/evaluation` when `EVALUATION_ADAPTER=zerog`. |

---

## 6. ScopeGuard / TrustShield / Trust Report

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| ScopeGuard (`GET /projects/:id/scopeguard`) | IMPLEMENTED | `apps/api/src/scopeguard/routes.ts`, scope change diff & cost impact calculations. |
| TrustShield (`GET /projects/:id/trustshield`) | IMPLEMENTED | `apps/api/src/trustshield/routes.ts`, risk indicators & dispute signal analysis. |
| Trust Report (`GET /projects/:id/trust-report`) | IMPLEMENTED | `apps/api/src/trustreport/routes.ts`, comprehensive project health aggregation. |

---

## 7. Infrastructure & Deployment Readiness

| Module / Endpoint | Status | Evidence |
| --- | --- | --- |
| `GET /health` | IMPLEMENTED | `apps/api/src/app.ts`, simple liveness probe (`{"ok": true}`). |
| `GET /ready` | IMPLEMENTED | `apps/api/src/app.ts`, checks DB connectivity & adapter health. Returns 200 or 503. |
| `GET /infrastructure` | IMPLEMENTED | `apps/api/src/infrastructure/routes.ts`, cached status for Arc, 0G, and Hedera. |
| Startup Configuration Validation | IMPLEMENTED | `apps/api/src/serverConfig.ts`, Zod validation for production requirements & adapter configurations. |
| Graceful Shutdown | IMPLEMENTED | `apps/api/src/shutdown.ts`, catches SIGTERM/SIGINT, closes Fastify and Prisma pools cleanly. |
| Container Readiness | IMPLEMENTED | `Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`. |
