# Integration Handoff Specification

> **Archival note (merge, 2026-11-07):** written for the parked Fastify service at
> [`reference/api-fastify/`](../../reference/api-fastify/), not the live Next.js product. See
> [`docs/MERGE-NOTES.md`](../MERGE-NOTES.md) for what shipped instead.

This document provides the definitive integration handoff contracts for **M1 (Chain Adapter - Arc)**, **M3 (0G Evaluation Adapter)**, **M4 (Frontend)**, and **M5 (Security Verification)**.

---

## 1. For M1: `EscrowAdapter` (`packages/arc`)

### 1.1 Architecture & Interface
The backend dynamically imports `@trustora/arc` when `CHAIN_ADAPTER=arc`.
The adapter must implement `EscrowAdapter` defined in `packages/shared/src/adapters.ts`:

```typescript
export interface EscrowAdapter {
  getConfig(): {
    chainId: number;
    rpcUrl: string;
    escrowAddress: string;
    tokenAddress: string;
    explorerBase: string;
  };
  verifyFunding(milestoneId: string, txHash: string): Promise<VerifiedChainEvent>;
  verifyRelease(milestoneId: string, txHash: string): Promise<VerifiedChainEvent>;
  readEscrow(milestoneId: string): Promise<EscrowState>;
  health(): Promise<IntegrationHealth>;
}
```

### 1.2 Export Shape
`packages/arc` must export at its entry point:
```typescript
export function createArcAdapter(env: NodeJS.ProcessEnv): EscrowAdapter;
// OR
export const arcAdapter: EscrowAdapter;
```

### 1.3 Required Environment Variables
| Variable | Description | Example / Required Value |
| --- | --- | --- |
| `CHAIN_ADAPTER` | Switch to Arc chain adapter | `arc` |
| `ARC_TESTNET_CHAIN_ID` | Arc testnet chain ID | `5042002` (must match exactly) |
| `ARC_TESTNET_RPC_URL` | Valid HTTP/HTTPS RPC endpoint | `https://rpc.testnet.arc.network` |
| `ARC_ESCROW_CONTRACT_ADDRESS` | Deployed escrow contract | `0x...` (0x-prefixed 40 hex chars) |
| `ARC_TESTNET_USDC_ADDRESS` | Arc testnet USDC token address | `0x3600000000000000000000000000000000000000` |
| `ARC_EXPLORER_BASE_URL` | Block explorer base URL | `https://explorer.testnet.arc.network` |

### 1.4 Smart Contract ABI & Event Requirements
The escrow contract on Arc must emit the following events:
- **`MilestoneFunded(bytes32 indexed milestoneId, address indexed funder, uint256 amount, bytes32 agreementHash)`**
- **`WorkSubmitted(bytes32 indexed milestoneId, address indexed freelancer, bytes32 deliverableHash)`**
- **`PaymentReleased(bytes32 indexed milestoneId, address indexed recipient, uint256 amount)`**

### 1.5 Identifier & Hash Formulas
- **`onchainMilestoneId`**: `keccak256(UTF-8 bytes of DB milestoneId)`. Format: `0x` + 64 hex characters.
  - Formula: `keccak256(Buffer.from(milestone.id, "utf-8"))`
- **`agreementHash`**: SHA-256 hash of canonical sorted-key JSON string of the agreed project terms (version number excluded). Formatted as `0x` + 64 hex chars or 64 hex chars.
- **Explorer Tx URL Format**: `${explorerBase}/tx/${txHash}`.

### 1.6 Verification Honesty (Rules R1 - R3)
- `verifyFunding` and `verifyRelease` must verify against receipt logs AND `readEscrow(milestoneId)`.
- If RPC fails, is unreachable, or transaction is still pending: **throw an error**. A thrown error maps to `PENDING` or `UNAVAILABLE`. Never return `verified: true` unless the receipt was confirmed on-chain.
- If data (amount, contract, tokens, recipient, agreementHash) mismatches: return `verified: false` with clear `reason`.

---

