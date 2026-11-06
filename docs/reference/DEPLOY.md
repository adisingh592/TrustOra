# Deploying `apps/api`

> **Archival note (merge, 2026-11-07):** `apps/api` here refers to the parked Fastify service, now
> at [`reference/api-fastify/api`](../../reference/api-fastify/api). It is not the live Next.js
> product. See [`docs/MERGE-NOTES.md`](../MERGE-NOTES.md).

This is host-agnostic. For creating the actual hosting resource (a VM, a container service, a managed Postgres, etc.), check your host's current documentation — this page does not name or describe any specific provider's console.

## Honesty note

This page, the `Dockerfile`, and `.dockerignore` were written and checked by reading the code and by running the install and `prisma generate` steps locally. **Docker itself was not available in the environment that wrote them, so the image has not been built or run.** Build and run it once yourself before relying on it. `pnpm --filter @trustora/api db:check`, `pnpm test`, and `pnpm -r exec tsc --noEmit` all pass against the code this describes.

## Prerequisites

- Node.js 22.10 or later (the repo's own tooling requires this; see the Arkiv SDK's requirement, which is the strictest one in this workspace).
- `pnpm` 10.33 (the version pinned in the root `package.json`'s `packageManager` field). Enable it with `corepack enable`.
- A place for the SQLite file and (once it exists) uploaded files to live outside the container/instance's own filesystem — see "Persistent disk" below.
- A domain for the web app and a separate one for the API, or a path-based setup, so `AUTH_DOMAIN` and `WEB_ORIGIN` can be set correctly.

## There is no build step

`tsconfig.base.json` sets `"noEmit": true`. The repo runs TypeScript directly through `tsx`, in development and in this deploy. There is nothing to "compile" first; `apps/api/package.json` now has a `start` script (`tsx src/server.ts`) for this.

## Environment variables

Everything is read from `process.env`. `apps/api/.env` is only loaded automatically outside tests, and only if the file exists — in a real deployment, set these through your host's environment variable mechanism instead of shipping a `.env` file.

Values below marked **example** are fake and illustrative only.

| Name | Required in production? | Example | What it does |
| --- | --- | --- | --- |
| `NODE_ENV` | — | `production` | Turns on the checks in this table and the production cookie/validation defaults. |
| `SESSION_SECRET` | **Yes**, ≥32 characters | `f3b1...` (64 hex chars) | Signs session cookies (HMAC-SHA256). See "Generating a strong secret" below. |
| `AUTH_DOMAIN` | **Yes** | `api.trustora.example` | The only domain sign-in messages are issued and accepted for. Must match where the API itself is reachable, not the web app's domain. |
| `DATABASE_URL` | **Yes** | `file:/data/trustora.db` | Prisma's SQLite connection string. Must point inside the persistent volume (see below). |
| `WEB_ORIGIN` | **Yes** | `https://app.trustora.example` | Comma-separated list of origins allowed to call this API from a browser with credentials. No wildcard is ever accepted. |
| `ARC_TESTNET_USDC_ADDRESS` | **Yes** | `0x3600000000000000000000000000000000000000` | Validated as a real address at startup. Used as the token address for new projects. |
| `TRUST_PROXY` | No (default `false`) | `true` | Set to `true` only if a reverse proxy or load balancer sits in front of the API and sets `X-Forwarded-*` headers. |
| `COOKIE_SAMESITE` | No (default `lax`) | `none` | See "Same site vs. different site" below. |
| `STORAGE_DIR` | No (default `.storage`) | `/data/storage` | Persistent private directory where uploaded deliverables are safely stored outside web root. |
| `CHAIN_ADAPTER` | No (default `mock`) | `mock` or `arc` | Selects chain adapter mode. `arc` requires Arc env variables and real adapter from M1. |
| `EVALUATION_ADAPTER` | No (default `heuristic`) | `heuristic` or `zerog` | Selects AI evaluation mode. `zerog` requires 0G env variables and real adapter from M3. |
| `PORT` | No (default `3001`) | `3001` | The port the API listens on. |
| `AUTH_DOMAIN`'s sibling values (`ARC_TESTNET_RPC_URL`, `ARC_TESTNET_CHAIN_ID`, `ARC_TESTNET_EXPLORER_URL`, `ARC_ESCROW_CONTRACT_ADDRESS`, `ARC_DEPLOYER_PRIVATE_KEY`) | Depends on M1's adapter | — | Not read by any code in `apps/api` yet. See `docs/INTEGRATION-HANDOFF.md`. |
| `ARKIV_ENABLED`, `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`, `ARKIV_ENTITY_DAYS` | No — optional feature, off by default | — | Public hash-only evidence anchoring. See the comments in `.env.example`. |
| `HEDERA_*`, `X402_FACILITATOR_URL`, `ZG_*` | No | — | Not read by any code yet (stretch goals / other members' packages). |

If `NODE_ENV=production` and any of the **Yes** rows above is missing or invalid, the API refuses to start and prints one secret-free message naming every problem (`apps/api/src/serverConfig.ts`). It never starts "mostly working."

### Generating a strong `SESSION_SECRET`

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
This prints 64 hex characters (32 bytes) — comfortably over the 32-character minimum the API enforces. Generate a new one per environment; never reuse the value from `.env.example` (there is none to reuse) or from a different deployment.

### Same site vs. different site

- **Same site** (the web app and the API share a registrable domain, e.g. `app.trustora.example` and `api.trustora.example`): leave `COOKIE_SAMESITE` unset. The cookie is `SameSite=Lax`, which browsers send on top-level navigation and same-site fetches. This is the simpler, safer default and is what the code does today.
- **Different site** (the web app is on an entirely different domain, e.g. deployed separately from the API): set `COOKIE_SAMESITE=none`. This forces the cookie to also be `Secure`, which the spec requires for `SameSite=None` — browsers drop the cookie otherwise. The trade-off: a cross-site cookie is a slightly larger CSRF surface than a same-site one, though this API's own session cookie carries no CSRF-sensitive side effects by itself (every state-changing route still requires a valid session; nothing here relies on the cookie as the *only* proof of intent). Prefer same-site if you control both deployments.

## Persistent disk (SQLite)

**This matters more than almost anything else in this document.** SQLite is a single file. If `DATABASE_URL` points inside the container's own writable layer (not a mounted volume), every redeploy, restart, or crash silently discards the entire database.

- Point `DATABASE_URL` at a path inside a volume that survives redeploys (`file:/data/trustora.db` in the Dockerfile's convention).
- **Run exactly one instance.** SQLite does not support multiple writers from different machines, and nothing in this codebase coordinates writes across instances. If your host wants to scale this API horizontally, that is a larger change (a networked database), not a deploy setting.
- The four `AgreementVersion` triggers (immutable terms, no-delete, single-set acceptances — see `docs/ARCHITECTURE.md`) live in the SQLite file itself, not in Prisma's schema tracking. They survive normally with the file; they do not survive a manual schema rebuild outside Prisma's own migration history.

## Running migrations

```sh
pnpm --filter @trustora/api exec prisma migrate deploy
```
This applies every migration under `apps/api/prisma/migrations` in order and is safe to re-run (it skips already-applied migrations). The Dockerfile's entrypoint runs this automatically before starting the server. Do this before the first deploy and before every deploy that adds a migration.

## Backing up and restoring the SQLite file

**Back up:** stop writes briefly (or accept a small risk of an in-flight write being split) and copy the file:
```sh
cp /data/trustora.db /data/trustora.db.bak-$(date +%Y%m%d%H%M%S)
```
SQLite's own `.backup` command (via the `sqlite3` CLI) is safer under load, since it takes a consistent snapshot without stopping writers — use it if it's available on your host:
```sh
sqlite3 /data/trustora.db ".backup /data/trustora.db.bak"
```

**Restore:** stop the API, replace the file, start the API:
```sh
systemctl stop trustora-api   # or your host's equivalent
cp /data/trustora.db.bak /data/trustora.db
systemctl start trustora-api
```

## Health and readiness

- `GET /health` — always public, always returns `{"ok":true}` if the process is up. Use this for a basic liveness probe.
- `GET /ready` — always public, checks that the database answers a trivial query. Returns `200 {"ok":true,"database":"connected","timestamp":...}` or `503 {"ok":false,"database":"disconnected","timestamp":...}`, with no further detail on failure. Use this for a readiness probe (don't route traffic until it's `200`).

## Wiring the real adapters

Configured via `CHAIN_ADAPTER` and `EVALUATION_ADAPTER` environment flags:
- `CHAIN_ADAPTER=mock`: uses in-memory `MOCK_ChainAdapter` (labelled "MOCK adapter" in responses and `/infrastructure`).
- `CHAIN_ADAPTER=arc`: dynamically loads `@trustora/arc` from M1 and enforces `ARC_ESCROW_CONTRACT_ADDRESS`, `ARC_TESTNET_RPC_URL`, `ARC_TESTNET_USDC_ADDRESS`, `ARC_TESTNET_CHAIN_ID=5042002`.
- `EVALUATION_ADAPTER=heuristic`: uses deterministic TAEVA heuristic fallback (labelled "MOCK" in advisory notes).
- `EVALUATION_ADAPTER=zerog`: dynamically loads `@trustora/evaluation` from M3 and enforces `ZG_RPC_URL` / `ZG_STORAGE_CONTRACT`.

If a real adapter is selected and its required environment variables or package exports are missing, the server refuses to start with an explicit error, avoiding any silent mock fallback.

## Graceful shutdown

The server installs a `SIGTERM`/`SIGINT` handler (`apps/api/src/shutdown.ts`) that stops accepting new connections, lets in-flight requests finish, disconnects Prisma, then exits. Most container orchestrators send `SIGTERM` and wait a grace period before `SIGKILL` — the default is usually enough for this API's request sizes, but increase it if you see requests cut off during rolling deploys.

## Post-deploy smoke test checklist

Run these against the real deployed URL, not localhost, after every deploy:

```sh
curl -i https://api.trustora.example/health
curl -i https://api.trustora.example/ready
```
Both should return `200`. Then, from a browser on the configured `WEB_ORIGIN` (or with `curl -i -H "Origin: https://app.trustora.example"` against `/auth/nonce` to check the `Access-Control-Allow-Origin` header comes back):

1. `POST /auth/nonce` — should return a `nonce`, `message`, and `expiresAt`.
2. Sign that message with a wallet and `POST /auth/verify-wallet` — should return `200` with `{ address, userId }` and set the session cookie.
3. `GET /auth/me` with that cookie — should return the same `address`/`userId`.
4. `POST /projects` with that cookie and a minimal body — should return `201` and a project with an `id` like `TRU-PROJ-2026-XXXXXXX`, **unless** `ARC_TESTNET_USDC_ADDRESS` validation already told you this would 503 — if so, you'll see `503 TOKEN_NOT_CONFIGURED` instead, which is also a valid, informative result for a smoke test.

If all of that passes, sign-in, CORS, cookies, and the database are working end to end.
