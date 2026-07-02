FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.12.3 --activate

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY turbo.json ./
COPY apps/one/package.json ./apps/one/
COPY apps/two/package.json ./apps/two/
COPY packages/primitives/package.json ./packages/primitives/
COPY packages/api-client/package.json ./packages/api-client/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/one/node_modules ./apps/one/node_modules
COPY --from=deps /app/apps/two/node_modules ./apps/two/node_modules
COPY --from=deps /app/packages/primitives/node_modules ./packages/primitives/node_modules
COPY --from=deps /app/packages/api-client/node_modules ./packages/api-client/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://placeholder:placeholder@db:5432/db
ENV REDIS_URL=redis://:placeholder@redis:6379
ENV ADMIN_API_KEY=placeholder_must_be_at_least_16_chars_long
# Stripe SDK initializes at module load in /api/checkout and /api/webhooks.
# Placeholders satisfy the build; runtime reads real values from compose env_file.
ENV STRIPE_SECRET_KEY=sk_test_placeholder
ENV STRIPE_WEBHOOK_SECRET=whsec_placeholder
ENV STRIPE_PRICE_PRO_MONTHLY=price_placeholder
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_placeholder

RUN pnpm --filter=@oper/one build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/one/public ./public
RUN mkdir .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/apps/one/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/one/.next/static ./apps/one/.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1

# Next.js standalone output puts server.js inside apps/one/
CMD ["node", "apps/one/server.js"]
