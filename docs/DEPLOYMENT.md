# TRUSTORA: Arc Testnet deployment runbook

Everything here is safe to run in order. Each step that can fail does so **before** anything irreversible happens and says so.
Nothing in this repo deploys or sends a transaction on its own.

## 1. Environment variables

Names only. Put real values in the untracked `.env` files; never commit them.

| File | Variable | Needed for | Notes |
|---|---|---|---|
| `packages/contracts/.env` | `DEPLOYER_PRIVATE_KEY` | deploying | 32-byte hex. A **throwaway testnet key**, never a real-funds key. Malformed values are ignored and never printed. |
| | `ARC_RPC_URL` | optional | defaults to `https://rpc.testnet.arc.io` |
| | `ARC_USDC_ADDRESS` | optional | defaults to Arc's official USDC `0x3600…0000`. Anything else is refused unless `ALLOW_CUSTOM_USDC=true`. |
| `apps/web/.env` | `ESCROW_CONTRACT_ADDRESS` | all on-chain actions | set after deployment. Unset → the UI disables on-chain actions (nothing is simulated). |
| | `ARC_RPC_URL` | optional | server-side receipt verification. The browser always uses the default public RPC. |
| | `ZG_ROUTER_API_KEY` | AI evaluation | without it evaluation honestly returns `UNABLE_TO_ASSESS`. Optional: `ZG_ROUTER_BASE_URL`, `ZG_ROUTER_MODEL`, `ZG_ROUTER_TRUST_MODE`, `ZG_ROUTER_PROVIDER_ADDRESS`. Mainnet URLs are refused. |

Not needed: any session secret (sessions are random tokens stored hashed in SQLite), any `DATABASE_URL` (SQLite path is fixed in the schema), any Hedera variable (live Hedera payments are not implemented).

Arc facts (verified against docs.arc.io): chain `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`,
USDC ERC-20 `0x3600000000000000000000000000000000000000` with **6** decimals; the native gas token is the same USDC with **18** decimals.
Escrow amounts always use the 6-decimal ERC-20 interface.

## 2. Update the database (once, before first run)

The schema gained 4 nullable columns, 2 tables and 2 unique indexes. All additive. The script refuses any plan containing `DROP`/`DELETE`/rename,
checks unique-index preconditions itself, makes a verified backup, and applies in one transaction.

```bash
npm run db:update -w @trustora/web            # DRY RUN: prints the plan, changes nothing
# stop the dev server, then:
npm run db:update:apply -w @trustora/web      # backup -> transactional apply -> verification
```

Backups land in `apps/web/prisma/backups/`. **To restore:** stop the app and copy the chosen backup over `apps/web/prisma/dev.db`.
Do not use `prisma db push --accept-data-loss`; it disables the safety checks this script provides.

## 3. Deploy the escrow

```bash
cd packages/contracts
npm run compile && npx hardhat test test/TrustoraEscrow.test.js     # 14 tests
# 1. put DEPLOYER_PRIVATE_KEY in packages/contracts/.env; fund that address at https://faucet.circle.com (gas is USDC)
npm run deploy:arc:dry        # runs every check and stops: nothing is sent
npm run deploy:arc            # the single deploy transaction, then read-only verification
```

The dry run and the real run stop with a message ending **"Nothing was sent."** if any of these fail:
wrong network name, missing or malformed key, USDC address invalid or not the official one, RPC unreachable, RPC on the wrong chain,
no contract at the USDC address, USDC not 6 decimals, gas cannot be estimated, or the wallet holds less than 1.5× the estimated cost.

After a successful deploy the script prints the contract address, verifies it on-chain (code present, wired to the expected USDC, owner is the
deployer, not paused) and writes `packages/contracts/deployments/arcTestnet.json`.

## 4. Connect the app

1. Add `ESCROW_CONTRACT_ADDRESS=<address>` to `apps/web/.env` and restart.
2. `ESCROW_CONTRACT_ADDRESS=<address> npm run check:deployment -w @trustora/contracts`. It is read-only and needs no key.
3. Open the dashboard: **System status** should show *Arc escrow contract: Configured*. Configured means "an address is set". Each transaction is still verified individually.

## 5. End-to-end rehearsal (two wallets + the deployer as arbiter)

Client creates a project naming the freelancer → freelancer signs the agreement → client registers project and milestone on Arc →
client approves USDC and funds → freelancer submits (hash anchored) → client optionally runs AI evaluation → client releases.
Then repeat with a dispute resolved by the deployer wallet (the default arbiter).

## 6. Things to know

- The contract **owner is the default arbiter and the only account that can pause** the escrow. That is a trust assumption; use a dedicated arbiter wallet for the demo if you want to avoid it.
- Smart-contract wallets (account abstraction) are not supported: transactions must be sent directly to the escrow by an EOA.
- AI evaluation reads at most 24,000 characters. Larger submissions are refused at upload so nothing is judged on a partial read.
- `packages/contracts/hardhat.config.js` is a stale duplicate of `hardhat.config.cjs`. Hardhat loads the `.cjs` (it takes precedence), so the `.js` is inert, but it contains an unsafe fallback key and should be deleted: `rm packages/contracts/hardhat.config.js`.
