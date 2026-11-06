# TRUSTORA — Arc Migration & Architecture Alignment

**Document Purpose:** Detail the transition from legacy Whitechain merchant checkout concepts to Arc Testnet smart-contract escrow as TRUSTORA's primary settlement layer.

---

## 1. Why Arc Replaces Whitechain

In earlier iterations (e.g. legacy ProofHire blueprints), Whitechain testnet USDT was explored for simple merchant invoices. However, several critical technical limitations arose:
1. **Lack of Conditional Escrow:** A merchant payment invoice only supports direct merchant checkout. Freelance trust requires **programmable multi-milestone escrow**, where capital is locked in custody pending deliverable verification, with dispute and refund paths.
2. **Native USDC Gas & Ecosystem Fit:** Arc is engineered around Circle's USDC as native gas and institutional-grade settlement. This provides superior UX (no double-token confusion: gas is USDC, escrow is USDC).
3. **Developer Experience & Tooling:** Arc Studio (`studio.arc.io`) and Arc Testnet (Chain ID `5042002`) offer native EVM compatibility, modern block explorers, and fast finality.

**Decision:** Whitechain has been completely decommissioned from the TRUSTORA codebase. All payment and custody logic is implemented natively on Arc Testnet via `TrustoraEscrow.sol`.

---

## 2. Arc Testnet Configuration

```json
{
  "network": "Arc Testnet",
  "chainId": 5042002,
  "rpcUrl": "https://rpc.testnet.arc.io",
  "explorerUrl": "https://explorer.testnet.arc.io",
  "nativeCurrency": {
    "name": "USDC",
    "symbol": "USDC",
    "decimals": 18
  },
  "usdcContractAddress": "0x3600000000000000000000000000000000000000",
  "usdcDecimals": 6,
  "faucetUrl": "https://faucet.circle.com",
  "studioUrl": "https://studio.arc.io"
}
```

---

## 3. Escrow Accounting Invariants

* **Base Units:** USDC ERC-20 token balances on Arc operate with **6 decimals**.
  * `1.00 USDC = 1,000,000 units`
  * `500.00 USDC = 500,000,000 units`
* **Zero Floating-Point Arithmetic:** All balances, milestones, refunds, and releases are processed as `uint256` in base units.
* **Separation of Gas and Token Balances:**
  * While Arc uses USDC as native gas, the escrow contract handles ERC-20 USDC via `IERC20.transferFrom` and `IERC20.transfer`. The user's wallet pays gas fees from their native balance, and deposits the exact milestone amount from their ERC-20 allowance.

---

## 4. Migration Audit & Cleanup Verification

- [x] Identified and removed `whitechain-dev` from `skills-lock.json`.
- [x] Removed all Whitechain RPC references and USDT contract addresses.
- [x] Replaced merchant invoice model with multi-milestone escrow state machine.
- [x] Replaced payment receipt generation with ProofTrack on-chain transaction verifier querying `https://rpc.testnet.arc.io`.

