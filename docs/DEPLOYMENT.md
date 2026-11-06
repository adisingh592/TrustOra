# Local setup and Arc Testnet deployment runbook

The commands below describe operator actions. They were not run as part of the release-readiness audit. No contract deployment or blockchain transaction is performed automatically by the application build.

## Requirements

- Node.js 20.9+ and npm.
- A local SQLite database managed by Prisma.
- Arc Testnet wallet configuration only if an operator later chooses to deploy or transact.

## Environment configuration

Copy a safe example template if one is available, then add local values to ignored `.env` files. Never commit actual credentials. See the root README for variable names and scope.

| Location | Variable | Purpose |
| --- | --- | --- |
| `packages/contracts/.env` | `DEPLOYER_PRIVATE_KEY` | Arc deployer key for explicit deployment commands only |
| `packages/contracts/.env` | `ARC_RPC_URL` | Optional RPC override; defaults to Arc Testnet RPC |
| `packages/contracts/.env` | `ARC_USDC_ADDRESS` | Optional token override, subject to deployment preflight checks |
| `apps/web/.env` | `ESCROW_CONTRACT_ADDRESS` | Deployed escrow address; without it the app cannot perform escrow actions |
| `apps/web/.env` | `ARC_RPC_URL` | Optional server-side read RPC override |
| `apps/web/.env` | `ZG_ROUTER_API_KEY` | Optional 0G Router credential; absent/invalid provider results do not produce a fabricated evaluation |
| `apps/web/.env` | `ZG_ROUTER_BASE_URL`, `ZG_ROUTER_MODEL`, `ZG_ROUTER_TRUST_MODE`, `ZG_ROUTER_PROVIDER_ADDRESS` | Optional router settings supported by the code |

Hedera payment environment variables do not enable live payment execution; that flow is not implemented. SQLite is the development database. No PostgreSQL deployment support is claimed here.

## Install, database, and local app

```bash
npm ci
npm run db:update -w @trustora/web
npm run dev
```

The database updater defaults to a dry run. Review its plan before using its explicit apply command. Do not run `prisma db push --accept-data-loss` against user data.

## Contract checks and optional deployment

```bash
npm run compile:contracts
npm run test:contracts
```

For an operator-authorized testnet deployment only, review `packages/contracts/scripts/deploy.ts`, configure an isolated test wallet locally, run the deployment preflight/dry run, and inspect all checks before invoking `npm run deploy:arc -w @trustora/contracts`. This audit did not deploy or broadcast. Local Hardhat tests use a mock token and do not establish live network behavior.

After an independently verified deployment, configure `ESCROW_CONTRACT_ADDRESS` in the local web environment and restart. The app's configured status means an address is present; it is not a substitute for independently verifying the deployed bytecode and constructor state.

## Current deployment limitations

- No TRUSTORA escrow deployment is currently configured.
- No live Arc transaction has been recorded by this release process.
- 0G live inference has not been verified.
- Hedera x402 settlement execution is not implemented.
- Production database operations, monitoring, trusted-proxy configuration for application throttles, and incident response are not established.