## 2. For M3: `EvaluationAdapter` (`packages/evaluation`)

### 2.1 Interface Contract
The backend dynamically imports `@trustora/evaluation` when `EVALUATION_ADAPTER=zerog`.
Must implement `EvaluationAdapter` defined in `packages/shared/src/adapters.ts`:

```typescript
export interface EvaluationAdapter {
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
  health(): Promise<IntegrationHealth>;
}
```

### 2.2 Return Shape (`EvaluationResult`)
```typescript
export interface EvaluationResult {
  score: number;                   // Integer or float (0-100)
  verdict: "PASSED" | "FAILED" | "REQUIRES_HUMAN_REVIEW";
  summary: string;
  requestId: string;               // Real 0G inference request ID (never txHash, never fabricated)
  modelId: string;                 // E.g. "0g-serving-llama-3-8b"
  providerMode: "TeeML" | "TeeTLS" | "Standard";
  details?: Record<string, unknown>;
}
```

### 2.3 Export Shape & Environment Variables
`packages/evaluation` must export:
```typescript
export function createEvaluationAdapter(env: NodeJS.ProcessEnv): EvaluationAdapter;
// OR
export const evaluationAdapter: EvaluationAdapter;
```

Required environment variables:
| Variable | Description | Example |
| --- | --- | --- |
| `EVALUATION_ADAPTER` | Switch to 0G evaluation adapter | `zerog` |
| `ZG_RPC_URL` | 0G Storage/Serving RPC URL | `https://rpc-storage-testnet.0g.ai` |
| `ZG_STORAGE_CONTRACT` | 0G Storage flow contract address | `0x...` |
| `ZG_MODEL_ID` | Model identifier | `0g-serving-llama-3-8b` |

### 2.4 Honesty & Health Check Fallback
- When `health()` returns anything other than `CONNECTED` or `VERIFIED`, TAEVA automatically falls back to deterministic heuristic (`DETERMINISTIC_HEURISTIC`), marks `isAI: false`, and records **NO** fabricated `ZERO_G` ProofTrack events.
- Never return a fabricated `requestId` (e.g. random string). The backend strictly validates reference type `INFERENCE_REQUEST_ID`.

---

## 3. For M4: Frontend Integration Guide

### 3.1 Base Configuration & Cookie Authentication
- **API Base URL**: `http://localhost:3001` (or production configured port/domain).
- **Authentication**: SIWE session cookies (`trustora_session`).
- **Fetch Option**: All requests from the web app MUST set `credentials: "include"` (or Axios `withCredentials: true`).
- **CORS**: Configured via `CORS_ORIGIN` (default includes `http://localhost:3000`).

### 3.2 Authentication Flow
1. `GET /auth/nonce` → `{ nonce: string }`
2. User signs EIP-4361 message in wallet.
3. `POST /auth/verify-wallet` with `{ message, signature }` → sets `trustora_session` cookie, returns `{ user }`.
4. `GET /auth/me` → returns current authenticated user.
5. `POST /auth/logout` → clears session cookie.

