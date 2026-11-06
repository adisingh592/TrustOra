# TrustOra API

Base URL: wherever `apps/api` is deployed (see `docs/DEPLOY.md`). Every request below that needs a session must be sent with `credentials: "include"` from a browser so the session cookie is attached.

This covers the stable, tested surface as of this writing. A few endpoints (`/infrastructure`, `/verify/:id`, the milestone deliverable/funding/submission flow) are still under active development in this repo; they're noted briefly at the end rather than fully specified, because their shapes are still changing.

Every example value below (addresses, hashes, IDs) is **illustrative**, not real.

## Error format

Every error response has this shape:
```json
{ "error": { "code": "SOME_CODE", "message": "A sentence safe to show the user." } }
```
Codes are stable identifiers for your own branching logic; messages are plain language.

## Sign-in (SIWE-style wallet auth)

Step by step, for a browser wallet:

1. **`POST /auth/nonce`** — body `{ "address"?: "0x..." }` (optional; lowercased if given). Returns:
   ```json
   { "nonce": "a1b2...", "message": "localhost:3001 wants you to sign in...\n...", "expiresAt": "2026-01-01T00:05:00.000Z" }
   ```
   The nonce expires in 5 minutes.
2. **Sign** `message` exactly as returned, with the connected wallet (`personal_sign` / `signMessage`).
3. **`POST /auth/verify-wallet`** — body `{ "message": "...", "signature": "0x..." }`. On success, sets the session cookie and returns:
   ```json
   { "address": "0x...", "userId": "clxyz..." }
   ```
   Failure is always `401`, never `500`, with one of these codes: `MALFORMED_MESSAGE`, `MALFORMED_SIGNATURE`, `DOMAIN_MISMATCH`, `CHAIN_MISMATCH`, `NONCE_UNKNOWN`, `NONCE_EXPIRED`, `NONCE_USED`, `NONCE_MISMATCH`, `ADDRESS_MISMATCH`, `SIGNATURE_INVALID`.
4. Use `credentials: "include"` on every subsequent request so the cookie goes along.
5. **`GET /auth/me`** — `200 { "address": "0x...", "userId": "..." }`, or `401 UNAUTHENTICATED`.
6. **`POST /auth/logout`** — clears the cookie, `200 { "ok": true }`.

## Status enums

| Enum | Values |
| --- | --- |
| `VerificationStatus` (ProofTrack events) | `PENDING`, `VERIFIED`, `FAILED` |
| `MilestoneStatus` | `DRAFT`, `AGREED`, `FUNDED`, `WORK_SUBMITTED`, `REVISION_REQUESTED`, `APPROVED`, `RELEASED`, `DISPUTED`, `RESOLVED`, `REFUNDED` |
| `ProjectStatus` | `DRAFT`, `AGREED`, `FUNDED`, `ACTIVE`, `COMPLETED`, `DISPUTED`, `CANCELLED` |
| `Ecosystem` | `ARC`, `ZERO_G`, `HEDERA`, `APPLICATION`, `ARKIV` |
| `ReferenceType` | `BLOCKCHAIN_TRANSACTION_HASH`, `INFERENCE_REQUEST_ID`, `STORAGE_REFERENCE`, `FACILITATOR_SETTLEMENT_ID`, `APPLICATION_EVENT_ID` |
| `CriterionStatus` (TAEVA, ScopeGuard) | `PASS`, `PARTIAL`, `FAIL`, `UNABLE_TO_ASSESS` |
| `EvaluationSource` (TAEVA) | `DETERMINISTIC_HEURISTIC`, `ZERO_G_INFERENCE` |

## Money formatting

Every amount in the API is a **string of integer base units** (USDC has 6 decimals). Never parse it with `Number()` for anything that touches money — use a bigint-safe library, or for display only:
```js
const usdc = (baseUnits) => `${(BigInt(baseUnits) / 1_000_000n)}.${(BigInt(baseUnits) % 1_000_000n).toString().padStart(6, "0")}`;
usdc("50000000"); // "50.000000"
```

## Projects and agreements

All require a session. Non-participants get `404`, identical to a project that doesn't exist — never `403`.

