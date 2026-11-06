# TrustOra API — apps/api
#
# Not built or run in this environment: Docker was not available when this file
# was written. It was verified by careful reading only (see docs/DEPLOY.md),
# against the versions pinned in this repo's own pnpm-lock.yaml. Build and run
# it once before relying on it in production.
#
# apps/api has no compile step (tsconfig.base.json sets "noEmit": true; the repo
# runs TypeScript directly through tsx, in dev and here). This image does the same.
#
# pnpm workspaces resolve the lockfile against every member's manifest, so the
# install stage below needs the whole monorepo's package.json files — there is no
# narrower install that `--frozen-lockfile` accepts (contracts/ has none yet, so
# it is not a workspace member and is skipped). The runtime stage then keeps only
# apps/api's own source plus the workspace packages it actually imports
# (packages/shared, prooftrack, security, arkiv): not apps/web, tests/security, or
# packages/arc|og|evaluation, whose code never reaches this image.

FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Copy manifests first, so this layer only re-runs when a dependency changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/arc/package.json packages/arc/package.json
COPY packages/arkiv/package.json packages/arkiv/package.json
COPY packages/evaluation/package.json packages/evaluation/package.json
COPY packages/og/package.json packages/og/package.json
COPY packages/prooftrack/package.json packages/prooftrack/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tests/security/package.json tests/security/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/prooftrack packages/prooftrack
COPY packages/security packages/security
COPY packages/arkiv packages/arkiv

RUN pnpm --filter @trustora/api exec prisma generate


FROM node:22-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 1001 trustora \
 && useradd --system --uid 1001 --gid trustora trustora

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=deps /app/apps/api apps/api
COPY --from=deps /app/packages/shared packages/shared
COPY --from=deps /app/packages/prooftrack packages/prooftrack
COPY --from=deps /app/packages/security packages/security
COPY --from=deps /app/packages/arkiv packages/arkiv

RUN chmod +x apps/api/docker-entrypoint.sh \
 && chown -R trustora:trustora /app

USER trustora
WORKDIR /app/apps/api

# The SQLite file (DATABASE_URL=file:/data/trustora.db) and UPLOAD_DIR (once file
# uploads exist) must resolve inside this volume: a container restart or redeploy
# throws away everything outside it.
VOLUME ["/data"]

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
