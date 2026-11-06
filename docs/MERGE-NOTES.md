# Merge notes

This repository is the result of merging two independently developed TrustOra implementations
into one hackathon submission. This document records what was merged, what was kept, what was
parked, and why — so no one has to reverse-engineer the history to understand the current layout.

## The decision

Two teammates built working, overlapping implementations of the same product idea in separate
repositories with unrelated git histories:

- A Next.js 16 App Router application (`apps/web`) — wallet auth, projects/agreements, milestone
  escrow UI, evaluation, and ProofTrack-style evidence, backed by Prisma/SQLite directly inside
  Next.js API routes, plus Hardhat contracts under `packages/contracts`.
- A Fastify service (previously at the repo root as `apps/api` plus several `packages/*`) with the
  same product idea: wallet auth, Prisma/SQLite, a ProofTrack evidence-timeline library, an
  optional Arkiv public-anchor integration, and a TAEVA advisory-evaluation module, consumed by a
  minimal static test UI rather than a full frontend.

The Next.js app was chosen as the product going into submission. The Fastify service is parked,
not deleted, at [`reference/api-fastify/`](../reference/api-fastify/) as a working reference
implementation — both git histories are preserved in this repository's log via a real
non-squashed, non-rebased merge (`git merge --allow-unrelated-histories --no-ff`), not a
reconstruction.

## What a reader needs to know about `reference/api-fastify/`

- It is **not running, not deployed, and not part of the live product.** No endpoint under it is
  reachable from `apps/web`.
- It builds and tests independently, under its own `pnpm-workspace.yaml`, with its own
  `pnpm-lock.yaml`. It is deliberately excluded from the root `package.json`'s npm workspaces glob
  (`packages/*`, `apps/*`) and from the root CI (`ci.yml`, which runs `npm ci` / `npm test` against
  the npm workspace only) — a change under `reference/` cannot break the product build or the
  product's CI.
- Everything under it kept its original authorship and commit history from the merge; only its
  location on disk changed. Where a path moved (e.g. `apps/api` → `reference/api-fastify/api`,
  `packages/shared` → `reference/api-fastify/shared`), internal `tsconfig.json` `extends` paths,
  the `Dockerfile`, and the two scripts that referenced a specific directory depth
  (`scripts/arkiv-smoke.mjs`, `scripts/real-run.ts`) were corrected to match; this is recorded as
  ordinary merge-commit changes, not silently.
- Its own docs (`docs/reference/API.md`, `DEPLOY.md`, `INTEGRATION-HANDOFF.md`, `STATUS-M2.md`,
  `ARCHITECTURE.md`, `SECURITY.md`, `REAL-RUN-LOG.md`) are kept as archival records of that
  implementation and each now carries a short note pointing back here. They describe
  `reference/api-fastify/`, not the shipped product — do not read them as current claims about
  `apps/web`.

## What moved, and why

| Original path | New path | Reason |
| --- | --- | --- |
| `apps/api` | `reference/api-fastify/api` | The parked Fastify service itself. |
| `packages/shared` | `reference/api-fastify/shared` | Only consumed by the parked service; name collided with nothing on the product side, but is scoped under `reference/` for clarity. |
| `packages/security` | `reference/api-fastify/security` | Same — wallet-auth/upload-validator interfaces specific to the Fastify service. |
| `packages/arkiv` | `reference/api-fastify/arkiv` | Same — the optional Arkiv anchor integration was only wired into the Fastify service. |
| `packages/arc` | *(deleted)* | An early, empty stub with no content and no equivalent need once Arc integration lives in `packages/contracts` on the product side. |
| `tests/security` | `reference/api-fastify/tests-security` | Security test suite for the parked service's interfaces. |
| `apps/web/index.html`, `apps/web/serve.js`, and their `package.json`/`tsconfig.json` | `reference/api-fastify/web-test-ui/` | A minimal static test page for the Fastify service, unrelated to the product's real `apps/web` (the Next.js app took that path, so this had to move). |
| Root `Dockerfile`, `.dockerignore`, `.env.example`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.json`, `package.json` (the pnpm-based ones) | `reference/api-fastify/` | These describe and build only the parked service; the product uses npm workspaces with its own root `package.json`/`package-lock.json`, which were kept at the repo root. |
| `scripts/arkiv-smoke.mjs`, `scripts/real-run.ts` | `reference/api-fastify/scripts/` | Specific to the parked service (Arkiv live smoke test, live-adapter prerequisite check). |
| `docs/API.md`, `DEPLOY.md`, `INTEGRATION-HANDOFF.md`, `STATUS-M2.md`, `REAL-RUN-LOG.md`, and the pre-merge versions of `ARCHITECTURE.md`/`SECURITY.md` | `docs/reference/` | Archival documentation of the parked service, kept separate from the product's own `docs/ARCHITECTURE.md` and `docs/SECURITY.md`. |

Not moved, because ownership was unambiguous and non-conflicting: `scripts/secret-scan.mjs` (a
repo-wide tool used by both the pre-commit hook and `secret-scan.yml`, covering the whole
repository's history including `reference/`), `.secret-scan-baseline`, `.githooks/`,
`.github/workflows/`.

## Conflict resolutions

Twelve textual conflicts were resolved during the merge, all in favor of the product side
(`--theirs`) except `.gitignore`, which was hand-merged as the union of both sides' patterns:
`package.json`, `tsconfig.json`, `apps/web/package.json`, `apps/web/tsconfig.json`,
`docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `README.md`, `packages/evaluation/src/index.ts`,
`packages/og/src/index.ts`, `packages/prooftrack/src/index.ts`, `packages/prooftrack/src/types.ts`.

`packages/prooftrack/` needed special handling: both sides had a package at that path, so instead
of an all-or-nothing resolution, the product's winning files (`src/index.ts`, `src/types.ts`,
`src/engine.ts`, `test/prooftrack.test.ts`) stayed at `packages/prooftrack/`, and the parked
service's own ProofTrack implementation (`chainVerifier.ts`, `core.ts`, `events.ts`, `mocks.ts`,
`ordering.ts`, `rules.ts`, `timeline.ts`, `verification.ts`, their tests, and the package's own
`package.json`/`tsconfig.json`) moved to `reference/api-fastify/prooftrack/`.

Stub manifests with no real counterpart on the product side (`packages/og/package.json`,
`packages/og/tsconfig.json`, `packages/evaluation/package.json`,
`packages/evaluation/tsconfig.json`) were removed rather than parked, since the product's real
`packages/og` and `packages/evaluation` have no manifest of their own and don't need one.

## Verifying this

- `git log --graph --oneline` shows both histories as real parents of the merge commit.
- `git log --follow -- apps/api/src/app.ts` (the *old* path; `--follow` does not cross a merge
  commit's rename when queried by the new path) walks the original commits. `git diff -M <merge
  commit's first parent> <merge commit> -- apps/api/src/app.ts
  reference/api-fastify/api/src/app.ts` shows the rename directly, with its similarity index.
- Nothing under `reference/api-fastify/` is imported by, or runs as part of, `apps/web` or the
  root npm workspace.