### `POST /projects`
Client only (the caller becomes the client).
```json
{
  "title": "Build a landing page",
  "description": "...",
  "freelancerWallet": "0x...",
  "arbiterWallet": "0x...",
  "milestones": [
    { "title": "M1", "amount": "50000000", "deadline": "2099-01-01T00:00:00.000Z", "criteria": ["Passes all tests"] }
  ]
}
```
`201` with the created project (see `GET /projects/:id` for the shape). Errors: `400 INVALID_INPUT`, `400 SAME_WALLET` (client/freelancer/arbiter must all differ), `503 TOKEN_NOT_CONFIGURED` (server has no `ARC_TESTNET_USDC_ADDRESS` configured yet).

### `GET /projects`
`200 { "projects": [...] }` — only projects where the caller is client or freelancer.

### `GET /projects/:id`
```json
{
  "id": "TRU-PROJ-2026-0001042",
  "title": "...", "description": "...", "status": "DRAFT", "role": "client",
  "clientWallet": "0x...", "freelancerWallet": "0x...", "arbiterWallet": "0x...",
  "createdAt": "...",
  "agreement": { "version": 1, "agreementHash": "...", "clientAcceptedAt": null, "freelancerAcceptedAt": null },
  "versions": [ { "version": 1, "agreementHash": "...", "clientAcceptedAt": null, "freelancerAcceptedAt": null } ],
  "milestones": [
    { "id": "...", "onchainMilestoneId": "0x...", "title": "M1", "amountBaseUnits": "50000000",
      "tokenAddress": "0x...", "tokenDecimals": 6, "deadline": "...", "status": "DRAFT", "criteria": ["..."] }
  ]
}
```

### `POST /projects/:id/agreement/versions`
Participant only (client or freelancer). Body: `{ "milestones": [{ "id": "...", "title": "...", "amount": "...", "deadline": "...", "criteria": ["..."] }] }` — every one of the project's milestones, exactly once. `201` with the project, now at `version + 1`, acceptances cleared. Errors: `400 INVALID_INPUT`, `400 MILESTONES_MISMATCH`, `409 NOT_NEGOTIABLE` (funds have already moved).

### `POST /projects/:id/agreement/accept`
Participant only. Body `{ "version": 1 }`. Records *that caller's* acceptance of exactly that version (a client can never accept as the freelancer, or vice versa — the body has no role field). When both sides have accepted the same latest version, the project and its milestones move to `AGREED`. Errors: `409 VERSION_NOT_LATEST`, `409 NOT_NEGOTIABLE`.

Agreement terms are immutable at the database level once any acceptance is recorded (SQLite triggers — see `docs/ARCHITECTURE.md`); this is enforced below the API, not just by route logic.

## ProofTrack

The project's evidence timeline. There is no endpoint to create an event directly — only server code records one, after independently checking it.

### `GET /projects/:id/prooftrack`
Participant only. `200 { "projectId": "...", "events": [...] }`, each event:
```json
{
  "id": "...", "type": "MILESTONE_FUNDED", "ecosystem": "ARC", "network": "Arc Testnet",
  "referenceType": "BLOCKCHAIN_TRANSACTION_HASH", "reference": "0x...",
  "status": "PENDING", "statusReason": null, "lastCheckedAt": null,
  "occurredAt": "...", "explorerUrl": null, "summary": "Funding transaction for this milestone."
}
```
An `EVIDENCE_ANCHORED` event additionally carries `expiresAt` and a `note` ("Public hash-only record on the Arkiv testnet. It expires.").

### `POST /projects/:id/prooftrack/verify`
Participant only. Re-checks every event against whatever adapters are configured. `429 RATE_LIMITED` if called again within 10 seconds for the same project.

### `POST /projects/:id/prooftrack/events/:eventId/verify`
Same, for one event. `404 NOT_FOUND` if the event doesn't belong to that project.

### `POST /projects/:id/prooftrack/events/:eventId/anchor`
Participant only. Publishes a hash-only public anchor (Arkiv) of an already-`VERIFIED` event, then records and verifies an `EVIDENCE_ANCHORED` event. Idempotent per source event. Errors: `409 SOURCE_NOT_VERIFIED` (only a verified event can be anchored), `429 RATE_LIMITED`, `501 ARKIV_NOT_ENABLED` (off by default), `503 ANCHOR_UNAVAILABLE` (nothing is recorded on failure).

