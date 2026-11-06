# Integration status

**Updated:** 2026-11-06. Status labels describe evidence in this repository, not intended product scope.

| Track | Implemented in code | Test evidence | Live testnet evidence | Status |
| --- | --- | --- | --- | --- |
| **Arc** | Solidity escrow, Arc chain/token configuration, client-side transaction preparation, read-only receipt/event/state verification, deploy scripts | Local Hardhat contract tests; API verification uses mocks | RPC/chain/token configuration was checked read-only; no escrow deployment or transaction was performed | **Implemented locally; not deployed** |
| **0G** | Router client, consent-bound evaluation, strict structured output, request ID accepted only from provider | Mock provider/unit tests | No genuine inference response verified for this release | **Implemented; live use unverified** |
| **Hedera x402** | Header parsing, integer tinybar conversion, policy and Mirror Node helpers, persistent budget reservation primitive | Unit tests with mocked responses | No facilitator/payment execution | **Partial primitives; end-to-end payments not implemented** |
| **ProofTrack** | Event taxonomy/timeline helpers; Arc event verifier checks receipt, contract, event, actors, IDs, and contract state | Unit/API tests with mocked RPC | No live escrow events; no public portal | **Implemented in application; no public verification portal** |

## Arc configuration facts

- Arc Testnet chain ID: `5042002`; configured RPC: `https://rpc.testnet.arc.io`.
- The configured USDC ERC-20 address is `0x3600000000000000000000000000000000000000`, with 6 token decimals. Native gas uses 18-decimal USDC accounting, distinct from ERC-20 amount units.
- The escrow address is not supplied in the repository. The deployment script has not been run for this release. UI/server code disables or rejects chain actions when configuration is absent.
- Local tests use a mock ERC-20 and mocked RPC results. They are not evidence of live escrow deployment or live transaction execution.

## 0G behavior

The application requires explicit consent and a valid provider response. Evaluation reports are advisory. Request IDs, provider/model metadata, and TEE indicators must come from the provider response; the application does not invent them. When credentials or a valid response are unavailable, the evaluation reports `UNABLE_TO_ASSESS` or a mapped error. No live inference was performed for this status report.

## Hedera behavior

There is no operational x402 facilitator client, payer execution, or completed end-to-end settlement flow. A SQLite-backed tinybar reservation helper exists, but it is not connected to a completed settlement path. The coordinator returns unavailable/not configured rather than claiming payment. Mirror Node helpers and unit tests do not constitute a settled payment.

## ProofTrack behavior

Only Arc chain events that pass the application's receipt/log/identity/state checks may be labelled verified. 0G inference identifiers are provider request IDs, not transaction hashes. Application events are not independently verified chain events. A public `/verify` portal is not present.
