# TRUSTORA — Integration Status

**Last Updated:** November 6, 2026

---

## 1. Ecosystem Overview

| Ecosystem | Role | Network / Target | Integration Path | Status | Notes |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Arc** | Primary Escrow & Milestone Settlement | Arc Testnet (5042002) | Custom `TrustoraEscrow.sol` via Viem/Ethers & Arc Studio | [~] | Contract drafted; local tests and Arc testnet deployment in progress |
| **0G** | AI Deliverable Evaluation | 0G Testnet (Private Computer / Router) | Router REST API (`router-api-testnet.integratenetwork.work/v1`) | [x] | Client & evaluation engine complete with injection guards & test coverage |
| **Hedera** | Autonomous AI Agent Payments | Hedera Testnet | x402 HTTP challenge handler with Mirror Node settlement check | [~] | Policy engine & allowlist defined; settlement verification harness ready |
| **ProofTrack** | Evidence Correlation Timeline | Cross-Ecosystem | Application correlation engine & public verification page | [~] | Event models and correlation logic drafted |

---

## 2. Arc Testnet Details

* **Network Name:** Arc Testnet
* **Chain ID:** `5042002`
* **RPC Endpoint:** `https://rpc.testnet.arc.io`
* **Block Explorer:** `https://explorer.testnet.arc.io`
* **USDC ERC-20 Token:** `0x3600000000000000000000000000000000000000`
* **Decimals:** `6`
* **Native Gas:** `USDC`
* **Arc Studio:** `https://studio.arc.io`
* **Faucet:** `https://faucet.circle.com`
* **Gas Accounting:** Arc Testnet uses USDC natively for gas. Contract operations that transfer USDC ERC-20 operate via standard `IERC20.transferFrom` and `IERC20.transfer` with 6-decimal precision.

---

## 3. 0G Evaluation Details

* **Primary Endpoint:** `https://router-api-testnet.integratenetwork.work/v1`
* **Headers:** `Authorization: Bearer <ZG_ROUTER_API_KEY>`, `verify_tee: true`
* **Response Tracing:** Parses `ZG-Res-Key`, `x_0g_trace.request_id`, `x_0g_trace.provider`, `x_0g_trace.tee_verified`.
* **Honest Health Reporting:**
  * `NOT_CONFIGURED`: API key missing.
  * `CONFIGURED`: Base URL and key configured.
  * `CONNECTED`: Genuine test inference call succeeded.
  * `UNAVAILABLE`: Remote endpoint returned 5xx / timeout.
* **Fallback Behavior:** If 0G endpoint is unavailable, evaluation safely halts with `UNABLE_TO_ASSESS` or clear diagnostic error; never fabricates fake inference IDs.

---

## 4. Hedera x402 Details

* **Scheme:** `exact`
* **Network:** `hedera:testnet`
* **Asset:** `0.0.0` (Native HBAR)
* **Allowlist:** Regulated micro-inspection endpoints.
* **Policy Constraints:**
  * Max 5 HBAR / request.
  * Maximum daily budget: 25 HBAR.
* **Verification:** Hedera Mirror Node transaction lookup (`https://testnet.mirrornode.hedera.com/api/v1/transactions/{id}`).