## ScopeGuard — `GET /projects/:id/scopeguard`
Participant (client, freelancer, or arbiter) only. Query: `?baseVersion=1&targetVersion=2` (both optional; default to comparing the latest version against the one before it). Returns a diff between two agreement versions:
```json
{
  "publicProjectId": "...", "baseVersion": 1, "targetVersion": 2, "hasChanges": true,
  "milestoneDiffs": [...], "totalAmountDeltaBaseUnits": "25000000", "totalDeadlineShiftDays": 3,
  "timelineRisk": "LOW", "costRisk": "MEDIUM", "overallRisk": "MEDIUM",
  "approvalStatus": { "clientAccepted": false, "freelancerAccepted": false, "isFullyAccepted": false },
  "summary": "..."
}
```
Errors: `404 NOT_FOUND`, `404 NO_AGREEMENT_VERSIONS`, `400 INVALID_VERSION`.

## TrustShield — `GET /projects/:id/trustshield`
Participant only. A heuristic risk read on the project (never AI-based, never affects money):
```json
{
  "publicProjectId": "...", "evaluatedAt": "...",
  "deadlineAdherence": { "...": "..." }, "scopeVolatility": { "...": "..." },
  "submissionHistory": { "...": "..." }, "disputeHistory": { "...": "..." },
  "overallRisk": "LOW", "overallConfidence": 0.8, "explanation": "...", "heuristicNotes": ["..."]
}
```

## Unified Trust Report — `GET /projects/:id/trust-report`
Participant only. Combines TAEVA evaluations, ScopeGuard, TrustShield, and ProofTrack counts into one summary for a project. See the schemas in `packages/shared/src/schemas.ts` (`UnifiedTrustReportSchema`) for the exact shape — it's a direct aggregation of the sections above plus `proofTrackSummary: { totalEvents, verifiedCount, pendingCount, ... }`.

## TAEVA (advisory evaluation)

**Advisory only. Never triggers a release or refund by itself.**

### `POST /projects/:id/milestones/:milestoneId/evaluate`
Participant only; needs a submitted deliverable. `200` with:
```json
{
  "milestoneId": "...", "submissionId": "...", "fileHash": "...",
  "deterministicChecks": { "hashVerified": true, "deadlineMet": true, "agreementAccepted": true, "aiConsentGranted": true },
  "criteriaResults": [{ "criterion": "...", "status": "PASS", "evidence": "..." }],
  "overallStatus": "PASS", "isAdvisory": true, "evaluatedAt": "...", "explanation": "...",
  "requestId": "", "reportHash": "...",
  "evaluationSource": "DETERMINISTIC_HEURISTIC", "isAI": false,
  "evaluationNote": "No AI model was used. This is a deterministic heuristic check, not an AI evaluation."
}
```
**For M4:** when `evaluationSource` is `DETERMINISTIC_HEURISTIC`, show the result as a heuristic check, not an AI evaluation — use `evaluationNote` verbatim or similar wording, and `requestId` will be an empty string (there is no inference ID to show, because none was fabricated). When `evaluationSource` is `ZERO_G_INFERENCE`, `isAI` is `true` and `requestId` is real. Errors: `404 NOT_FOUND`, `400 NO_SUBMISSION`, `400 NO_AGREEMENT`.

### `GET /projects/:id/milestones/:milestoneId/evaluation`
Returns the latest evaluation report for a milestone, same shape as above. `404 NO_EVALUATION` if none exists yet.

## Health

- **`GET /health`** — always public. `200 { "ok": true }`.
- **`GET /ready`** — always public. Checks the database. `200 { "ok": true, "database": "connected", "timestamp": "..." }` or `503 { "ok": false, "database": "disconnected", "timestamp": "..." }`, with no further detail on failure.

## Milestone Escrow & Deliverable Lifecycle

All require a session. Non-participants get `404`, identical to a missing project.

