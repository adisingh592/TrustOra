# Arc integration and deployment status

Arc is the intended escrow network. The repository contains a Solidity escrow contract and Arc Testnet configuration, but the contract has not been deployed/configured for this release. Local Hardhat tests use a mock ERC-20 and are not live testnet evidence.

## Configured Arc Testnet values

| Setting | Value |
| --- | --- |
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |
| USDC token decimals | 6 |
| Native gas accounting | USDC with 18 decimals |

## Implemented

- `TrustoraEscrow.sol` defines project/milestone registration, funding, deliverable hash anchoring, revision/dispute flow, client release, freelancer refund, and arbiter resolution.
- Contract methods use integer token units. ERC-20 milestone amounts use six decimals; native gas is a separate 18-decimal balance.
- The deployment preflight checks network, key format, configured USDC contract and decimals, RPC, and funding before deployment.
- Application transaction preparation is client-side. Server routes independently verify transaction receipts, contract logs, actors, identifiers, and on-chain state before updating corresponding application records.
- Local Hardhat tests cover contract transitions and authorization. API tests use mocked RPC/contract responses.

## Not completed / not claimed

- No TRUSTORA escrow deployment address or deployment transaction is checked in.
- No live project funding, release, refund, or dispute transaction was performed for this status.
- Arc Studio workspace setup is not required by the source code and is not evidence of deployment.
- The client is not a multisig. The contract owner is the arbiter and can pause; configure that trust role deliberately before any testnet deployment.

## Deployment is an operator action

The scripts can deploy only when an operator explicitly invokes them with local configuration. Do not commit a private key. Review [DEPLOYMENT.md](./DEPLOYMENT.md), run the dry-run preflight first, and verify the deployed contract address and source before configuring the web application. Deployment and transactions were not run as part of this audit.
