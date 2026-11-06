# Architecture

SQLite is the default database for the sprint.
Use Postgres only if one is already running.

## Milestone IDs

`onchainMilestoneId` is an M2 decision: a 0x-prefixed 32-byte hex string, to be derived from the milestone id.
M1 and M4 must use the same value.

## Folder ownership

| Member | Owns |
| --- | --- |
| M1 | `contracts`, `packages/arc` |
| M2 | `apps/api`, `packages/shared`, `packages/prooftrack` |
| M3 | `packages/og`, `packages/evaluation` |
| M4 | `apps/web`, `README.md` |
| M5 | `packages/security`, `tests/security` |
