# DSI Plan 1 — OnePercentRealEstate Improvement Roadmap

**Date:** 2026-05-30  
**Scope:** Full-stack analysis (Next.js 16, Python/FastAPI, PostGIS, Docker, Stripe)  
**Methodology:** Manual code audit of 40+ files across frontend, backend, infrastructure, and documentation

---

## Table of Contents

1. [Scale 0 — Emergency & Security (Do Today)](#scale-0--emergency--security-do-today)
2. [Scale 1 — Critical Bugs (This Week)](#scale-1--critical-bugs-this-week)
3. [Scale 2 — Architecture & Code Quality (Next 2 Weeks)](#scale-2--architecture--code-quality-next-2-weeks)
4. [Scale 3 — Performance & Scale (Month 1–2)](#scale-3--performance--scale-month-12)
5. [Scale 4 — Developer Experience & Testing (Month 2–3)](#scale-4--developer-experience--testing-month-23)
6. [Scale 5 — Advanced Features & Polish (Month 3+)](#scale-5--advanced-features--polish-month-3)
7. [Appendix: File-by-File Issue Index](#appendix-file-by-file-issue-index)

---

## Scale 0 — Emergency & Security (Do Today)

These issues represent active security vulnerabilities or data loss risks. Fix before any feature work.

### 0.1 Remove hardcoded production credentials from repo

**Severity:** CRITICAL  
**Files:** 76 `.exp` files + 8 Python files + `docker-compose.yml`  
**What's exposed:**
- Root SSH password `[REDACTED]` (plaintext in all `.exp` files)
- Production server IP `157.245.184.89`
- `StrictHostKeyChecking=no` + password-only auth (MITM vulnerability)
- Default Postgres password `root_password_change_me_please` (8 Python files, docker-compose.yml)
- n8n password `n8n_password_change_me_please` (docker-compose.yml)

**Action:**
1. `git rm` all `.exp` files and add `*.exp` to `.gitignore`
2. Rotate the root password on `157.245.184.89` immediately
3. Rotate all database passwords
4. Rotate the n8n password
5. Replace hardcoded defaults in Python files with `os.environ.get("DATABASE_URL")` — fail fast if unset
6. Move all secrets from `docker-compose.yml` to a `.env` file referenced via `env_file:`

### 0.2 Add `.env.example` and audit existing secrets

**Severity:** HIGH  
**What's at risk:** Live Stripe publishable key (`pk_live_...`), secret key (`sk_live_...`), and Mapbox token exist in `.env.local` on disk. While `.gitignore` excludes `.env*`, they're present on the filesystem and could be leaked via misconfiguration, backup, or screenshots.

**Action:**
1. Create `.env.example` with all required vars (see Scale 4.1) — use placeholder values only
2. Verify no secrets are in git history via `git log --diff-filter=A -- '*.env*'`
3. Verify no secrets are embedded in the Docker image layers

### 0.3 Harden Docker infrastructure

**Severity:** HIGH  
**Issues:**
- Postgres port 5432 exposed to host network
- Redis port 6379 exposed with no authentication
- All services share a flat network with no segmentation
- No health checks on any service
- No container memory/CPU limits
- n8n uses `:latest` tag (non-deterministic)

**Action:**
1. Remove port exposure for internal services or restrict to internal Docker network
2. Add Redis password
3. Add `healthcheck` blocks to all services
4. Add `deploy.resources.limits` to all containers
5. Pin n8n to a specific version tag
6. Add a separate network for backend services vs web-facing

---

## Scale 1 — Critical Bugs (This Week)

### 1.1 Fix PropertyMap cluster layer source ID mismatch

**Severity:** HIGH — feature broken  
**File:** `src/components/PropertyMap.tsx`  
**Bug:** Cluster layers reference `source: 'properties'` (lines 27, 37, 49, 62) but the `<Source>` component has `id="listings-source"` (line 157). Cluster/heatmap/unclustered point layers **never render**. Only the `listings-circle` layer displays because it correctly references `listings-source`.

**Fix:** Change `source: 'properties'` to `source: 'listings-source'` in all layer definitions.

### 1.2 Unify rent estimation (Python vs SQL)

**Severity:** HIGH — inconsistent business logic  
**Files:** `_backend/rent_estimator_v2.py` vs `infrastructure/smart_rent_estimate.sql`  
**The divergence:**
- **Python** (`estimate_rent_v2`): Weighted triangulation — `HUD(0.30) + Comps(0.50) + ML(0.20)`
- **SQL** (`calculate_smart_rent`): Fallback chain — `weighted avg → simple avg → HUD → national`

A property can have different rent estimates depending on which code path runs (scraper/CLI vs DB trigger/API).

**Fix:** Choose one approach. Recommend the Python triangulation (it's more sophisticated). Either:
- (A) Move the triangulation logic into a PL/pgSQL function for DB-side consistency, or
- (B) Remove the SQL trigger and have the Python backend always compute rent, storing only the result

### 1.3 Reconcile schema with application code

**Severity:** HIGH — silent data loss  
**Files:** `listings_schema.sql` vs `_backend/scraper.py` vs `_backend/scraper_service/main.py`  
**Mismatches:**
| Column | Schema | scraper.py inserts | main.py inserts |
|--------|--------|-------------------|-----------------|
| `images` | Not present | Yes | Yes |
| `user_id` | Not present | Yes | Yes |
| `status` | `listing_status` | `status` | `'watch'` |
| `expense_ratio` | Not present | Yes (hardcoded 50) | No |

**Fix:** Update `listings_schema.sql` to include all columns the application inserts, or strip the inserts to match the schema. Add `IF NOT EXISTS` migration for any future schema changes.

### 1.4 Fix connection leaks in server actions

**Severity:** HIGH — connection pool exhaustion  
**Files:** `src/app/actions.ts` (3 places)  
**Bug:** `getHudBenchmark` (line 126), `getProperty` (line 153), `updatePropertyRent` (line 250) call `pool.connect()` / `client.query()` / `client.release()` but lack `finally` blocks. If the query throws, `client.release()` is never called, leaking connections.

**Fix:** Wrap in try/finally, or (better) use `pool.query()` directly which manages connections automatically. See `viewport/route.ts` for the correct pattern.

### 1.5 Add error boundaries, loading states, and 404 page

**Severity:** HIGH — poor UX on failure  
**Missing files:** `src/app/error.tsx`, `src/app/loading.tsx`, `src/app/not-found.tsx`  
**Impact:** Any unhandled page error shows Next.js's bare default error screen. Navigation to non-existent routes shows a generic 404. No skeleton loading states exist anywhere.

**Action:**
1. Create `src/app/error.tsx` with a "Something went wrong" UI + retry button
2. Create `src/app/loading.tsx` with a skeleton/spinner matching the dashboard layout
3. Create `src/app/not-found.tsx` with a branded 404 and navigation back home
4. Add route-level `error.tsx` / `loading.tsx` under `market/[zipcode]/` and `property/[id]/`

### 1.6 Fix SQL injection risk in ORDER BY

**Severity:** HIGH  
**File:** `src/app/actions.ts:69`  
**Bug:** `ORDER BY ${orderBy}` interpolates user-controlled string into SQL. Currently gated by a fixed set of values, but if the enum is ever bypassed or extended unsafely, this is injectable.

**Fix:** Use a whitelist map: `const ORDER_MAP = { newest: 'created_at DESC', price_asc: 'price ASC' }` and use `ORDER_MAP[sortBy] || 'created_at DESC'`.

### 1.7 Add input validation to `/api/estimate-rent`

**Severity:** HIGH — no request validation  
**File:** `src/app/api/estimate-rent/route.ts`  
**Issue:** Unlike the viewport API (Zod), this endpoint accepts raw unvalidated payload. Malformed inputs hit PostgreSQL directly.

**Fix:** Add a Zod schema for the request body: `z.object({ lat: z.number(), lon: z.number(), beds: z.number().int().optional(), ... })`.

---

## Scale 2 — Architecture & Code Quality (Next 2 Weeks)

### 2.1 Eliminate `any` types and `@ts-ignore`

**Files:** Widespread (5 `@ts-ignore`, 15+ `any` annotations)  
**Strategy:**
1. Define a proper `Property` interface with typed fields (not `raw_data: any`)
2. Type SQL result rows instead of using `(row: any) => ...` mapping
3. Remove all `@ts-ignore` directives and fix the underlying issues
4. Add proper type generics to `pool.query<RowType>()` calls
5. Type Mapbox layer objects as `LayerProps` from react-map-gl

### 2.2 Deduplicate scraper code

**Files:** `_backend/scraper.py` vs `_backend/scraper_service/main.py`  
**Overlap:** ~80% — geocoding, NaN cleaning, property type extraction, address construction, bath calculation  
**Fix:** Extract shared logic into a `_backend/scraper_common.py` module. Have both the CLI script and FastAPI service import from it. Differences (upsert logic, price-change detection) remain in the respective callers.

### 2.3 Add fallback rent fix (null price → 0 bug)

**File:** `src/app/actions.ts:106`  
**Bug:** `Number(null)` returns `0`, masking missing prices as $0 in the frontend. Properties with no price show as "$0" rather than "Price unavailable".  
**Fix:** Handle null/undefined explicitly in the mapping function.

### 2.4 Add debouncing to filter/slider changes

**Files:** `src/app/page.tsx`, `src/components/PropertyFilters.tsx`  
**Issue:** Price range slider, bedroom/bathroom selectors, and sort dropdown all trigger immediate DB queries. Rapid slider changes cause burst requests.  
**Fix:** Debounce `loadProperties` by 250ms when filters change. The debounce should be in the component, not the server action.

### 2.5 Fix rate limiter fail-closed on Redis outage

**File:** `src/lib/rate-limit.ts`  
**Bug:** `checkRateLimit` returns `false` on both "rate limited" and "Redis error". A Redis outage blocks all users for 60s. Comment says "Fail open" but logic fails closed.  
**Fix:** Log the Redis error and return `true` (allow) on exception. The rate limit is a convenience, not an auth boundary.

### 2.6 Remove `CREATE EXTENSION postgis` from request path

**File:** `src/app/api/map/clusters/route.ts:18`  
**Issue:** `CREATE EXTENSION IF NOT EXISTS postgis` runs on every API call. Idempotent but adds latency.  
**Fix:** Move to a one-time migration/setup script.

### 2.7 Add CORS headers if needed

**File:** `next.config.ts` or API route middleware  
**Issue:** No CORS headers on any route. If the frontend and API are on different origins (e.g., CDN), CORS will fail silently.  
**Fix:** Add `Access-Control-Allow-Origin` via Next.js `headers()` config in `next.config.ts` or a middleware.

### 2.8 Add monitoring and error tracking

**Missing:** Sentry, OpenTelemetry, or any error aggregation  
**Action:** Add Sentry SDK (`@sentry/nextjs`) for:  
- Automatic error capture on frontend and API routes  
- Performance tracing  
- Release tracking  
**Fallback:** At minimum, add a webhook logger that POSTs errors to a webhook endpoint.

### 2.9 Add database backup strategy

**Missing:** No `pg_dump` scripts, no backup automation  
**Action:**
1. Create a `scripts/backup-db.sh` that runs `pg_dump` and uploads to S3/Backblaze B2
2. Add a cron schedule (daily for full, hourly for WAL archiving)
3. Document the restore procedure

### 2.10 Add security headers (CSP, etc.)

**Missing:** No Content-Security-Policy, no security headers  
**Fix:** Add in `next.config.ts`:
```typescript
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; ..." },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
  }]
}
```

---

## Scale 3 — Performance & Scale (Month 1–2)

### 3.1 Add Next.js Image component

**Files:** `src/app/compare/page.tsx`, `src/components/PropertyHero.tsx`  
**Issues:**
- Raw `<img>` tags bypass Next.js automatic optimization (resizing, WebP/AVIF, lazy loading)
- No `remotePatterns` configured in `next.config.ts`
- Property images from external sources (MLS, scraping) have no width/height and cause layout shift

**Action:**
1. Add `images.remotePatterns` in `next.config.ts` to allow MLS/image source domains
2. Replace `<img>` with `next/image` (or `next/legacy/image` for external domains)
3. Add `blurDataURL` for placeholder generation

### 3.2 Add SEO metadata and Open Graph tags

**File:** `src/app/layout.tsx`  
**Issues:**
- Root layout uses "Create Next App" as title/description
- No Open Graph, Twitter Card, or structured data
- No `<meta name="description">` on most pages (except market/[zipcode])
- No JSON-LD structured data for property listings

**Action:**
1. Update layout metadata with real app name, description
2. Add `openGraph` and `twitter` metadata to layout
3. Add JSON-LD for property detail pages (Product schema)
4. Add JSON-LD for market pages (RealEstateListing aggregation)

### 3.3 Add caching headers and CDN strategy

**Current state:**
- Viewport API: `Cache-Control: public, max-age=60, s-maxage=300`
- All other APIs: No caching headers
- No CDN configured (uses Vercel or direct VPS)

**Action:**
1. Add CDN (CloudFront or similar) in front of the VPS
2. Add `stale-while-revalidate` strategy to API responses
3. Cache market pages aggressively (they change daily at most)
4. Add Redis caching for the rent estimation endpoint (currently uncached)

### 3.4 Implement virtual scrolling for property list

**File:** `src/app/page.tsx`  
**Issue:** The dashboard loads up to 100 properties at once, but with 1.2M+ in the DB, the list view doesn't scale. No pagination or infinite scroll beyond the hardcoded `limit: 100`.  
**Fix:** Add virtual scrolling (e.g., `@tanstack/react-virtual`) or paginated infinite scroll with cursor-based pagination.

### 3.5 Add database connection pooling configuration

**File:** `src/lib/db.ts`  
**Current:** Default pg Pool (max 20 connections)  
**Issues:**
- No statement timeout
- No connection timeout
- No idle timeout
- Pool size not tuned for the workload or server resources

**Fix:** Add explicit pool configuration:
```typescript
new Pool({
  connectionString: DATABASE_URL,
  max: 20,                // tune based on VPS resources
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
})
```

### 3.6 Add health checks and readiness probes

**Missing:** No Docker health checks, no `/api/health` consumer  
**Fix:**
1. Add `HEALTHCHECK` to `Dockerfile`
2. Add health checks to all docker-compose services
3. Make `/api/health` return granular status per dependency (DB, Redis, Stripe connectivity)
4. Add a `/_health` endpoint for the load balancer / CDN

### 3.7 Add container resource limits

**Files:** `infrastructure/docker-compose.yml`  
**Missing:** No `mem_limit` or `cpus` on any service  
**Fix:** Add per-service limits:
- `app`: 512MB-1GB RAM, 1-2 CPUs
- `postgres`: 1-2GB RAM (needs some headroom for PostGIS), 2-4 CPUs
- `redis`: 256MB RAM
- `n8n`: 512MB RAM
- `scraper`: 1GB RAM (burst usage during scrapes)

### 3.8 Add API rate limiting to all routes

**Current:** Only `/api/properties/viewport` is rate-limited  
**Action:** Move `checkRateLimit` to a middleware or factor it into a reusable wrapper that can be applied per-route with different limits:
- Map viewport: 60 req/min
- Rent estimation: 30 req/min
- Scrape triggers: 5 req/min
- Checkout: 10 req/min
- Health: no limit

---

## Scale 4 — Developer Experience & Testing (Month 2–3)

### 4.1 Create `.env.example` and setup documentation

**Missing:** No `.env.example`, no developer setup guide in `README.md`  
**Action:**
1. Create `.env.example` with all required environment variables (use placeholder values)
2. Rewrite `README.md` with:
   - Project overview and screenshots
   - Prerequisites (Node 20+, Python 3.11+, Docker, PostgreSQL 16+PostGIS)
   - Quick start (`cp .env.example .env` → `npm install` → `npm run dev`)
   - Available scripts
   - Deployment guide (brief)
   - Link to `documentation/` for deep dives

### 4.2 Add test framework and initial tests

**Missing:** Zero tests across the entire codebase  
**Action:**
1. **Frontend:** Add `vitest` + `@testing-library/react`
   - Unit tests for `calculators.ts` and `finance.ts` (pure math → perfect test candidates)
   - Component smoke tests for `PropertyCard`, `CashflowCalculator`
   - Integration test for the viewport API route
2. **Backend:** Add `pytest`
   - Unit tests for `rent_estimator_v2.py` (another pure logic function)
   - Integration test for DB connection and queries
   - ML model prediction test
3. **E2E:** Add Playwright for:
   - Dashboard loads and displays properties
   - Property detail page renders
   - Search/market pages render

### 4.3 Add Prettier and commit hooks

**Missing:** No formatter, no pre-commit hooks  
**Action:**
1. Add `.prettierrc` with project-standard formatting (recommend: single quotes, trailing commas, 100 print width)
2. Install `husky` and `lint-staged`
3. Configure pre-commit hook: `prettier --check` + `eslint` on staged files
4. Optionally add commitlint for conventional commits

### 4.4 Add TypeScript strictness back

**Current:** `strict: true` in tsconfig, but `any` and `@ts-ignore` neutralize it  
**Action:**
1. Fix all `@ts-ignore` usages (Scale 2.1)
2. Add `noUncheckedIndexedAccess: true` to catch missing array/object access
3. Add `exactOptionalPropertyTypes: true`
4. Run `tsc --noEmit` as a CI check

### 4.5 Add `npm run typecheck` and CI scripts

**Missing:** No CI pipeline, no typecheck script  
**Action:**
1. Add `"typecheck": "tsc --noEmit"` to `package.json`
2. Add `"test": "vitest run"` to `package.json`
3. Create a GitHub Actions workflow (`.github/workflows/ci.yml`):
   - `npm ci` → `npm run typecheck` → `npm run lint` → `npm run test`
   - Python: `pip install -r _backend/requirements.txt` → `pytest`

### 4.6 Migrate from print() to structured logging

**Files:** All `_backend/*.py` files (28 files, all use `print()`)  
**Action:**
1. Add a shared `_backend/logging_config.py`:
   ```python
   import structlog
   structlog.configure(
       processors=[structlog.processors.JSONRenderer()]
   )
   logger = structlog.get_logger()
   ```
2. Replace `print(...)` with `logger.info(...)`, `logger.error(...)`, etc.
3. Add log level configuration via `LOG_LEVEL` env var

### 4.7 Add API versioning

**Current:** All routes at `/api/...` with no version prefix  
**Action:** Prefix all routes with `/api/v1/`. Use Next.js route groups to support this without moving files:
```
src/app/api/v1/properties/viewport/route.ts
src/app/api/v1/estimate-rent/route.ts
...
```
Add a redirect from `/api/...` to `/api/v1/...` for backwards compatibility.

### 4.8 Add database migration tooling

**Current:** SQL files applied manually or via `.exp` expect scripts  
**Action:** Adopt a migration tool:
- **Option A (lightweight):** Use `node-pg-migrate` to run SQL files in order
- **Option B (full ORM):** Add Prisma or Drizzle for type-safe queries + migrations

---

## Scale 5 — Advanced Features & Polish (Month 3+)

### 5.1 Re-enable authentication with NextAuth.js

**Current:** Auth is fully disabled (middleware pass-through, placeholder user IDs)  
**Action:**
1. Add `next-auth` with credentials provider (or OAuth: Google, GitHub)
2. Replace `middleware.ts` with proper auth checks
3. Wire user IDs through the frontend (pricing, checkout, settings)
4. Enforce subscription tier gating on API routes
5. Add session-based user context to all authenticated requests

### 5.2 Add Stripe webhook idempotency

**File:** `src/app/api/webhooks/route.ts`  
**Issue:** No idempotency handling for duplicate Stripe events  
**Fix:** Store processed webhook IDs in Redis with 24h TTL. Skip re-processing if `stripe-signature` ID is already in the set.

### 5.3 Add subscription cancellation / portal endpoints

**Missing:** No `/api/cancel` endpoint, no Stripe Customer Portal integration  
**Action:**
1. Add `/api/portal` to create a Stripe Customer Portal session
2. Add `/api/cancel` to cancel subscriptions server-side
3. Add cancellation confirmation flow in the settings page

### 5.4 Add PWA support

**Missing:** No service worker, no manifest, no offline support  
**Action:**
1. Generate `public/manifest.json` with app name, icons, theme color
2. Register a service worker for offline caching of: property data, map tiles, static assets
3. Add `next-pwa` or `@serwist/next` for automatic service worker generation

### 5.5 Add notification system

**Current:** Uses `alert()` for important messages (compare limit, errors)  
**Action:** Add a toast/notification system:
- `sonner` (lightweight, shadcn/ui compatible)
- Replace all `alert()` calls with toast notifications
- Add push notifications for: scrape completion, price drops, rent estimate updates

### 5.6 Add theme support (dark mode)

**Current:** Light mode only  
**Action:** Add `next-themes` with:
1. Dark mode CSS variables in `globals.css`
2. Theme toggle in the header
3. Persist preference in localStorage
4. Respect `prefers-color-scheme` for initial render

### 5.7 Add JSON-LD structured data

**Action:** Add structured data to property detail pages:
```json
{
  "@context": "https://schema.org",
  "@type": "RealEstateListing",
  "name": "123 Main St",
  "description": "3 bed, 2 bath home...",
  "offers": { "@type": "Offer", "price": 350000 },
  "image": "https://..."
}
```
This improves Google search result rendering (rich snippets, price badges).

### 5.8 Add prefetching and optimistic UI

**Current:** Navigation to property detail is a full page load  
**Action:**
1. Use `next/link` with `prefetch={true}` on property cards
2. Add optimistic updates for rent estimation (show stale estimate while fetching)
3. Implement `useTransition` for non-blocking navigations

### 5.9 Add data archival and retention policies

**Current:** `crawl_jobs` table auto-recycles but never archives old data  
**Action:**
1. Add a monthly cleanup script: `DELETE FROM crawl_jobs WHERE created_at < now() - interval '90 days'`
2. Archive old rental comps (keep last 60 days for active estimation)
3. Add `deleted_at` soft-delete pattern to listings

### 5.10 Add ML model pipeline improvements

**Current issues:**
- Model serialized with `pickle` (RCE risk, fragile across Python versions)
- Hardcoded year `2025` in features
- No model versioning or drift monitoring
- No A/B testing for rent estimation

**Action:**
1. Migrate to `joblib` or ONNX for model serialization
2. Add model versioning by storing version hash in the DB alongside predictions
3. Add feature drift monitoring (track feature distributions vs training time)
4. Implement online model evaluation by collecting user feedback on rent estimates

### 5.11 Add GDPR/privacy compliance

**Current:** No privacy policy, no cookie consent, no data deletion endpoint  
**Action:**
1. Add cookie consent banner
2. Add privacy policy page
3. Add data deletion endpoint (`DELETE /api/user/data`)
4. Document data retention (scraped property data, user profiles, Stripe records)

---

## Appendix: File-by-File Issue Index

| File | Issues | Scale |
|------|--------|-------|
| `**/*.exp` (76 files) | Root password in plaintext, server IP exposed | 0 |
| `docker-compose.yml` | Hardcoded passwords, no health checks, no resource limits, `:latest` tag | 0, 3 |
| `Dockerfile` | No `HEALTHCHECK`, no `tini`, no resource limits | 3 |
| `src/lib/db.ts` | Default password, `@ts-ignore`, no pool config | 0, 3 |
| `src/lib/rate-limit.ts` | Fail-closed on Redis error, IP spoofable | 1 |
| `src/lib/calculators.ts` | Zero-rate loan bug, PMI edge case, hardcoded defaults | 1 |
| `src/lib/finance.ts` | Division by zero (deal score), duplicated mortgage calc | 1 |
| `src/app/page.tsx` | 3x `@ts-ignore`, no error UI, no debounce, no loading state | 1, 2 |
| `src/app/actions.ts` | SQL injection (ORDER BY), connection leaks, null→0 bug, duplicate code | 1, 2 |
| `src/app/api/viewport/route.ts` | Rate-limited (correct), fragile cache key, resource leak | 1 |
| `src/app/api/estimate-rent/route.ts` | No input validation, `catch (e: any)` | 1 |
| `src/app/api/map/clusters/route.ts` | `CREATE EXTENSION` per request, fragile string-replace, duplicate impl | 1, 2 |
| `src/components/PropertyMap.tsx` | **Source ID mismatch (cluster layers broken)** | 1 |
| `src/components/CashflowCalculator.tsx` | `any` type, double-calculation, division by zero | 1, 2 |
| `src/components/AdvancedRentEstimator.tsx` | `any` type, infinite re-render risk | 2 |
| `src/app/layout.tsx` | "Create Next App" placeholder metadata | 3, 5 |
| `next.config.ts` | Missing images, headers, rewrites config | 3 |
| `middleware.ts` | Pass-through (disabled auth) | 5 |
| `eslint.config.mjs` | No `_backend/` ignore | 2 |
| `tsconfig.json` | `ES2017` target (old), excludes wrong backend path | 2 |
| `_backend/rent_estimator_v2.py` | Harcoded password, no connection pooling, simple median (not weighted) | 0, 2 |
| `_backend/scraper.py` | 80% duplicate with main.py, `data['listing_price']` KeyError bug, row-by-row inserts | 1, 2 |
| `_backend/scraper_service/main.py` | Same duplicate code, no connection pooling | 2 |
| `_backend/scheduler.py` | Timezone confusion, fragile CWD detection | 2 |
| `_backend/ml_rent_estimator/features.py` | Hardcoded year 2025, dead binary features | 2 |
| `_backend/ml_rent_estimator/predict.py` | `pickle.load`, race condition in cache, no batch predict | 2, 5 |
| `_backend/ml_rent_estimator/train_model.py` | Fetches ALL data (no pagination), uses Supabase (inconsistent) | 2 |
| `listings_schema.sql` | No unique constraint (commented out), columns missing | 1 |
| `fix_rls.sql` / `secure_rls.sql` | Reference `properties` table (not `listings`), Supabase-specific | 1 |
| `src/app/api/webhooks/route.ts` | No idempotency, silent error swallowing | 5 |
| `src/app/api/checkout/route.ts` | Placeholder user ID, no auth | 5 |
| `.gitignore` | Ignores `.env*` (correct) but no `*.exp` rule | 0 |
| `UpgradePlan2-7-26.md` | Thorough plan but needs updating post-analysis | ref |
| `README.md` | Boilerplate `create-next-app` — no project info | 4 |

---

## Quick Wins (Can be done in parallel)

These are small, safe, high-value fixes that don't require architectural changes:

1. **Fix PropertyMap source ID** (1 line change, unbreaks cluster layers)
2. **Remove `CREATE EXTENSION postgis` from request path** (1 line)
3. **Fix the `--filter` null-price bug** in `page.tsx:97` (2 lines)
4. **Add connection cleanup `finally` blocks** in `actions.ts` (3 lines)
5. **Fix ORDER BY injection** (5 lines, whitelist map)
6. **Remove all `.exp` files** (git rm + .gitignore)
7. **Update layout metadata** (replace "Create Next App" strings)
8. **Add `error.tsx` and `loading.tsx`** (new files, no regressions)
9. **Fix the hardcoded year in `features.py`** (1 line)
10. **Create `.env.example`** (new file, no regressions)

---

*End of DSI Plan 1*
