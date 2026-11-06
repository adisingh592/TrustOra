# TrustOra API — parked reference service (not the live product)
#
# Archival note (merge, 2026-11-07): this is the Fastify service that lost the product
# decision to the Next.js app at apps/web in the repo root. It is kept here, under
# reference/api-fastify/, as a working reference implementation — see
# docs/MERGE-NOTES.md at the repo root. Build context for this Dockerfile is THIS
# directory (reference/api-fastify/), not the repo root, e.g.:
#   docker build -f reference/api-fastify/Dockerfile reference/api-fastify
#
# Not built or run in this environment: Docker was not available when this file
# was written. It was verified by careful reading only (see docs/DEPLOY.md in this
# directory), against the versions pinned in this directory's own pnpm-lock.yaml.
# Build and run it once before relying on it in production.
#
# api/ has no compile step (tsconfig.base.json sets "noEmit": true; the repo runs
# TypeScript directly through tsx, in dev and here). This image does the same.
#
# pnpm workspaces resolve the lockfile against every member's manifest, so the
# install stage below needs every workspace member's package.json. The runtime
# stage then keeps only api's own source plus the workspace packages it actually
# imports (shared, prooftrack, security, arkiv) — not tests-security, whose code
# never reaches this image.

FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Copy manifests first, so this layer only re-runs when a dependency changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY api/package.json api/package.json
COPY arkiv/package.json arkiv/package.json
COPY prooftrack/package.json prooftrack/package.json
COPY security/package.json security/package.json
COPY shared/package.json shared/package.json
COPY tests-security/package.json tests-security/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY api api
COPY shared shared
COPY prooftrack prooftrack
COPY security security
COPY arkiv arkiv

RUN pnpm --filter @trustora/api exec prisma generate


FROM node:22-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 1001 trustora \
 && useradd --system --uid 1001 --gid trustora trustora

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=deps /app/api api
COPY --from=deps /app/shared shared
COPY --from=deps /app/prooftrack prooftrack
COPY --from=deps /app/security security
COPY --from=deps /app/arkiv arkiv

RUN chmod +x api/docker-entrypoint.sh \
 && chown -R trustora:trustora /app

USER trustora
WORKDIR /app/api

# The SQLite file (DATABASE_URL=file:/data/trustora.db) and UPLOAD_DIR (once file
# uploads exist) must resolve inside this volume: a container restart or redeploy
# throws away everything outside it.
VOLUME ["/data"]

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
