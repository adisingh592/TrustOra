# TRUSTORA — Build Checklist

Status indicators:
* `[ ]` Not started
* `[~]` In progress
* `[x]` Completed
* `[!]` Blocked
* `[-]` Deferred

---

## Phase 1: Repository Inspection & Architecture
- [x] Inspect existing workspace and preserve prior working modules (`packages/og`, `packages/evaluation`)
- [x] Verify removal of Whitechain dependencies (`skills-lock.json` Whitechain references eliminated)
- [x] Initialize clean Git repository and ignore build artifacts
- [x] Create foundational documentation suite in `docs/`:
  - [x] `docs/PROJECT_STATUS.md`
  - [x] `docs/BUILD_CHECKLIST.md`
  - [x] `docs/ARCHITECTURE.md`
  - [x] `docs/SECURITY.md`
  - [x] `docs/INTEGRATION_STATUS.md`
  - [x] `docs/COMPETITIVE_ANALYSIS.md`
  - [x] `docs/DEMO_SCRIPT.md`
  - [x] `docs/ARC_MIGRATION.md`

---

## Phase 2: Arc Studio & Custom Escrow Contract
- [ ] Implement `TrustoraEscrow.sol`:
  - [ ] Support project escrow creation with multi-milestone structure
  - [ ] Dedicated USDC (6 decimals) funding via SafeERC20
  - [ ] Strict roles: Client, Freelancer, Arbiter / Admin
  - [ ] Funding state tracking & verification
  - [ ] Freelancer submission & client approval workflow
  - [ ] Revision request & dispute initiation
  - [ ] Conditional release and refund logic
  - [ ] Reentrancy protection (`ReentrancyGuard`) and Pausable
  - [ ] Non-releasable by AI guarantee: enforce that AI cannot trigger release
  - [ ] Comprehensive event emission for ProofTrack indexing
- [ ] Hardhat environment setup:
  - [ ] `hardhat.config.ts` configured for Arc Testnet (Chain ID 5042002)
  - [ ] Unit & integration tests for all escrow state transitions
  - [ ] Gas reporting and fee requirement compliance

---

## Phase 3: Arc Testnet Deployment & USDC Funding
- [ ] Arc Studio workspace preparation & project configuration
- [ ] Deploy `TrustoraEscrow.sol` to Arc Testnet
- [ ] Record contract address and deployment transaction hash
- [ ] Verify contract on Arc Testnet Explorer (`explorer.testnet.arc.io`)
- [ ] Implement on-chain transaction verification utility in backend

---

## Phase 4: Frontend, Backend & Database
- [ ] Next.js 15 App Router setup with TypeScript and Tailwind CSS
- [ ] Prisma schema with PostgreSQL / SQLite support:
  - [ ] User, Wallet, Project, AgreementVersion, Milestone, Submission, Evaluation, AgentPayment, ProofTrackEvent
- [ ] Wallet connection via Wagmi / Viem configured for Arc Testnet
- [ ] Client Dashboard (Project creation, milestone funding, approval, dispute)
- [ ] Freelancer Dashboard (Project acceptance, work submission, revision review)
- [ ] Shared UI components (shadcn/ui style, accessible, responsive)

---

## Phase 5: Agreement Intelligence & Submission Workflow
- [ ] Natural-language project scope to structured acceptance criteria generator
- [ ] Dual-party agreement acceptance mechanism
- [ ] Scope change detection and agreement versioning
- [ ] Deterministic criteria hashing and freezing
- [ ] Work deliverable upload and hashing (SHA-256)

---

## Phase 6: 0G Inference & AI Evaluation
- [ ] Integrate existing `packages/og` router & compute client
- [ ] Connect `packages/evaluation` ProofScore evaluator
- [ ] Enforce strict prompt boundary isolation and anti-injection defenses
- [ ] Capture genuine 0G inference request IDs and latency
- [ ] Structured evaluation reports (PASS / PARTIAL / FAIL / UNABLE_TO_ASSESS)
- [ ] Advisory banner: "AI advice only — cannot independently release escrow funds"
- [ ] Graceful fallback handling with transparent offline reporting

---

## Phase 7: Hedera x402 Autonomous Agent Payments
- [ ] Policy engine for autonomous agent payments
- [ ] Allowlist verification for approved micro-service providers
- [ ] Hard spending caps per evaluation and daily limits
- [ ] x402 payment challenge handling and settlement verification
- [ ] Record Hedera transaction IDs and HashScan links
- [ ] Graceful degradation and documented status if live testnet keys unavailable

---

## Phase 8: Trustora ProofTrack
- [ ] Unique project identifier generator (`TRU-PROJ-YYYY-NNNNNNN`)
- [ ] Multi-ecosystem event correlator:
  - [ ] `BLOCKCHAIN_TRANSACTION_HASH` (Arc)
  - [ ] `INFERENCE_REQUEST_ID` (0G)
  - [ ] `STORAGE_REFERENCE` (0G / IPFS)
  - [ ] `FACILITATOR_SETTLEMENT_ID` (Hedera)
  - [ ] `APPLICATION_EVENT_ID`
- [ ] Public Verification Portal (`/verify/[projectId]`)
- [ ] Interactive timeline visualization with deep explorer links

---

## Phase 9: UI Polish & End-to-End Testing
- [ ] End-to-end user journey test:
  1. Client creates project
  2. Freelancer accepts agreement
  3. Client funds Arc escrow
  4. Freelancer submits work
  5. 0G evaluates deliverable
  6. Client reviews evaluation & approves
  7. Arc releases escrow payment
  8. ProofTrack displays verified audit trail
- [ ] Mobile and tablet responsiveness check
- [ ] Empty states, loading skeletons, and error boundaries

---

## Phase 10: Submission Preparation
- [ ] Comprehensive README.md with architecture diagrams & sponsor tracks
- [ ] Verified live transaction hashes and explorer links
- [ ] Demo video script and presentation walkthrough
- [ ] Clean repository with zero secrets committed

