# TrustOra

> **Trust-first freelance escrow platform built for ETHGlobal Mumbai 2026.**  
> Powered by smart contract escrows on Arc Testnet, decentralized milestone proof tracking, and automated evaluation.

---

## 🌟 Overview

Freelancing often suffers from payment friction, unilateral chargebacks, and milestone disputes. **TrustOra** provides a trust-minimized, evidence-backed escrow protocol:

- **Smart Contract Escrow**: Client funds are locked in an immutable escrow contract on the **Arc Testnet** using USDC (6 decimals, base-unit string precision).
- **Cryptographic Milestone Agreements**: Multi-party terms (client, freelancer, arbiter) are hashed using canonical JSON (`SHA-256`) and protected by database triggers.
- **ProofTrack Audit Timeline**: An independent evidence ledger verifying on-chain transactions, 0G AI evaluations, and deliverable submissions before marking anything `VERIFIED`.
- **Multi-Service Architecture**:
  - **Arc Testnet**: EVM-compatible settlement with native USDC escrow (`Chain ID: 5042002`).
  - **0G (ZeroGravity)**: High-throughput decentralized storage and AI evaluation inference.
  - **Hedera / x402 (Stretch)**: Automated agentic payments and facilitator infrastructure.

---

## 📊 Project Status & Implementation Matrix

| Component | Path | Status | Owner | What Is Actually Done |
| :--- | :--- | :---: | :---: | :--- |
| **Monorepo Workspace** | Root | ✅ Complete | All | `pnpm` workspaces, unified TypeScript configs, CI hooks, and secret scanning |
| **Shared Library** | `packages/shared` | ✅ Complete | M2 | Zod input/output schemas, enums, DTOs, network constants, adapter interfaces, and fixtures (79 tests) |
| **Backend API** | `apps/api` | ✅ Complete | M2 | Fastify v5 server, Prisma 6 + SQLite database, wallet auth, project agreements, and ProofTrack endpoints (222 tests) |
| **ProofTrack Engine** | `packages/prooftrack` | ✅ Complete | M2 | Audit timeline, reference-type isolation, deterministic 3-tier ordering, Arc chain verifier, and status transitions (163 tests) |
| **Security Module** | `packages/security` | ✅ Complete | M5 | SIWE wallet verifier, deliverable upload validator, and sensitive data sanitization |
| **Security Test Suite** | `tests/security` | ✅ Complete | M5 | Secret scanning, wallet auth verification, and deliverable upload tests (199 tests) |
| **Database & Migrations**| `apps/api/prisma` | ✅ Complete | M2 | 8 Prisma models, 5 migrations, and SQLite triggers enforcing terms immutability |
| **Web Frontend** | `apps/web` | ⚪ Queued | M4 | Client and freelancer UI interface |
| **Smart Contracts** | `contracts` | ⚪ Queued | M1 | Solidity escrow smart contracts for Arc Testnet |
| **Arc Adapter** | `packages/arc` | ⚪ Stub | M1 | Arc RPC client and contract interaction SDK |
| **0G Adapter** | `packages/og` | ⚪ Stub | M3 | Decentralized storage client for deliverables |
| **Evaluation Adapter** | `packages/evaluation` | ⚪ Stub | M3 | AI deliverable evaluation and review scoring |

---

## 🏗️ Repository Architecture

Managed with **pnpm 10** and **TypeScript 5+**:

```text
TrustOra/
├── apps/
│   ├── api/                     # Fastify REST API, database & route handlers
│   │   ├── prisma/              # Schema & migrations (with SQLite immutability triggers)
│   │   └── src/
│   │       ├── auth/            # SIWE wallet auth, signed session cookies, user service
│   │       ├── projects/        # Project creation, milestone hashing & agreement lifecycle
│   │       ├── prooftrack/      # ProofTrack route handlers & Prisma event store
│   │       ├── app.ts           # Fastify application builder & hook configuration
│   │       ├── db.ts            # Prisma client singleton
│   │       └── server.ts        # Production server entry point
│   └── web/                     # Frontend web application
├── contracts/                   # Solidity escrow smart contracts
├── packages/
│   ├── arc/                     # Arc Testnet integration adapter
│   ├── evaluation/              # AI advisory evaluation adapter
│   ├── og/                      # 0G decentralized storage client
│   ├── prooftrack/              # Evidence timeline, deterministic sorting & verification
│   │   ├── src/
│   │   │   ├── events.ts        # Event input validation & normalization
│   │   │   ├── ordering.ts      # 3-tier deterministic event sorting
│   │   │   ├── timeline.ts      # Sanitized timeline building & milestone filtering
│   │   │   ├── verification.ts  # Verification outcome & status transition engine
│   │   │   ├── chainVerifier.ts # Arc on-chain transaction & escrow verifier
│   │   │   ├── rules.ts         # Ecosystem / reference-type constraints
│   │   │   ├── core.ts          # ProofTrack orchestrator
│   │   │   └── mocks.ts         # In-memory test doubles
│   │   └── tests/               # ProofTrack unit & integration test suites
│   ├── security/                # Upload validator & wallet auth verification
│   └── shared/                  # Zod schemas, enums, constants, fixtures, interfaces
├── docs/                        # Architecture & security blueprints (docs/SECURITY.md)
├── scripts/                     # Automated secret scanner (scripts/secret-scan.mjs)
├── tests/security/              # Security integration tests
├── pnpm-workspace.yaml          # Monorepo workspace configuration
├── package.json                 # Workspace root scripts
└── tsconfig.base.json           # Common TypeScript configuration
```

---

## 🚀 What Has Been Built (In-Depth)

### 1. Cryptographic Wallet Authentication (`apps/api/src/auth`)
- **SIWE / EIP-4361 Protocol**: Generates cryptographically secure, single-use nonces stored with atomic consumption (`POST /auth/nonce`).
- **Signature Verification**: Validates wallet signatures via `viem` and issues HMAC-signed, HTTP-only session cookies (`POST /auth/verify-wallet`).
- **Session Lifecycle**: Introspection (`GET /auth/me`) and cookie revocation (`POST /auth/logout`).
- **`requireUser` Hook**: Enforces authentication on private routes while redacting sensitive tokens and signatures from logs.
- **SEC-001 Hardening**: Normalizes all addresses to lowercase in a unified write path (`apps/api/src/auth/users.ts`).

### 2. Project & Agreement Engine (`apps/api/src/projects`)
- **Project Creation (`POST /projects`)**: Creates projects with standard public identifiers (`TRU-PROJ-2026-NNNNNNN`), participant wallets (client, freelancer, arbiter), positive base-unit USDC amounts (no floats/decimals, max 1B USDC), and 1–10 milestones.
- **On-chain Milestone IDs**: Generates unique `0x`-prefixed 64-hex bytes32 keys using `keccak256(toBytes(milestoneId))` stored directly on the milestone.
- **Canonical Agreement Hashing**: Deterministic `canonicalJson` (alphabetically sorted keys, preserved array order, normalized ISO-8601 UTC deadlines) hashed with `SHA-256`.
- **Atomic Operations**: Participant user upserting, project creation, milestones, and Agreement Version 1 run inside a single `prisma.$transaction`.
- **Multi-Party Acceptance (`POST /projects/:id/agreement/accept`)**: Client and freelancer independently accept agreements; status advances to `AGREED` only when both sign off on the latest version.
- **Renegotiation (`POST /projects/:id/agreement/versions`)**: Allows proposing version `N + 1` with reset acceptances while terms are uncommitted (`DRAFT`/`AGREED`), locked once funded.
- **SEC-002 Immutability**: Database triggers enforce that terms, hashes, and accepted timestamps on `AgreementVersion` can never be edited or deleted.

### 3. ProofTrack Evidence Timeline (`packages/prooftrack` & `apps/api/src/prooftrack`)
- **5 Core Event Types**:
  1. `MILESTONE_FUNDED` (Arc blockchain transaction)
  2. `WORK_SUBMITTED` (Deliverable submission proof)
  3. `EVALUATION_COMPLETED` (0G AI advisory evaluation)
  4. `MILESTONE_APPROVED` (Client milestone sign-off)
  5. `PAYMENT_RELEASED` (Arc escrow payout transaction)
- **Reference-Type Isolation**: Strict partitioning preventing reference cross-casting:
  - `BLOCKCHAIN_TRANSACTION_HASH`
  - `INFERENCE_REQUEST_ID`
  - `STORAGE_REFERENCE`
  - `APPLICATION_EVENT_ID`
  - `FACILITATOR_SETTLEMENT_ID`