### 3.3 Core Endpoint Mapping & Status Vocabulary
| Screen / Action | Method & Endpoint | Payload / Params | Expected Status Response |
| --- | --- | --- | --- |
| Project List | `GET /projects` | None | `Project[]` |
| Project Detail | `GET /projects/:id` | None | `Project` (includes `AgreementVersion[]`, `Milestone[]`) |
| Submit Agreement Version | `POST /projects/:id/agreement/versions` | `{ terms: { title, description, milestones: [...] } }` | `AgreementVersion` |
| Accept Agreement | `POST /projects/:id/agreement/accept` | `{ versionId: string }` | `Project` (transitions to `AGREED` when both accept) |
| Post Funding Proof | `POST /projects/:id/milestones/:milestoneId/funding-proof` | `{ txHash: "0x..." }` | `Milestone` (status: `FUNDED`) |
| Upload Deliverable | `POST /projects/:id/milestones/:milestoneId/deliverable` | `multipart/form-data` (file: `deliverable`, field: `aiConsent=true`) | `Submission` |
| Download Deliverable | `GET /projects/:id/milestones/:milestoneId/deliverable` | None | Streams raw file attachment |
| Submit Work Proof | `POST /projects/:id/milestones/:milestoneId/submit-proof` | `{ txHash: "0x..." }` | `Milestone` (status: `WORK_SUBMITTED`) |
| Request Evaluation | `POST /projects/:id/milestones/:milestoneId/evaluate` | None | `EvaluationReport` |
| View Evaluation | `GET /projects/:id/milestones/:milestoneId/evaluation` | None | `EvaluationReport` |
| Post Release Proof | `POST /projects/:id/milestones/:milestoneId/release-proof` | `{ txHash: "0x..." }` | `Milestone` (status: `APPROVED` or `RELEASED`) |
| ProofTrack Timeline | `GET /projects/:id/prooftrack` | None | `{ events: ProofEventWithExplorer[], count }` |
| Re-verify Proof Event | `POST /projects/:id/events/:eventId/verify` | None | `{ eventId, verificationStatus, ... }` |
| ScopeGuard Summary | `GET /projects/:id/scopeguard` | None | Scope comparison report |
| TrustShield Indicators | `GET /projects/:id/trustshield` | None | Risk indicators & metrics |
| Trust Summary Report | `GET /projects/:id/trust-report` | None | Aggregated trust metrics |
| Public Audit View | `GET /verify/:publicProjectId` | None (No auth required) | Public sanitized project audit timeline |
| Infrastructure Status | `GET /infrastructure` | None | `{ arc: {...}, zerog: {...}, hedera: {...} }` |

### 3.4 Displaying Amounts & Data Formatting
- **Money formatting**: `amountBaseUnits` is an integer string representing base units (6 decimals for USDC, e.g. `"1000000"` = 1.00 USDC).
  - **Never parse with `Number()`** for financial calculations. Use BigInt:
    ```typescript
    function formatUnits(baseUnits: string, decimals = 6): string {
      const b = BigInt(baseUnits);
      const div = 10n ** BigInt(decimals);
      const integerPart = (b / div).toString();
      const fractionPart = (b % div).toString().padStart(decimals, "0").slice(0, 2);
      return `${integerPart}.${fractionPart}`;
    }
    ```
- **Timeline Links**: Each ProofTrack event in `GET /projects/:id/prooftrack` includes an `explorerUrl` string when applicable. Display as clickable link.

---

## 4. For M5: Security Checklist & Status

Re-verification of security controls in the API:

| Item | Control | Status | Verification Check |
| --- | --- | --- | --- |
| **SEC-001** | Case-insensitive wallet addresses | **FIXED** | All addresses converted to lowercase on entry in `users.ts`, `auth/routes.ts`, and `projects/routes.ts`. |
| **SEC-002** | AgreementVersion Immutability | **FIXED** | 4 SQLite triggers enforced at DB level in migrations; documented in `apps/api/prisma/migrations/README.md`. Tested against direct SQL modifications. |
| **SEC-003** | API Boundary & Amount Schema Validation | **FIXED** | All milestone amounts, tx hashes, and milestone IDs validated against Zod schemas in `@trustora/shared` (`TxHashSchema`, `AmountBaseUnitsSchema`, `OnchainMilestoneIdSchema`). |
| **SEC-004** | SQLite side-files gitignored | **FIXED** | `.gitignore` includes `*.db-journal`, `*.db-wal`, `*.db-shm`, `.storage`. Verified with `git check-ignore`. |
| **SEC-005** | Safe File Storage & Access Control | **FIXED** | Deliverables stored in private folder (`.storage/`) with random UUIDs; served only via authenticated streaming endpoint with participant check. |
| **SEC-006** | Fail-Closed Chain Verification | **FIXED** | Claims require verified events from `EscrowAdapter`. Duplicate transaction reuse prevented across projects. |
| **SEC-007** | Security Headers & Body Limits | **FIXED** | Fastify hook sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Body limit capped at 30MB, file cap 25MB. |
