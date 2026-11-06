# TrustOra

> **AI-Powered, Blockchain-Backed Trust & Verification Infrastructure for Digital Work.**  
> Built for ETHGlobal Mumbai 2026. Combines cryptographic agreement immutability, automated evidence verification (TAEVA), scope change detection (ScopeGuard), behavioral risk analytics (TrustShield), verifiable audit timelines (ProofTrack), and optional Arc smart contract escrow.

---

## 🌟 Strategic Vision & Architecture

TRUSTORA has evolved beyond a traditional freelance escrow app into a **universal trust infrastructure for digital work and agentic agreements**. Escrow is now an **optional payment module** rather than a hard dependency:

1. **TAEVA (Trustora Adaptive Evidence Verification Algorithm)**:  
   Automatically evaluates submitted deliverables against agreed milestone acceptance criteria using deterministic proof checks (SHA-256 deliverable payload hashing, deadline adherence, AI consent, dual-accepted terms) and advisory AI evaluation via **0G (ZeroGravity)**. AI remains strictly advisory and never automates or forces fund movements.
2. **ScopeGuard (Scope Change Detection)**:  
   Protects clients and freelancers from scope creep and unauthorized changes. Performs granular diffs between agreement versions, detects added/removed/modified criteria, computes milestone deadline shifts (in days) and budget deltas, estimates timeline and cost risk ratings (`LOW`, `MEDIUM`, `HIGH`), and verifies dual acceptance without silently overwriting past versions.
3. **TrustShield (Reliability & Risk Analysis)**:  
   Analyzes project communication and history to evaluate reliability. Assesses deadline adherence, scope volatility (version churn), deliverable revision loops, and dispute statuses. Emits explainable heuristic indicators without punitive actions.
4. **ProofTrack (Audit Timeline & Verification)**:  
   An evidence-backed timeline tracking every milestone lifecycle event. Enforces strict reference-type isolation (`BLOCKCHAIN_TRANSACTION_HASH`, `INFERENCE_REQUEST_ID`, `APPLICATION_EVENT_ID`, etc.), deterministic 3-tier ordering, and independent backend verification.
5. **Flexible Payment Architecture**:
   - **`ARC_ESCROW`**: On-chain USDC escrow on Arc Testnet (`Chain ID: 5042002`) with 6-decimal base-unit string precision.
   - **`EXTERNAL_PAYMENT`**: Direct or off-chain settlement where TRUSTORA verifies agreements, deliverables, criteria, and audit timelines without requiring smart contract locking.
6. **Unified Trust Report**:  
   Generates a verifiable, tamper-evident completion report aggregating TAEVA, ScopeGuard, TrustShield, and ProofTrack with a cryptographic SHA-256 fingerprint (`verifiableReportHash`).

---

## 📊 Project Status & Implementation Matrix

| Component | Path | Status | Owner | What Is Actually Done |
| :--- | :--- | :---: | :---: | :--- |
| **Monorepo Workspace** | Root | ✅ Complete | All | `pnpm` workspaces, unified TypeScript configs, CI hooks, and automated secret scanning |
| **Shared Library** | `packages/shared` | ✅ Complete | M2 | Zod input/output schemas for TAEVA, ScopeGuard, TrustShield, Unified Trust Report, payment modes, DTOs, enums, adapters, fixtures (**88 tests**) |
| **Backend API** | `apps/api` | ✅ Complete | M2 | Fastify v5 server, Prisma 6 + SQLite database, SIWE wallet auth, projects, agreement versioning, ProofTrack, TAEVA, ScopeGuard, TrustShield, and Trust Report endpoints (**248 tests**) |
| **ProofTrack Engine** | `packages/prooftrack` | ✅ Complete | M2 | Evidence audit timeline, reference-type isolation, deterministic 3-tier ordering, Arc chain verifier, status transitions (**163 tests**) |
| **Security Module** | `packages/security` | ✅ Complete | M5 | SIWE wallet verifier, deliverable upload validator, and sensitive data sanitization |
| **Security Test Suite** | `tests/security` | ✅ Complete | M5 | Secret scanning, wallet auth verification, and deliverable upload tests (**199 tests**) |
| **Database & Migrations**| `apps/api/prisma` | ✅ Complete | M2 | 8 Prisma models, 6 migrations, SQLite immutability triggers (SEC-002), and `paymentMode` column |
| **Web Frontend** | `apps/web` | ⚪ Queued | M4 | Client and freelancer UI interface |
| **Smart Contracts** | `contracts` | ⚪ Queued | M1 | Solidity escrow smart contracts for Arc Testnet |
| **Arc Adapter** | `packages/arc` | 🟡 Mocked | M1 | In-memory `MOCK_ChainAdapter` available; live RPC client integration in progress |
| **0G Adapter** | `packages/og` | 🟡 Stub | M3 | Decentralized storage client stub for deliverables |
| **Evaluation Adapter** | `packages/evaluation` | 🟡 Stub | M3 | 0G AI evaluation adapter interface defined; TAEVA uses built-in deterministic heuristic fallback |

