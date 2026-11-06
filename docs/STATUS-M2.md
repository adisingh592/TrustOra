# M2 status

Verified by reading the code and tests on 2026-11-06, commit `d1b5439`. Baselines: `pnpm test` 861 tests pass across 5 workspaces; `pnpm -r exec tsc --noEmit` exits 0; `pnpm security:scan` and `--history` both report 0 findings; `pnpm --filter @trustora/api db:check` 13/13.

Status values: **IMPLEMENTED** (tests prove it), **PARTIAL** (works but with a known gap), **MOCKED** (only exercised through a `MOCK_`/placeholder adapter), **MISSING** (not built), **BLOCKED-ON-OTHERS** (needs M1's or M3's real adapter).

## Auth

| Module | Status | Evidence |
| --- | --- | --- |
| SIWE nonce, verify, logout, me | IMPLEMENTED | [auth/routes.ts](../apps/api/src/auth/routes.ts), [auth/auth.test.ts](../apps/api/src/auth/auth.test.ts) (80 tests: replay, expiry, wrong chain/domain, tampered cookie, parallel verify) |
| Session cookies (HMAC, httpOnly, SameSite=Lax) | IMPLEMENTED | [auth/session.ts](../apps/api/src/auth/session.ts) |
| Production `SESSION_SECRET` ≥32 chars enforced | IMPLEMENTED | [auth/config.ts](../apps/api/src/auth/config.ts), `config refuses to start in production when SESSION_SECRET is missing/short` |
| CORS | MISSING | No `@fastify/cors` dependency; nothing in [app.ts](../apps/api/src/app.ts) |

## Projects & agreements

| Module | Status | Evidence |
| --- | --- | --- |
| Create / list / read project | IMPLEMENTED | [projects/routes.ts](../apps/api/src/projects/routes.ts), `projects.test.ts` (171 tests) |
| Agreement versions, immutability via SQLite triggers | IMPLEMENTED | 4 trigger migrations; `SEC-002: accepted terms cannot change` tests run raw SQL to prove the trigger fires, not just the API |
| Accept / agree, both-sides logic | IMPLEMENTED | same file, `both accepting the latest version moves the project and milestones to AGREED` |
| Outsider access → 404 | IMPLEMENTED | `returns 404, not 403, to an outsider on every project route` |
| Payment mode field | PARTIAL | `Project.paymentMode` exists (`ARC_ESCROW` / `EXTERNAL_PAYMENT`), but nothing reads or branches on it yet |

## ProofTrack (packages/prooftrack + apps/api/src/prooftrack)

| Module | Status | Evidence |
| --- | --- | --- |
| `recordEvent`, allowed-combination table, idempotency | IMPLEMENTED | [rules.ts](../packages/prooftrack/src/rules.ts), `core.test.ts` (recordEvent: combinations, 27 tests) |
| `getTimeline`, deterministic ordering | IMPLEMENTED | `ordering.test.ts`, `timeline.test.ts` |
| `verifyEvent`/`verifyProject`, MATCH/MISMATCH/UNAVAILABLE → VERIFIED/FAILED/PENDING | IMPLEMENTED | [verification.ts](../packages/prooftrack/src/verification.ts), `verification.test.ts` |
| Chain verifier (MILESTONE_FUNDED, PAYMENT_RELEASED) | MOCKED | [chainVerifier.ts](../packages/prooftrack/src/chainVerifier.ts) only exercised via `MOCK_ChainAdapter`; `buildVerifiers` returns an empty map unless a real `EscrowAdapter` is passed in |
| `GET /projects/:id/prooftrack`, `POST .../verify`, `POST .../events/:id/verify` | IMPLEMENTED | [prooftrack/routes.ts](../apps/api/src/prooftrack/routes.ts), `prooftrack.test.ts` (38 tests incl. rate limit, no event-creation route) |
| Arkiv public anchor (`packages/arkiv`) | IMPLEMENTED (optional, off by default) | `POST .../events/:eventId/anchor`; real SDK calls confirmed against SDK 1.0.1 and a live read-only probe of Rabdi; off unless `ARKIV_ENABLED=true` |
| WORK_SUBMITTED / MILESTONE_APPROVED independent check | MISSING | `EscrowAdapter` has no method for these two; `buildVerifiers` only wires `BLOCKCHAIN_TRANSACTION_HASH` to `verifyFunding`/`verifyRelease` |
| `funding-proof` / `submit-proof` / `release-proof` endpoints | MISSING | no such routes registered |

