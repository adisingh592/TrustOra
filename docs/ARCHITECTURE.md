# Architecture

SQLite is the default database for the sprint.
Use Postgres only if one is already running.

## Milestone IDs

`onchainMilestoneId` is an M2 decision: a 0x-prefixed 32-byte hex string, to be derived from the milestone id.
M1 and M4 must use the same value.

## How to run the manual database check

Run `pnpm --filter @trustora/api db:check` from the repo root.
It uses a temporary SQLite file, deletes it afterwards, and never writes to `prisma/dev.db`.
It prints PASS or FAIL per check and exits 0 only if everything passed.

## Folder ownership

| Member | Owns |
| --- | --- |
| M1 | `contracts`, `packages/arc` |
| M2 | `apps/api`, `packages/shared`, `packages/prooftrack` |
| M3 | `packages/og`, `packages/evaluation` |
| M4 | `apps/web`, `README.md` |
| M5 | `packages/security`, `tests/security` |