### `POST /projects/:id/milestones/:milestoneId/funding-proof`
Participant only (client or freelancer). Body:
```json
{ "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111" }
```
Verifies the transaction on-chain via the `EscrowAdapter` (receipt & escrow state), validates chain ID, contract address, amount, token, agreement hash, and sets milestone status to `FUNDED`. Records a `MILESTONE_FUNDED` ProofTrack event (`BLOCKCHAIN_TRANSACTION_HASH`, `ARC`). Idempotent on the same transaction hash.  
Errors: `400 INVALID_INPUT`, `400 MILESTONE_NOT_AGREED`, `400 FUNDING_MISMATCH`, `400 REFERENCE_ALREADY_USED`, `503 ESCROW_NOT_CONFIGURED`, `503 TOKEN_NOT_CONFIGURED`, `503 CHAIN_UNAVAILABLE`.

### `POST /projects/:id/milestones/:milestoneId/deliverable`
Freelancer only. Requires milestone to be in `FUNDED` status. Multipart form upload (`file` part + optional `aiConsent` text field `"true"` or `"false"`). Validated via `UploadValidator` (size limit, extension allowlist, magic bytes, zip safety). Saved privately to persistent storage. Returns:
```json
{
  "ok": true,
  "submissionId": "clxyz...",
  "fileHash": "e3b0c442...852b855",
  "size": 1024,
  "aiConsent": true
}
```
Errors: `400 MISSING_FILE`, `400 INVALID_UPLOAD`, `400 MILESTONE_NOT_FUNDED`, `404 NOT_FOUND`.

### `GET /projects/:id/milestones/:milestoneId/deliverable`
Participants (client, freelancer, arbiter) only. Streams the uploaded private deliverable file with `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename="deliverable-<milestoneId>.bin"`.  
Errors: `404 NOT_FOUND`, `404 NO_SUBMISSION`, `404 FILE_NOT_FOUND`.

### `POST /projects/:id/milestones/:milestoneId/submit-proof`
Freelancer only. Body `{ "txHash": "0x..." }`. Verifies that the on-chain escrow `deliverableHash` matches the uploaded deliverable SHA-256 file hash. Moves milestone status to `WORK_SUBMITTED` and records a `WORK_SUBMITTED` ProofTrack event. Idempotent on the same transaction hash.  
Errors: `400 INVALID_INPUT`, `400 NOT_FUNDED`, `400 NO_SUBMISSION`, `400 DELIVERABLE_HASH_MISMATCH`, `400 REFERENCE_ALREADY_USED`, `503 ESCROW_NOT_CONFIGURED`, `503 CHAIN_UNAVAILABLE`.

### `POST /projects/:id/milestones/:milestoneId/release-proof`
Client or Arbiter only (freelancer gets `403 FORBIDDEN`). Body `{ "txHash": "0x..." }`. Verifies on-chain escrow settlement, updates milestone status to `RELEASED` (and project to `COMPLETED` if all milestones are released), and records `MILESTONE_APPROVED` and `PAYMENT_RELEASED` ProofTrack events. Idempotent on the same transaction hash.  
Errors: `400 INVALID_INPUT`, `400 MILESTONE_NOT_SUBMITTED`, `400 RELEASE_MISMATCH`, `400 REFERENCE_ALREADY_USED`, `403 FORBIDDEN`, `503 ESCROW_NOT_CONFIGURED`, `503 CHAIN_UNAVAILABLE`.

## Public Verification & Infrastructure

### `GET /verify/:publicProjectId`
Public unauthenticated endpoint. Returns a sanitized audit view of the project, including milestones, criteria, delivery statuses, ordered ProofTrack timeline events, and Unified Trust Report summary without exposing any user emails, internal IDs, or private file paths. Returns `404 NOT_FOUND` for invalid or unknown project IDs.

### `GET /infrastructure`
Public or authenticated. Real-time health check of integration adapters with 5-second in-memory caching:
```json
{
  "arc": { "status": "CONNECTED", "detail": "...", "checkedAt": "..." },
  "zeroG": { "status": "NOT_CONFIGURED", "detail": "...", "checkedAt": "..." },
  "hedera": { "status": "NOT_CONFIGURED", "detail": "Agent payments off in this demo (stretch goal).", "checkedAt": "..." },
  "timestamp": "..."
}
```
