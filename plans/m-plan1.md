# 1% Real Estate — Improvement Plan

> Generated from a full codebase audit across security, performance, code quality, and DevOps.
> Each issue includes file:line references and concrete fixes.

---

## Executive Summary

**1% Real Estate** is a Next.js 16 + PostgreSQL/PostGIS + Redis + Mapbox real estate investment analysis platform. The audit found **5 critical**, **12 high**, and **15+ medium severity issues** across four domains. The app has strong architectural bones (multi-stage Docker, vector tile maps, parameterized SQL) but lacks production hardening.

### Scorecard

| Area | Score | Status |
|------|-------|--------|
| Security | 2/10 | Command injection, no auth, exposed credentials |
| Performance | 4/10 | Heavy bundles, no caching, full JSONB in list views |
| Code Quality | 5/10 | Massive components, `any` types, duplicated logic |
| Testing | 0/10 | No tests, no framework, no test scripts |
| CI/CD | 0/10 | No pipeline, manual rsync deploy |
| Monitoring | 0/10 | Zero observability |

---

## Phase 1: Critical Security & Credential Rotation (Day 1)

> **Goal:** Stop active security bleeding.

### 1.1 Rotate All Exposed Credentials

| Secret | Location | Action |
|--------|----------|--------|
| Stripe live keys (`sk_live_...`, `pk_live_...`) | `.env.local:3-4` | Rotate immediately in Stripe dashboard |
| FRED API key | `.env.local:12` | Rotate at api.stlouisfed.org |
| Server password (`appo0-buXbym-cijzy`) | `infrastructure/setup_server.sh:9` | Rotate VPS password, remove from file |
| Postgres password (`root_password_change_me_please`) | `src/lib/db.ts:13`, `docker-compose.yml:18,59` | Generate new password, update all references |

### 1.2 Fix OS Command Injection (CRITICAL)

**Files:** `src/app/api/scrape/route.ts:15-26`, `src/app/api/fetch-rentals/route.ts:15-22`

Both endpoints pass user input into shell commands via string interpolation:
```typescript
let args = `--location "${location}"`;
const command = `cd "${backendDir}" && source venv/bin/activate && python scraper.py ${args}`;
```

**Fix:** Use `execFile` with args array:
```typescript
import { execFile } from 'child_process';
execFile('python3', ['scraper.py', '--location', location, '--min_price', String(minPrice)], ...);
```

### 1.3 Remove Hardcoded Credential Fallbacks

**Files:**
- `src/lib/db.ts:12` — Remove `|| 'root_password_change_me_please'`, throw if no credentials
- `src/app/api/mortgage-rates/route.ts:6` — Remove `|| '95f42f356f5131f13257eac54897e96a'`

### 1.4 Restrict Docker Service Exposure

**File:** `infrastructure/docker-compose.yml`

Bind internal services to `127.0.0.1` or remove `ports:` mappings:
- PostgreSQL `5432` → remove (line 70)
- Redis `6379` → remove (line 89)
- pg_tileserv `7800` → remove (line 105)
- n8n `5678` → keep only if external access needed
- Scraper `8001` → remove (line 76)

Add Redis auth: `command: redis-server --appendonly yes --requirepass <password>`

---

## Phase 2: Authentication & API Security (Days 2-3)

> **Goal:** Every endpoint has identity and authorization.

### 2.1 Implement Authentication Middleware

**File:** `src/middleware.ts`

Replace the no-op middleware with NextAuth.js or a JWT-based solution:
```typescript
// Protect all routes except public ones
const publicPaths = ['/', '/login', '/pricing', '/api/webhooks', '/api/health'];
if (!publicPaths.some(p => pathname.startsWith(p))) {
  // Verify JWT/session
}
```

### 2.2 Protect Admin Routes

**Files:** `src/app/api/admin/seed-jobs/route.ts:4`, `src/app/api/admin/reset-jobs/route.ts:4`