- **Deterministic 3-Tier Ordering**: `occurredAt` (event timestamp) → `createdAt` (recording timestamp) → `id` (lexicographical tie-breaker).
- **Verification Engine**:
  - `PENDING`: Recorded, awaiting check.
  - `VERIFIED`: Independently confirmed against authoritative source.
  - `FAILED`: Inconsistent or failed evidence.
  - `BLOCKED`: Required integration or RPC unavailable.
- **Arc Chain Verifier (`createChainVerifier`)**: Inspects transaction receipt, contract target, milestone ID, amount base units, token address, and agreement hash.
- **Timeline APIs**:
  - `GET /projects/:id/prooftrack`: Retrieves timeline with optional milestone filtering (`?milestoneId=...`).
  - `POST /projects/:id/prooftrack/verify`: Re-checks all project evidence with rate-limit protection (1 call per 10s).
  - `POST /projects/:id/prooftrack/events/:eventId/verify`: Targets an individual event for re-check.

### 4. Database Architecture & SQLite Triggers
- **8 Models**: `User`, `AuthNonce`, `Project`, `Milestone`, `AgreementVersion`, `Submission`, `Evaluation`, `ProofEvent`.
- **Triggers**:
  - `AgreementVersion_terms_immutable`: Forbids altering terms or hashes.
  - `AgreementVersion_no_delete`: Forbids deleting version rows.
  - `AgreementVersion_client_acceptance_final` & `freelancer_acceptance_final`: Forbids modifying or clearing acceptance timestamps once recorded.
- **Integrity Validation**: Script `db:check` validates connections, uniqueness, foreign keys, triggers, and string amount fidelity against scratch databases.

---

## 📡 REST API Reference

| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | Public | Server health check (`{"ok": true}`) |
| `POST` | `/auth/nonce` | Public | Generates single-use SIWE nonce |
| `POST` | `/auth/verify-wallet` | Public | Verifies wallet signature and sets session cookie |
| `POST` | `/auth/logout` | Session | Clears session cookie |
| `GET` | `/auth/me` | Session | Returns currently signed-in user |
| `POST` | `/projects` | Client | Creates project, milestones, and Agreement Version 1 |
| `GET` | `/projects` | Participants | Lists projects where caller is client or freelancer |
| `GET` | `/projects/:id` | Participants | Returns project details, milestones, and agreement state |
| `POST` | `/projects/:id/agreement/versions` | Participants | Proposes version `N + 1` with reset acceptances |
| `POST` | `/projects/:id/agreement/accept` | Participants | Records caller's acceptance of the latest version |
| `GET` | `/projects/:id/prooftrack` | Participants | Retrieves timeline (supports `?milestoneId=...`) |
| `POST` | `/projects/:id/prooftrack/verify` | Participants | Re-verifies all evidence for a project (10s cooldown) |
| `POST` | `/projects/:id/prooftrack/events/:eventId/verify` | Participants | Re-verifies a single event (10s cooldown) |

---

## ⚙️ Quickstart & Local Setup

### Prerequisites
- **Node.js**: `v22+`
- **pnpm**: `v10+` (`corepack enable pnpm`)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment
```bash
# Copy root env template
cp .env.example .env

# Set up local SQLite database for apps/api
echo DATABASE_URL="file:./dev.db" > apps/api/.env

# Run database migrations
pnpm --filter @trustora/api exec prisma migrate deploy
```

### 3. Verification & Test Suite
All 663 tests must pass cleanly:
```bash
pnpm test                              # Run all test suites across the monorepo
pnpm -r exec tsc --noEmit              # Strict TypeScript typechecking
pnpm security:scan                     # Secret scanner on tracked files
pnpm --filter @trustora/api db:check   # Database integrity & trigger tests
```

### 4. Start Development Server
```bash
pnpm dev:api
```
The API server starts on `http://localhost:3001`.

---

## 🌐 Network Specifications (Arc Testnet)

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Arc Testnet |
| **Chain ID** | `5042002` |
| **USDC Decimals** | `6` (all token amounts handled strictly as base-unit strings) |
| **Scope** | Testnet only (Mainnet is strictly out of scope) |

---

## 👥 Team Ownership

As defined in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):

| Member | Ownership Area |
| :--- | :--- |
| **M1** | `contracts`, `packages/arc` |
| **M2** | `apps/api`, `packages/shared`, `packages/prooftrack` |
| **M3** | `packages/og`, `packages/evaluation` |
| **M4** | `apps/web`, `README.md` |
| **M5** | `packages/security`, `tests/security` |

---

## 📜 License

Private & proprietary for the ETHGlobal Mumbai hackathon sprint.
