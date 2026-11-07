# Local setup and Arc Testnet deployment runbook

The commands below describe operator actions. They were not run as part of the release-readiness audit. No contract deployment or blockchain transaction is performed automatically by the application build.

## Requirements

- Node.js 20.9+ and npm.
- A Postgres database managed by Prisma (local Postgres, or any hosted instance — Vercel Postgres, Neon, Supabase, etc.).
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
| `apps/web/.env` | `POSTGRES_PRISMA_URL` | Pooled Postgres connection string Prisma uses at runtime |
| `apps/web/.env` | `POSTGRES_URL_NON_POOLING` | Direct (non-pooled) Postgres connection string Prisma uses for `migrate deploy` |

Hedera payment environment variables do not enable live payment execution; that flow is not implemented. Postgres is both the development and production database (`apps/web/prisma/schema.prisma`); there is no SQLite fallback.

## Install, database, and local app

```bash
npm ci
npm run db:push -w @trustora/web   # or: npx prisma migrate dev -w @trustora/web
npm run dev
```

`db:push` syncs the schema to whatever Postgres instance `POSTGRES_PRISMA_URL`/`POSTGRES_URL_NON_POOLING` point at — use a local or disposable dev database, not production. `scripts/db-safe-update.mjs` (`npm run db:update`) was written for the old SQLite file and does not work against Postgres; prefer `prisma migrate dev` for tracked schema changes going forward.

## Contract checks and optional deployment

```bash
npm run compile:contracts
npm run test:contracts
```

For an operator-authorized testnet deployment only, review `packages/contracts/scripts/deploy.ts`, configure an isolated test wallet locally, run the deployment preflight/dry run, and inspect all checks before invoking `npm run deploy:arc -w @trustora/contracts`. This audit did not deploy or broadcast. Local Hardhat tests use a mock token and do not establish live network behavior.

After an independently verified deployment, configure `ESCROW_CONTRACT_ADDRESS` in the local web environment and restart. The app's configured status means an address is present; it is not a substitute for independently verifying the deployed bytecode and constructor state.

## Deploying apps/web to Vercel

The web app is the only piece deployed to Vercel; `packages/contracts` (Hardhat) and `reference/api-fastify` are not part of this deploy.

1. **Import the repo** in the Vercel dashboard. Vercel detects the npm workspaces at the repo root.
2. **Project Settings → General → Root Directory**: set it to `apps/web`. In the same section, enable **"Include files outside of the Root Directory in the Build Step"** — `apps/web/src/lib/*` imports `../../packages/*` by relative path, and the build needs to see them.
3. **Storage → Create Database → Postgres**: create a database and connect it to this project. This sets `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` for you in Production, Preview, and Development automatically.
4. **Project Settings → Environment Variables**: add the rest from the table above as needed — at minimum `ESCROW_CONTRACT_ADDRESS` and `ARC_RPC_URL` if escrow actions should work; `ZG_ROUTER_*` only if a genuine 0G Router evaluation is wired up. Leave anything you don't have blank rather than inventing a value.
5. **Deploy.** The build runs `prisma generate && prisma migrate deploy && next build` (see `apps/web/package.json`), which applies `apps/web/prisma/migrations/` to whatever Postgres the environment points at before building. The first deploy creates all tables from the baseline migration; there is no existing production data to lose.
6. **Verify**: open the deployed URL, register a wallet, create a project. If registration/auth fails, check the Vercel function logs — the most common cause is a missing or malformed `POSTGRES_PRISMA_URL`/`POSTGRES_URL_NON_POOLING`.

This gets the app running on Vercel with a real, persistent, concurrency-safe database. It does **not** by itself satisfy the "Production deployment blockers" in the root README (monitoring, backups, 0G/Hedera live integration, independent contract verification, security review) — those remain separate, explicit decisions for an operator to make.

## Current deployment limitations

- No TRUSTORA escrow deployment is currently configured.
- No live Arc transaction has been recorded by this release process.
- 0G live inference has not been verified.
- Hedera x402 settlement execution is not implemented.
- Monitoring, trusted-proxy configuration for application throttles, database backups, and incident response are not established.