Add RBAC check — require admin role in session/JWT before executing.

### 2.3 Validate Stripe Checkout Price IDs

**File:** `src/app/api/checkout/route.ts:20-39`

Whitelist valid prices server-side:
```typescript
const VALID_PRICES = [
  process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_AGENCY
];
if (!VALID_PRICES.includes(priceId)) {
  return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
}
```

### 2.4 Validate Stripe Metadata Ties to Authenticated User

**File:** `src/app/api/webhooks/route.ts:8-9`

The webhook handler trusts `session.metadata.userId` set from the unauthenticated client. Tie this to the JWT/session of the authenticated user during checkout creation.

### 2.5 Add Input Validation (Zod) to All Endpoints

**Files:** All `src/app/api/*/route.ts` files

Currently only `viewport/route.ts` uses Zod. Add schemas for:
- `/api/properties` — validate `ids` are UUIDs, cap at 100
- `/api/clusters` — validate numeric bounds
- `/api/estimate-rent` — validate lat/lon ranges
- `/api/seed` — validate location length/characters
- `/api/admin/*` — validate all inputs

### 2.6 Sanitize All Error Responses

**Files:** Multiple `route.ts` files

Stop returning `error.message` to clients (leaks Postgres schema details):
- `src/app/api/clusters/route.ts:37`
- `src/app/api/estimate-rent/route.ts:64`
- `src/app/api/admin/reset-jobs/route.ts:23`
- `src/app/api/seed/route.ts:46`
- `src/app/api/webhooks/route.ts:87`

Return generic messages; log full errors server-side.

### 2.7 Add Rate Limiting to All API Routes

**File:** `src/lib/rate-limit.ts`

Currently only `viewport/route.ts` uses rate limiting. Apply `checkRateLimit(ip)` to:
- `/api/checkout`
- `/api/scrape`
- `/api/seed`
- `/api/admin/*`
- `/api/properties` (read)

Fix the bypass when `x-forwarded-for` is missing (line 28 of viewport route).

---

## Phase 3: Code Quality & Type Safety (Days 3-5)

> **Goal:** Eliminate `any`, consolidate duplicates, split monoliths.

### 3.1 Create Shared Types

**New file:** `src/types/property.ts`

```typescript
export interface Property {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  latitude: number;
  longitude: number;
  status: string;
  images: string[];
  financial_snapshot: FinancialSnapshot;
  raw_data: Record<string, any>;
  created_at?: string;
}

export interface FinancialSnapshot {
  bedrooms: number;
  bathrooms: number;
  sqft: number;
}
```

Replace all 3 inconsistent `Property` interfaces in `page.tsx:12-23`, `compare/page.tsx:7-16`, `PropertyMap.tsx:8`.

### 3.2 Extract Shared Utilities

**File:** `src/lib/utils.ts`

Add these functions (currently duplicated 5-6 times):
```typescript
export const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

export const formatPercent = (val: number) => `${(val * 100).toFixed(2)}%`;

export function extractImages(raw: Record<string, any>): string[] { ... }
```

Remove duplicates from: `property/[id]/page.tsx:105`, `ui/card.tsx:35`, `compare/page.tsx:68`, `AdvancedRentEstimator.tsx:87`, `PropertyReport.tsx:13`.

### 3.3 Eliminate `@ts-ignore` Usages

| File:Line | Fix |
|-----------|-----|
| `src/app/page.tsx:67` | Type `getProperties` return as `Property[]` |
| `src/app/page.tsx:72-75` | Same — types fix the need for ignore |
| `src/app/pricing/page.tsx:106` | Use `@ts-expect-error` with comment, or proper Stripe types |
| `src/lib/db.ts:24` | Type the query wrapper properly |

### 3.4 Type All Component Props

