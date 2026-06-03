FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.12.3 --activate

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY turbo.json ./
COPY apps/two/package.json ./apps/two/
COPY packages/primitives/package.json ./packages/primitives/
COPY packages/api-client/package.json ./packages/api-client/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/two/node_modules ./apps/two/node_modules
COPY --from=deps /app/packages/primitives/node_modules ./packages/primitives/node_modules
COPY --from=deps /app/packages/api-client/node_modules ./packages/api-client/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://placeholder:placeholder@db:5432/db
ENV REDIS_URL=redis://:placeholder@redis:6379

RUN pnpm --filter=@oper/two build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache wget && \
  addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs

RUN mkdir -p public .next && chown nextjs:nodejs .next
COPY --from=builder /app/apps/two/public ./public/
COPY --from=builder --chown=nextjs:nodejs /app/apps/two/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/two/.next/static ./apps/two/.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/two/server.js"]