> **Current Monorepo Test Baseline**: **698 tests passing** (0 failed, 0 skipped).  
> **TypeScript Typecheck**: 0 errors across all packages (`pnpm -r exec tsc --noEmit`).  
> **Secret Scanning**: 0 findings across 109 tracked files (`pnpm security:scan`).  
> **Database Check**: 13/13 checks passing (`pnpm --filter @trustora/api db:check`).

---

## 🏗️ Monorepo Structure

```text
TrustOra/
├── apps/
│   ├── api/                     # Fastify REST API, SQLite database & route handlers
│   │   ├── prisma/              # Schema & 6 migrations (with SQLite immutability triggers)
│   │   └── src/
│   │       ├── auth/            # SIWE wallet auth, signed session cookies, user service
│   │       ├── projects/        # Project creation, milestone hashing & agreement lifecycle
│   │       ├── prooftrack/      # ProofTrack route handlers & Prisma event store
│   │       ├── scopeguard/      # ScopeGuard diffing engine & version comparison routes
│   │       ├── taeva/           # TAEVA deliverable validation & advisory AI routes
│   │       ├── trustshield/     # TrustShield reliability & dispute risk analysis routes
│   │       ├── trustreport/     # Unified Trust Report compiler with SHA-256 fingerprint
│   │       ├── app.ts           # Fastify application builder & hook configuration
│   │       ├── db.ts            # Prisma client singleton
│   │       └── server.ts        # Production server entry point
│   └── web/                     # Frontend web application (M4)
├── contracts/                   # Solidity escrow smart contracts (M1)
├── packages/
│   ├── arc/                     # Arc Testnet integration adapter (M1)
│   ├── evaluation/              # AI advisory evaluation adapter (M3)
│   ├── og/                      # 0G decentralized storage client (M3)
│   ├── prooftrack/              # Evidence timeline, deterministic sorting & verification (M2)
│   ├── security/                # Upload validator & wallet auth verification (M5)
│   └── shared/                  # Zod schemas, enums, constants, fixtures, interfaces (M2)
├── docs/                        # Architecture & security blueprints
├── scripts/                     # Automated secret scanner (scripts/secret-scan.mjs)
├── tests/security/              # Security integration tests (M5)
├── pnpm-workspace.yaml          # Monorepo workspace configuration
├── package.json                 # Workspace root scripts
└── tsconfig.base.json           # Common TypeScript configuration
```

---

## 🚀 Completed Capabilities (In-Depth)

### 1. Payment Modes & Optional Escrow (`apps/api`, `packages/shared`)
- **Dual Payment Modes**:
  - `ARC_ESCROW`: Retains smart contract escrow on Arc Testnet.
  - `EXTERNAL_PAYMENT`: Allows tracking agreements, criteria, submissions, evaluations, and scope history without locking USDC in a smart contract.
- **Default Compatibility**: Projects default to `ARC_ESCROW` when `paymentMode` is omitted, guaranteeing 100% backwards compatibility with all existing tests and contracts.
- **Base-Unit Precision**: Token amounts are strictly validated as positive integer strings with no leading zeros (e.g., `50000000` = 50.00 USDC).