Eliminate `property: any` in:
- `src/components/ui/card.tsx:22`
- `src/components/PropertyReport.tsx:4`
- `src/components/CashflowCalculator.tsx:43`
- `src/components/AdvancedRentEstimator.tsx:28`

### 3.5 Split Monolith Components

**`src/app/property/[id]/page.tsx` (675 lines) → split into:**
- `src/app/property/[id]/page.tsx` — Server component, data fetching
- `src/components/property/PropertyOverview.tsx` — Overview tab
- `src/components/property/PropertyFinancials.tsx` — Financials tab
- `src/components/property/PropertyMarket.tsx` — Market tab with charts
- `src/components/property/PropertyExport.tsx` — PDF export logic

**`src/components/CashflowCalculator.tsx` (352 lines):**
- Remove duplicate `Label`/`InputField`/`SliderField` components (lines 195-237) — use existing `src/components/ui/form.tsx` primitives

### 3.6 Move PropertyCard Out of UI Primitives

**From:** `src/components/ui/card.tsx` (contains 150-line business component)
**To:** `src/components/PropertyCard.tsx`

### 3.7 Consolidate Financial Libraries

**Files:** `src/lib/calculators.ts` + `src/lib/finance.ts`

`finance.ts` defines `analyzeDeal`, `calculateMortgageConstant`, `calculateRequiredRent` — not used in any component. Either integrate into `calculators.ts` or remove.

---

## Phase 4: Performance Optimization (Days 5-7)

> **Goal:** Sub-second initial load, 80% less data transfer.

### 4.1 Dynamic Import Heavy Libraries (~500KB savings)

**File:** `src/app/property/[id]/page.tsx`

| Library | Current | Fix | Savings |
|---------|---------|-----|---------|
| `mapbox-gl` | Eager in `PropertyMap.tsx:5` | `next/dynamic` with `{ ssr: false }` | ~200KB |
| `recharts` | Eager in `property/[id]/page.tsx:17` | Lazy-load market tab | ~200KB |
| `html2canvas` + `jspdf` | Eager in `property/[id]/page.tsx:15-16` | Dynamic import on click | ~110KB |

### 4.2 Strip `raw_data` from List Query

**File:** `src/app/actions.ts:64`

The list query selects the full `raw_data` JSONB column (5-50KB per row). The list card only needs price, rent, beds, baths, sqft, primary photo.

**Fix:** Replace `raw_data` with specific fields:
```sql
raw_data->>'primary_photo' as primary_photo,
listing_status as status,
```

**Impact:** ~80% less data per page load.

### 4.3 Server Components for Initial Data

**Files:** `src/app/page.tsx`, `src/app/property/[id]/page.tsx`

Both are fully `'use client'`, forcing client-side data fetching with loading spinners.

**Fix:** Make page components Server Components that pass initial data to client sub-components:
```tsx
// page.tsx (Server Component)
import { getProperties } from '@/app/actions';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const initialProperties = await getProperties(1, 20);
  return <DashboardClient initialProperties={initialProperties} />;
}
```

### 4.4 Add Redis Caching to Server Actions

**File:** `src/app/actions.ts`