## TAEVA (apps/api/src/taeva)

| Module | Status | Evidence |
| --- | --- | --- |
| `POST .../evaluate`, `GET .../evaluation` | IMPLEMENTED (routes work, tests pass) | [taeva/routes.ts](../apps/api/src/taeva/routes.ts), `taeva.test.ts` (36 tests) |
| Deterministic heuristic fallback | IMPLEMENTED | [taeva.ts](../apps/api/src/taeva/taeva.ts) |
| Real 0G adapter | BLOCKED-ON-OTHERS | `packages/og`/`packages/evaluation` export only `placeholderAdapter` with `health()` → `NOT_CONFIGURED` |
| **Honesty rule (R2)** | **VIOLATION, confirmed by reading the code** | [taeva/routes.ts:124-141](../apps/api/src/taeva/routes.ts#L124): when the adapter is absent or unusable, the route still records a `ProofEvent` with `ecosystem: "ZERO_G"`, `referenceType: "INFERENCE_REQUEST_ID"`, a **fabricated** `requestId` (`taeva-inf-${randomBytes(16)}` from [taeva.ts:76](../apps/api/src/taeva/taeva.ts#L76)), and `verificationStatus: "VERIFIED"` set immediately — with no independent check and no adapter involved. Nothing in `taeva.test.ts` currently catches this. |

## ScopeGuard / TrustShield / Trust Report

| Module | Status | Evidence |
| --- | --- | --- |
| `GET /projects/:id/scopeguard` | IMPLEMENTED | [scopeguard/routes.ts](../apps/api/src/scopeguard/routes.ts), 1 test file |
| `GET /projects/:id/trustshield` | IMPLEMENTED | [trustshield/routes.ts](../apps/api/src/trustshield/routes.ts), 1 test file |
| `GET /projects/:id/trust-report` | IMPLEMENTED | [trustreport/routes.ts](../apps/api/src/trustreport/routes.ts), aggregates the above plus ProofTrack counts |
| Not independently reviewed line-by-line in this audit | — | these three modules' internal logic wasn't re-derived here; only their route shape and that their tests pass |

## Deliverables / uploads

| Module | Status | Evidence |
| --- | --- | --- |
| `UploadValidator` (size, type, zip-bomb/zip-slip checks) | IMPLEMENTED (library) | [packages/security/src/uploadValidator.ts](../packages/security/src/uploadValidator.ts) — owned by M5, not editable here |
| Any route that uses it | MISSING | no `@fastify/multipart` dependency; no deliverable upload route exists |
| `Submission` model | PARTIAL | table exists with `privateFilePath`/`fileHash`/`aiConsent`, but nothing writes to it — `taeva.test.ts` constructs rows directly |

## Infrastructure / deploy

| Module | Status | Evidence |
| --- | --- | --- |
| `GET /infrastructure` | MISSING | not registered anywhere |
| `GET /health` | IMPLEMENTED | [app.ts](../apps/api/src/app.ts), returns `{"ok":true}`, no auth |
| `GET /ready` | MISSING | — |
| Startup config validation (zod, production) | PARTIAL | only `SESSION_SECRET` length is enforced; `AUTH_DOMAIN`/`DATABASE_URL`/`ARC_TESTNET_USDC_ADDRESS` are not validated at startup |
| CORS | MISSING | — |
| Graceful shutdown | MISSING | — |
| Dockerfile / `.dockerignore` | MISSING | — |

## Docs

| Module | Status |
| --- | --- |
| `docs/ARCHITECTURE.md` | PARTIAL — covers DB choice, milestone-ID derivation, folder ownership; no API list, no ProofTrack event table, no adapter diagram |
| `docs/API.md` | MISSING |
| `docs/DEPLOY.md` | MISSING |
| `docs/INTEGRATION-HANDOFF.md` | MISSING |

## Shared package / Prisma

- `packages/shared`: enums, `ProofEvent`, `EscrowAdapter`/`EvaluationAdapter`/`AgentPaymentAdapter`/`AnchorAdapter` interfaces, Zod schemas, labelled fixtures — IMPLEMENTED, 107 tests.
- Prisma: 6 migrations, all applied; `AgreementVersion` carries 4 SQLite triggers (immutable terms, no-delete, single-set acceptances) that **Prisma does not track** — confirmed by reading every migration file and by a test that queries `sqlite_master` directly after every migration.
