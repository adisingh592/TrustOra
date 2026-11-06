# TrustOra

> **Trust-first freelance escrow platform built for ETHGlobal Mumbai.**  
> Powered by smart contract escrows on Arc Testnet, decentralized milestone proof storage, and automated evaluation.

---

## 🌟 Overview

Freelancing often suffers from payment friction, unilateral chargebacks, and milestone disputes. **TrustOra** introduces a transparent, trust-minimized escrow protocol that protects both clients and freelancers:

- **Smart Contract Escrow**: Client funds are locked in an immutable escrow contract on the **Arc Testnet** using USDC.
- **Proof-of-Work Verification**: Freelancer submissions and milestone deliverables are hashed, tracked, and stored immutably.
- **Multi-Service Integration**:
  - **Arc Testnet**: Low-latency, EVM-compatible settlement with native USDC escrow.
  - **0G (ZeroGravity)**: High-throughput decentralized storage for milestone deliverables and proofs.
  - **ProofTrack & Evaluation**: Objective milestone verification and criteria scoring.
  - **Hedera / x402 (Stretch)**: Automated agentic payments and facilitator infrastructure.

---

## 📊 Project Status & Progress

| Component | Path | Status | Owner | Description |
| :--- | :--- | :---: | :---: | :--- |
| **Monorepo Workspace** | Root | ✅ Ready | All | `pnpm` workspaces, TypeScript base configs, CI scripts |
| **Backend API** | `apps/api` | 🟡 Active | M2 | Fastify v5 server, `/health` endpoint, SQLite/Prisma scaffold |
| **Web Frontend** | `apps/web` | ⚪ Queued | M4 | Client and freelancer web interface |
| **Smart Contracts** | `contracts` | ⚪ Queued | M1 | Solidity escrow contracts for Arc Testnet |
| **Shared Contracts** | `packages/shared` | 🟡 Active | M2 | Global constants (`CHAIN_ID`, `USDC_DECIMALS`), shared DTOs & schemas |
| **Arc Adapter** | `packages/arc` | ⚪ Stub | M1 | Arc RPC client, contract interactions, event listeners |
| **ProofTrack** | `packages/prooftrack`| ⚪ Stub | M2 | Milestone deliverable hashing and proof tracking |
| **0G Adapter** | `packages/og` | ⚪ Stub | M3 | Decentralized storage adapter for 0G upload/download |
| **Evaluation** | `packages/evaluation` | ⚪ Stub | M3 | Automated deliverable evaluation and review scoring |
| **Security** | `packages/security` | ⚪ Stub | M5 | Security middleware, validation guards, and audit rules |

---

## 🏗️ Repository Architecture

This repository is organized as a unified monorepo managed with **pnpm** and **TypeScript**:

```text
TrustOra/
├── apps/
│   ├── api/                 # Fastify REST API & backend services (Prisma + SQLite)
│   └── web/                 # Next.js / React frontend application
├── contracts/               # Solidity escrow & milestone smart contracts
├── packages/
│   ├── arc/                 # Arc Testnet integration & contract SDK
│   ├── evaluation/          # Automated deliverable verification & scoring
│   ├── og/                  # 0G (ZeroGravity) decentralized storage client
│   ├── prooftrack/          # Milestone submission & proof-of-work tracking
│   ├── security/            # Security validation, rate limits, signature checks
│   └── shared/              # Shared types, Zod schemas, constants, and utilities
├── docs/                    # Architecture blueprints and team specs
├── tests/                   # Integration and end-to-end security test suites
├── pnpm-workspace.yaml      # Monorepo workspace configuration
├── package.json             # Root scripts and dev dependencies
└── tsconfig.base.json       # Common TypeScript configuration
```

---

## ⚙️ Quickstart & Setup

### Prerequisites

- **Node.js**: `v20+` or `v22+` recommended
- **pnpm**: `v10+` (`corepack enable pnpm`)

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Copy the root `.env.example` and create a local database configuration for the API:

```bash
# Copy root env template
cp .env.example .env

# Set up local SQLite database for apps/api
echo DATABASE_URL="file:./dev.db" > apps/api/.env
```

### 3. Run Tests

Execute unit and integration tests across all workspace packages:

```bash
pnpm test
```

### 4. Run Local Development Server

Start the Fastify API in live-reload watch mode:

```bash
pnpm dev:api
```

The API will be accessible at:
- **Health check**: `http://localhost:3001/health` (returns `{"ok": true}`)

---

## 🌐 Network Specifications (Arc Testnet)

TrustOra is currently configured for **Arc Testnet**:

| Parameter | Value |
| :--- | :--- |
| **Network Name** | Arc Testnet |
| **Chain ID** | `5042002` |
| **USDC Decimals** | `6` (all token amounts handled as base units) |
| **Target Scope** | Testnet only (Mainnet is strictly out of scope for hackathon) |

---

## 👥 Team & Ownership

As documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):

| Member | Ownership Area |
| :--- | :--- |
| **M1** | `contracts`, `packages/arc` |
| **M2** | `apps/api`, `packages/shared`, `packages/prooftrack` |
| **M3** | `packages/og`, `packages/evaluation` |
| **M4** | `apps/web`, `README.md` |
| **M5** | `packages/security`, `tests/security` |

---

## 📜 License

Private & proprietary for ETHGlobal Mumbai hackathon sprint.