Redis is configured but never used for caching. Cache `getProperties` and `getProperty`:
```typescript
const cacheKey = `props:${sortBy}:${JSON.stringify(filters)}:${page}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
// ... query DB
await redis.setex(cacheKey, 60, JSON.stringify(result.rows));
```

### 4.5 Reduce Page Size + Cursor Pagination

**File:** `src/app/actions.ts:7`, `src/app/page.tsx:59`

- Change default limit from 100 → 25
- Switch from offset-based to cursor-based pagination
- Move `showSold` filter server-side (currently filtered client-side at `page.tsx:94-100`)

### 4.6 Use `next/image` for Property Photos

**Files:** `src/components/PropertyHero.tsx:32-34`, `src/components/ui/card.tsx:62-64`

Replace raw `<img>` with `next/image` for:
- Automatic WebP/AVIF conversion
- Responsive `srcset`
- Lazy loading
- Blur placeholders

Configure `next.config.ts`:
```typescript
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '*.mlslistings.com' },
    { protocol: 'https', hostname: '*.bcdn.com' },
  ]
}
```

### 4.7 Add Database Indexes

```sql
-- 1% rule sort (computed sort can't use indexes)
ALTER TABLE listings ADD COLUMN rent_price_ratio NUMERIC
  GENERATED ALWAYS AS (estimated_rent / NULLIF(price, 0)) STORED;
CREATE INDEX idx_listings_ratio ON listings(rent_price_ratio DESC NULLS LAST);

-- Composite index for common filter patterns
CREATE INDEX idx_listings_type_price_beds
  ON listings(listing_type, price, bedrooms, bathrooms);
```

### 4.8 Add Suspense Boundaries

**Files:** `src/app/page.tsx`, `src/app/property/[id]/page.tsx`

Wrap tab content and sections in `<Suspense>` for streaming and progressive rendering.

---

## Phase 5: Testing (Days 7-10)

> **Goal:** Critical paths covered by automated tests.

### 5.1 Set Up Test Infrastructure

- Install `vitest` + `@testing-library/react` + `@testing-library/jest-dom`
- Add `vitest.config.ts`
- Add `"test": "vitest"` and `"test:coverage": "vitest --coverage"` to `package.json`

### 5.2 Unit Tests for Core Logic

**Priority files to test:**
- `src/lib/calculators.ts` — `calculateMortgage`, `calculatePropertyMetrics` (pure functions, easy wins)
- `src/lib/rate-limit.ts` — Verify rate limiting behavior
- `src/lib/db.ts` — Connection pool configuration
- `src/app/actions.ts` — Server action SQL building, parameterization

### 5.3 API Route Tests

- `/api/health` — Returns 200 with service status
- `/api/properties` — Returns properties for valid IDs, handles empty/invalid
- `/api/checkout` — Validates price IDs, rejects invalid inputs
- `/api/webhooks` — Signature verification, event handling

### 5.4 E2E Tests (Playwright)

Cover critical user flows:
1. Dashboard loads → filter by price → property cards appear
2. Click property → detail page loads → tabs switch
3. Compare page → select 2 properties → side-by-side view
4. Pricing page → checkout flow (with test Stripe keys)

---

## Phase 6: CI/CD & DevOps (Days 10-12)

> **Goal:** Automated quality gates and safe deployments.

### 6.1 GitHub Actions CI

**New file:** `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run build
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
```

### 6.2 Docker Improvements

- Add `.dockerignore` (exclude `node_modules`, `.git`, `.next`, `.env*`, `venv`)
- Add `HEALTHCHECK` instruction to Dockerfile
- Pin image versions: `postgis/postgis:16-3.4-alpine`, `redis:7-alpine`

### 6.3 Environment Documentation

**New file:** `.env.example`

```
DATABASE_URL=
REDIS_URL=
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PRICE_ID_PRO=
NEXT_PUBLIC_STRIPE_PRICE_ID_AGENCY=
FRED_API_KEY=
HUD_API_TOKEN=
```

### 6.4 Error Monitoring

- Add Sentry or similar (e.g., `@sentry/nextjs`)
- Add structured logging (`pino`) to replace `console.error`/`console.warn`
- Add `Cache-Control: no-store` to health endpoint

### 6.5 Metadata & SEO

**File:** `src/app/layout.tsx:16-17`

Replace boilerplate:
```typescript
export const metadata: Metadata = {
  title: "1% Real Estate — Find Rental Properties That Pass the 1% Rule",
  description: "Analyze real estate investments in seconds. Find properties that cash flow, compare deals, and export reports.",
  openGraph: { ... },
};
```

---

## Phase 7: UX Polish & Remaining Items (Days 12-14)

### 7.1 Replace `alert()` with Toast Notifications

**Files:** `src/app/pricing/page.tsx:111`, `src/app/property/[id]/page.tsx:80`

Use `sonner` or `react-hot-toast` for non-blocking notifications.

### 7.2 Add Error Boundaries

**New files:** `src/app/error.tsx`, `src/app/property/[id]/error.tsx`

Catch rendering errors and show fallback UI instead of blank pages.

### 7.3 Add Loading States

**New files:** `src/app/loading.tsx`, `src/app/property/[id]/loading.tsx`

Skeleton loaders instead of full-screen spinners.

### 7.4 Fix Animation Performance

**File:** `src/app/page.tsx:178`

With 100 cards × 50ms delay = 5s animation. Only animate first ~10 visible cards.

### 7.5 Client-Side Filter Fix

**File:** `src/app/page.tsx:94-100`

`showSold` is filtered client-side after loading all data from DB. Move to server-side WHERE clause.

---

## Implementation Order

| Phase | Focus | Effort | Risk Reduction |
|-------|-------|--------|----------------|
| **1** | Credential rotation + command injection fix | 1 day | Critical security |
| **2** | Auth + API security | 2 days | High security |
| **3** | Code quality + types | 2-3 days | Maintainability |
| **4** | Performance optimization | 2-3 days | User experience |
| **5** | Testing infrastructure | 3 days | Confidence to ship |
| **6** | CI/CD + DevOps | 2 days | Deployment safety |
| **7** | UX polish | 2 days | Professional finish |

**Total estimated effort:** ~14-15 days for one developer.

---

## Files Changed Summary

### New Files
- `src/types/property.ts`
- `src/components/PropertyCard.tsx`
- `src/components/property/PropertyOverview.tsx`
- `src/components/property/PropertyFinancials.tsx`
- `src/components/property/PropertyMarket.tsx`
- `src/components/property/PropertyExport.tsx`
- `.github/workflows/ci.yml`
- `.dockerignore`
- `.env.example`
- `vitest.config.ts`
- `src/app/error.tsx`
- `src/app/property/[id]/error.tsx`
- `src/app/loading.tsx`
- `src/app/property/[id]/loading.tsx`

### Modified Files
- `src/middleware.ts` — Add authentication
- `src/app/page.tsx` — Server component split, dynamic imports, reduce page size
- `src/app/layout.tsx` — Fix metadata
- `src/app/actions.ts` — Add caching, strip raw_data, fix types
- `src/app/property/[id]/page.tsx` — Split into tab components, dynamic imports
- `src/app/api/scrape/route.ts` — Fix command injection
- `src/app/api/fetch-rentals/route.ts` — Fix command injection
- `src/app/api/checkout/route.ts` — Validate price IDs
- `src/app/api/webhooks/route.ts` — Sanitize errors, validate metadata
- `src/app/api/properties/route.ts` — Add input validation
- `src/app/pricing/page.tsx` — Fix metadata, replace alert
- `src/components/PropertyMap.tsx` — Dynamic import
- `src/components/PropertyHero.tsx` — Use next/image
- `src/components/ui/card.tsx` — Extract PropertyCard, use next/image
- `src/components/CashflowCalculator.tsx` — Remove duplicate components
- `src/components/PropertyReport.tsx` — Type props, use shared utils
- `src/components/AdvancedRentEstimator.tsx` — Type props, use shared utils
- `src/lib/utils.ts` — Add formatCurrency, formatPercent, extractImages
- `src/lib/db.ts` — Remove hardcoded password fallback
- `src/lib/calculators.ts` — Consolidate with finance.ts
- `src/app/api/mortgage-rates/route.ts` — Remove hardcoded API key
- `infrastructure/docker-compose.yml` — Restrict port exposure
- `Dockerfile` — Add HEALTHCHECK
- `package.json` — Add test scripts, add vitest/testing deps
- `tsconfig.json` — No changes needed
