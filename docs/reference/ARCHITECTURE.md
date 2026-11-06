# Architecture

> **Archival note (merge, 2026-11-07):** this is the original architecture doc for the parked
> Fastify service, now at [`reference/api-fastify/`](../../reference/api-fastify/) (`apps/api` below
> means `reference/api-fastify/api`, etc.). It is not the live product; see the root `README.md`
> and [`docs/MERGE-NOTES.md`](../MERGE-NOTES.md) for what actually shipped.

SQLite is the default database for the sprint.
Use Postgres only if one is already running.

## What is built, in progress, and not built

This is a living project; check `docs/STATUS-M2.md` for the detailed, evidence-based audit of every module. In short:

- **Built and tested:** wallet sign-in (SIWE-style), projects and locked agreement versions, ProofTrack's event/timeline/verification core, the Arkiv public evidence anchor (optional, off by default), ScopeGuard, TrustShield, the unified trust report, and TAEVA's advisory evaluation (honest about whether a real AI model ran — see "TAEVA honesty" below).
- **In progress:** `GET /infrastructure`, a public `GET /verify/:id` audit view, the milestone funding/deliverable-upload/submission/release flow, and an env-driven factory (`apps/api/src/adapters/loader.ts`) that will load the real chain and 0G adapters once M1 and M3's packages are ready — see `docs/INTEGRATION-HANDOFF.md`.
- **Not built:** the real Arc escrow contract and chain adapter (M1), the real 0G evaluation adapter (M3), Hedera agent payments (stretch).

## API and ProofTrack events

See `docs/API.md` for the full endpoint list, request/response shapes, and error codes.

ProofTrack records one event per significant step, each with an `ecosystem`, a `referenceType`, and a `verificationStatus` that starts `PENDING` and only becomes `VERIFIED` once the backend has independently checked it against the matching adapter:

| Event type | Ecosystem | Reference type |
| --- | --- | --- |
| `MILESTONE_FUNDED` | `ARC` | `BLOCKCHAIN_TRANSACTION_HASH` |
| `WORK_SUBMITTED` | `ARC` | `BLOCKCHAIN_TRANSACTION_HASH` |
| `MILESTONE_APPROVED` | `ARC` | `BLOCKCHAIN_TRANSACTION_HASH` |
| `PAYMENT_RELEASED` | `ARC` | `BLOCKCHAIN_TRANSACTION_HASH` |
| `EVALUATION_COMPLETED` | `ZERO_G` | `INFERENCE_REQUEST_ID` |
| `AGREEMENT_ACCEPTED_CLIENT` / `AGREEMENT_ACCEPTED_FREELANCER` | `APPLICATION` | `APPLICATION_EVENT_ID` |
| `AGENT_PAYMENT_SETTLED` | `HEDERA` | `FACILITATOR_SETTLEMENT_ID` |
| `AGENT_PAYMENT_DENIED` | `HEDERA` | `APPLICATION_EVENT_ID` |
| `EVIDENCE_ANCHORED` | `ARKIV` | `STORAGE_REFERENCE` |

A reference type is never reused across ecosystems for a different kind of proof — a 0G inference ID can never be stored or read as a transaction hash, and vice versa.

## Adapter diagram

```
                    apps/api
                       │
         ┌─────────────┼──────────────┐
         │              │              │
  EscrowAdapter   EvaluationAdapter  AnchorAdapter
  (packages/shared interfaces, implemented per adapter)
         │              │              │
   packages/arc   packages/evaluation  packages/arkiv
   (M1, real;      (M3, real;          (M2, real —
    MOCK_ChainAdapter   heuristic        optional, off
    used until ready)   fallback used    unless ARKIV_*
                         until ready)    is configured)
```
`apps/api/src/adapters/loader.ts` picks the real or mock chain/evaluation adapter from env (`CHAIN_ADAPTER`, `EVALUATION_ADAPTER` — see `docs/INTEGRATION-HANDOFF.md`). The Arkiv anchor adapter is loaded separately and is always optional.

## TAEVA honesty

TAEVA's advisory evaluation never fabricates an AI result. Every report carries `evaluationSource` (`DETERMINISTIC_HEURISTIC` or `ZERO_G_INFERENCE`) and `isAI`. When no real 0G adapter is configured or healthy, the report is explicitly `DETERMINISTIC_HEURISTIC`/`isAI: false`, with an empty `requestId` and a plain-language `evaluationNote` — and, critically, **no ProofTrack event is recorded** for it, because there is no independent evidence to record. Only a report produced by a real adapter call becomes a `VERIFIED` `EVALUATION_COMPLETED` event.

## Milestone IDs

`onchainMilestoneId` is an M2 decision: a 0x-prefixed 32-byte hex string, `keccak256` of the UTF-8 bytes of the internal (database) milestone id. M1 and M4 must derive it identically — see `docs/INTEGRATION-HANDOFF.md`.

## Agreement immutability

`AgreementVersion` rows are immutable once any acceptance is recorded, enforced by SQLite triggers (not by Prisma's own schema tracking) created across several migrations. A migration that rebuilds that table must recreate the triggers, or they're silently lost — this has already happened once and was caught by a test that queries `sqlite_master` directly after every migration.

## How to run the manual database check

Run `pnpm --filter @trustora/api db:check` from the repo root.
It uses a temporary SQLite file, deletes it afterwards, and never writes to `prisma/dev.db`.
It prints PASS or FAIL per check and exits 0 only if everything passed.

## Folder ownership

| Member | Owns |
| --- | --- |
| M1 | `contracts`, `packages/arc` |
| M2 | `apps/api`, `packages/shared`, `packages/prooftrack` |
| M3 | `packages/og`, `packages/evaluation` |
| M4 | `apps/web`, `README.md` |
| M5 | `packages/security`, `tests/security` |
