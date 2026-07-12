FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.12.3 --activate

# ---------------------------------------------------------------------------
# deps stage — install only what the worker needs. We copy the lockfile
# + workspace manifest so the cache keys on lock content, not the whole
# monorepo. The worker depends on @oper/query-lang (AL1 screen alerts), so
# we copy that package's manifest too and let pnpm install it via the filter.
# ---------------------------------------------------------------------------
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY turbo.json ./
COPY apps/worker/package.json ./apps/worker/
# We also need the other workspace member manifests so pnpm doesn't
# complain about an inconsistent workspace. We do NOT install their
# deps via filtering.
COPY apps/one/package.json ./apps/one/
COPY apps/two/package.json ./apps/two/
COPY packages/primitives/package.json ./packages/primitives/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/query-lang/package.json ./packages/query-lang/
RUN pnpm install --frozen-lockfile --filter=@oper/worker...

# ---------------------------------------------------------------------------
# builder — tsc compile of src → dist
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages/query-lang ./packages/query-lang
# The digest worker (AL1 screen alerts) imports @oper/query-lang, which — like
# the other @oper/* workspace packages — is published as TypeScript SOURCE
# (its package.json `exports` points at ./src/index.ts; Next consumes it the
# same way in dev). The digest worker therefore runs via the `tsx` binary
# (a production dependency of @oper/worker) so it can transpile the TS at
# runtime; query-lang's source is copied above to satisfy the workspace symlink.
# The other worker services keep running their compiled `dist` output.
RUN pnpm --filter=@oper/worker build

# ---------------------------------------------------------------------------
# runner — minimal image, just the compiled JS + runtime deps
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/apps/worker/node_modules ./apps/worker/node_modules
# @oper/query-lang is a workspace symlink into packages/query-lang; the digest
# worker's `tsx` runtime resolves `@oper/query-lang` to its ./src/index.ts
# source, so we ship the whole package (source + built worker dist).
COPY --from=builder --chown=worker:nodejs /app/packages/query-lang ./packages/query-lang

USER worker

# Default command runs the crawl loop. docker-compose overrides for the
# refresh service via `command: ["node", "apps/worker/dist/refresh-clusters.js"]`.
CMD ["node", "apps/worker/dist/crawl.js"]
