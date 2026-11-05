# TRUSTORA

Trust-first freelance escrow platform, built for ETHGlobal Mumbai. Arc Testnet only.

## Setup

```sh
pnpm install
cp .env.example .env                                 # names only; fill in locally
echo 'DATABASE_URL=file:./dev.db' > apps/api/.env    # local SQLite, not committed
pnpm test
pnpm dev:api                                         # GET /health
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for folder ownership.