### 2. TAEVA – Trustora Adaptive Evidence Verification Algorithm (`apps/api/src/taeva`)
- **Deterministic Proof Checks**:
  - Verifies deliverable SHA-256 payload integrity against stored hashes.
  - Compares submission timestamps against milestone deadlines (`deadlineMet`).
  - Validates that the active agreement version is dual-signed (`clientAcceptedAt` and `freelancerAcceptedAt`).
  - Verifies explicit freelancer AI consent (`aiConsentGranted`).
- **Advisory AI Assessment**:
  - Extracts criteria strings from canonical agreement terms.
  - Connects to `EvaluationAdapter` (0G inference) when connected/verified.
  - Uses an explainable deterministic heuristic fallback when unconfigured.
  - Assigns each criterion a status: `PASS`, `PARTIAL`, `FAIL`, or `UNABLE_TO_ASSESS`.
  - Always enforces `isAdvisory: true` (AI cannot independently release or refund funds).
- **Audit Integration**: Automatically records an `EVALUATION_COMPLETED` event in ProofTrack with `referenceType: "INFERENCE_REQUEST_ID"` and `ecosystem: "ZERO_G"`.

### 3. ScopeGuard – Scope Change Detection (`apps/api/src/scopeguard`)
- **Version Diffing**: Compares criteria and parameters between any two agreement versions (e.g., version $N$ vs $N+1$).
- **Granular Change Detection**:
  - Milestones: `ADDED`, `REMOVED`, `MODIFIED`, `UNCHANGED`.
  - Criteria: `ADDED`, `REMOVED`, `UNCHANGED`.
  - Timeline Shift: Calculates milestone deadline shifts in days.
  - Budget Shift: Calculates signed base-unit deltas (`amountDeltaBaseUnits`).
- **Explainable Risk Assessment**:
  - Computes `timelineRisk` (`LOW`, `MEDIUM`, `HIGH`) and `costRisk` (`LOW`, `MEDIUM`, `HIGH`).
  - Highlights dual approval status (`clientAccepted`, `freelancerAccepted`, `isFullyAccepted`).
  - Never overwrites past agreements—preserves immutable history.

### 4. TrustShield – Reliability & Risk Analysis (`apps/api/src/trustshield`)
- **Multi-Factor Risk Scoring**:
  - `deadlineAdherence`: Identifies past-deadline uncompleted milestones.
  - `scopeVolatility`: Evaluates agreement churn and excessive renegotiation.
  - `submissionHistory`: Detects deliverable revision cycles and repeated rejections.
  - `disputeHistory`: Flags active disputes on projects or milestones.
- **Explainability**: Every risk factor includes human-readable rationale and metrics.
- **Strict Guardrail**: Indicators are heuristics to assist human judgment; they never trigger automated penalties or fund movements.

### 5. ProofTrack Evidence Timeline (`packages/prooftrack` & `apps/api/src/prooftrack`)
- **5 Core Event Types**: `MILESTONE_FUNDED`, `WORK_SUBMITTED`, `EVALUATION_COMPLETED`, `MILESTONE_APPROVED`, `PAYMENT_RELEASED`.
- **Reference-Type Isolation**: Strictly isolates `BLOCKCHAIN_TRANSACTION_HASH`, `INFERENCE_REQUEST_ID`, `STORAGE_REFERENCE`, `APPLICATION_EVENT_ID`, and `FACILITATOR_SETTLEMENT_ID`.
- **Deterministic 3-Tier Ordering**: `occurredAt` → `createdAt` → `id`.
- **Independent Verification**: Re-verifies events against authoritative adapters with 10s cooldown rate limiting.

### 6. Cryptographic Agreements & Database Immutability (`apps/api/src/projects`)
- **Canonical Agreement Hashing**: Deterministic `canonicalJson` (sorted keys, ISO-8601 UTC times) hashed with `SHA-256`.
- **SEC-002 Database Triggers**: SQLite triggers enforce that `AgreementVersion` rows, terms, and acceptance timestamps can never be updated or deleted once committed.

---

## 📡 Complete REST API Reference

All protected endpoints require SIWE session cookies and enforce **SEC-001 Participant Isolation** (outsiders receive `404 NOT_FOUND`).

### Authentication
| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | Public | Server health check (`{"ok": true}`) |
| `POST` | `/auth/nonce` | Public | Generates single-use SIWE nonce |
| `POST` | `/auth/verify-wallet` | Public | Verifies wallet signature and sets session cookie |
| `POST` | `/auth/logout` | Session | Clears session cookie |
| `GET` | `/auth/me` | Session | Returns currently signed-in user |

### Projects & Agreements
| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/projects` | Client | Creates project (`ARC_ESCROW` or `EXTERNAL_PAYMENT`), milestones, and Version 1 |
| `GET` | `/projects` | Participants | Lists projects where caller is client or freelancer |
| `GET` | `/projects/:id` | Participants | Returns project details, payment mode, milestones, and agreement state |
| `POST` | `/projects/:id/agreement/versions` | Participants | Proposes version `N + 1` with reset acceptances |
| `POST` | `/projects/:id/agreement/accept` | Participants | Records caller's acceptance of agreement version |

### ScopeGuard & TAEVA Evaluation
| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/projects/:id/scopeguard` | Participants | Compares agreement versions, returns criteria diffs & risk analysis |
| `POST` | `/projects/:id/milestones/:milestoneId/evaluate` | Participants | Triggers TAEVA evaluation for milestone submission & records ProofTrack event |
| `GET` | `/projects/:id/milestones/:milestoneId/evaluation` | Participants | Returns latest TAEVA evaluation report for milestone |

### TrustShield & Unified Trust Report
| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/projects/:id/trustshield` | Participants | Returns behavioral risk assessment (deadlines, scope churn, revisions, disputes) |
| `GET` | `/projects/:id/trust-report` | Participants | Returns consolidated verifiable trust report with SHA-256 fingerprint |

### ProofTrack Audit Timeline
| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/projects/:id/prooftrack` | Participants | Retrieves timeline (supports `?milestoneId=...`) |
| `POST` | `/projects/:id/prooftrack/verify` | Participants | Re-verifies all evidence for project (10s cooldown) |
| `POST` | `/projects/:id/prooftrack/events/:eventId/verify` | Participants | Re-verifies single evidence event (10s cooldown) |

---

## ⚙️ Quickstart & Verification

### Prerequisites
- **Node.js**: `v22+`
- **pnpm**: `v10+` (`corepack enable pnpm`)

### 1. Setup
```bash
pnpm install
cp .env.example .env
echo DATABASE_URL="file:./dev.db" > apps/api/.env
pnpm --filter @trustora/api exec prisma migrate deploy
```

### 2. Run Test Suite (698 Tests)
```bash
pnpm test                              # All 698 tests must pass
pnpm -r exec tsc --noEmit              # Strict TypeScript check (0 errors)
pnpm security:scan                     # Secret scan across 109 tracked files
pnpm --filter @trustora/api db:check   # Database integrity & trigger tests (13/13)
```

### 3. Start Development Server
```bash
pnpm dev:api
```
Server runs on `http://localhost:3001`.

---

## 👥 Module Ownership & Team Interfaces

- **M1 (`contracts/`, `packages/arc/`)**: Smart contract escrow for `ARC_ESCROW` mode. Implements `EscrowAdapter` from `@trustora/shared`.
- **M2 (`apps/api/`, `packages/shared/`, `packages/prooftrack/`)**: Core backend API, database triggers, TAEVA, ScopeGuard, TrustShield, Trust Report, and ProofTrack engine. *(Current active development area)*
- **M3 (`packages/og/`, `packages/evaluation/`)**: 0G storage client and `EvaluationAdapter` AI inference connector. Must output `requestId` as an `INFERENCE_REQUEST_ID`.
- **M4 (`apps/web/`, README)**: Frontend UI for project creation, ScopeGuard visual diffs, TAEVA evaluation view, TrustShield indicators, and verifiable trust reports.
- **M5 (`packages/security/`, `tests/security/`)**: Secret scanning, SIWE wallet verifier, and upload validator.

---

## 📜 License

Private & proprietary for the ETHGlobal Mumbai hackathon sprint.
