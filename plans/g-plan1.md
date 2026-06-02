# G-Plan 1 — OnePercentRealEstate Comprehensive Improvement Plan

**Date:** 2026-05-31
**Scope:** Full-stack deep audit — security, performance, architecture, code quality, UX, product, DevOps
**Methodology:** Multi-pass analysis across 50+ files with 3 specialized subagents (frontend perf, backend/data, product/UX)
**Context:** 1.2M properties scraped, targeting 10M+. App is functional but unhardened.

---

## Table of Contents

1. [Executive Summary & Scorecard](#executive-summary--scorecard)
2. [Tier 0 — Emergency Security (Hours)](#tier-0--emergency-security-hours)
3. [Tier 1 — Data Integrity & Correctness (Days)](#tier-1--data-integrity--correctness-days)
4. [Tier 2 — Frontend Performance (Week 1)](#tier-2--frontend-performance-week-1)
5. [Tier 3 — Backend & Data Layer Performance (Week 1-2)](#tier-3--backend--data-layer-performance-week-1-2)
6. [Tier 4 — Architecture & Code Quality (Week 2-3)](#tier-4--architecture--code-quality-week-2-3)
7. [Tier 5 — Product & UX (Week 3-4)](#tier-5--product--ux-week-3-4)
8. [Tier 6 — DevOps, Monitoring & CI/CD (Week 4+)](#tier-6--devops-monitoring--cicd-week-4)
9. [Backlog — Future Consideration (Post-Launch)](#backlog--future-consideration-post-launch)
10. [Cross-Cutting: Testing Strategy](#cross-cutting-testing-strategy)
11. [Appendix A: Complete Issue Index](#appendix-a-complete-issue-index)
12. [Appendix B: Quick Wins Cheat Sheet](#appendix-b-quick-wins-cheat-sheet)
13. [Appendix C: Cross-Reference Sources](#appendix-c-cross-reference-sources)

---

## Executive Summary & Scorecard

OnePercentRealEstate has strong architectural bones — PostGIS spatial queries, server-side map clustering, a multi-source rent estimation engine, and a well-documented upgrade path. However, it has critical security holes, zero tests, no observability, and several correctness bugs in its financial calculators that could mislead investors. Cross-referencing with dsi-plan1, m-plan1, and k-plan1 revealed 29 additional gaps including git history secret exposure, a second SQL injection vector, Stripe payment security flaws, and missing database backups.

### Scorecard

| Area | Score | Status |
|------|-------|--------|
| **Security** | 1/10 | Command injection, ORDER BY SQL injection, no auth, exposed credentials in git history, Stripe payment bypasses, no security headers, open DB/Redis ports |
| **Performance** | 3/10 | 1.1MB+ JS bundles, no dynamic imports, zero Suspense, full JSONB in list views, no TanStack Query, no debounce on filters |
| **Data Correctness** | 4/10 | PMI in NOI corrupts capRate; zero-interest mortgage returns 0; connection leaks; null price shows "$0"; schema drift causes silent data loss |
| **Code Quality** | 4/10 | 675-line monolith property page, `any` types, `@ts-ignore`, no separation of concerns, 71 console.log in prod, no migration tooling, no env validation |
| **Testing** | 0/10 | Zero test files anywhere in the codebase |
| **UX/Product** | 3/10 | No mobile nav, boilerplate metadata, missing investor filters, no favorites, no error states |
| **CI/CD** | 0/10 | No pipeline, manual SSH deploy with plaintext passwords |
| **Monitoring** | 0/10 | Zero observability, no APM, no structured logging (Node or Python) |
| **Accessibility** | 1/10 | No ARIA tabs, invisible compare checkbox, `alert()` usage, contrast failures, no image alt text, color-only indicators, no lightbox keyboard nav |
| **Data Safety** | 1/10 | No database backups, no migration tooling, no retention policy |

**Total estimated issues found: 127** (16 critical, 31 high, 43 medium, 26 low, 11 backlog)

---

## Tier 0 — Emergency Security (Hours)

> **Goal:** Stop active security bleeding. These are exploitable today.

### 0.1 OS Command Injection in `/api/scrape`

**Severity:** CRITICAL
**Files:** `src/app/api/scrape/route.ts:15-31`, `src/app/api/fetch-rentals/route.ts:15-22`

User input (`location`, `minPrice`, `maxPrice`, `beds`, `baths`, `limit`) is interpolated into a shell command via `child_process.exec`:

```typescript
let args = `--location "${location}"`;
const command = `cd "${backendDir}" && source venv/bin/activate && python scraper.py ${args}`;
exec(command, ...);
```

Double quotes do NOT protect against shell injection. `location: '"; rm -rf /; echo "'` escapes the quotes and executes arbitrary commands.

**Fix:**
1. Replace `exec` with `execFile` or `spawn` using an argument array (no shell interpolation)
2. Add Zod validation schema for all inputs
3. Add API key or auth check to the endpoint
4. Add a `timeout` option (e.g., 60s)

```typescript
import { execFile } from 'child_process';

const schema = z.object({
  location: z.string().max(100),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  beds: z.number().int().min(0).max(20).optional(),
  baths: z.number().min(0).max(20).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

const body = schema.parse(await req.json());
const args = ['scraper.py', '--location', body.location];
if (body.minPrice) args.push('--min-price', String(body.minPrice));
// ...

execFile('python', args, { cwd: backendDir, timeout: 60000 }, (error, stdout, stderr) => { ... });
```

### 0.2 No Authentication on Any Endpoint

**Severity:** CRITICAL
**Files:** `src/middleware.ts:1-8`

Middleware is a pass-through. All API routes are publicly accessible. The matcher (`middleware.ts:13`) explicitly **excludes** `/api` routes, meaning even if auth were re-enabled, API routes would remain unprotected.

**Immediate fix:**
1. Add API key check to dangerous endpoints (`/api/scrape`, `/api/seed`, `/api/admin/*`)
2. Plan NextAuth.js integration (see Tier 4)

### 0.3 Rotate All Exposed Credentials

**Severity:** CRITICAL
**Files:** `infrastructure/setup_server.sh:9`, `deploy_production.exp`, `docker-compose.yml:18,43,59,103`, `src/lib/db.ts:12`

| Secret | Location | Action |
|--------|----------|--------|
| Server root password `appo0-buXbym-cijzy` | All `.exp` files, `setup_server.sh` | Rotate VPS password immediately |
| Postgres password `root_password_change_me_please` | `db.ts:12`, `docker-compose.yml:18,59,103`, 8 Python files | Generate new, update all references |
| n8n password `n8n_password_change_me_please` | `docker-compose.yml:43` | Rotate |
| Stripe live keys (`sk_live_...`, `pk_live_...`) | `.env.local:3-4` | Rotate in Stripe dashboard |
| FRED API key | `.env.local:12` | Rotate at api.stlouisfed.org |

**Action:**
1. `git rm` all `.exp` files; add `*.exp` to `.gitignore`
2. Move all secrets from `docker-compose.yml` to `.env` with `env_file:` directive
3. Remove hardcoded defaults from `db.ts` — fail fast if `DATABASE_URL` unset
4. Create `.env.example` with placeholder values only

### 0.4 Exposed Database & Redis Ports

**Severity:** CRITICAL
**Files:** `infrastructure/docker-compose.yml:69-70` (Postgres), `88-89` (Redis)

```yaml
ports:
  - "5432:5432"  # Postgres — open on all interfaces
  - "6379:6379"  # Redis — no auth, open on all interfaces
```

**Fix:**
1. Remove host port mappings entirely (containers communicate via Docker network)
2. If host access is needed, bind to localhost only: `"127.0.0.1:5432:5432"`
3. Add Redis password: `command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}`

### 0.5 `StrictHostKeyChecking=no` in Deploy Scripts

**Severity:** HIGH
**Files:** All `.exp` files

All deploy scripts disable SSH host key checking, enabling man-in-the-middle attacks.

**Fix:** Switch to SSH key-based auth. Add the server's host key to `~/.ssh/known_hosts` once, then remove `StrictHostKeyChecking=no`.

### 0.6 Purge `.env.local` from Git History

**Severity:** CRITICAL
**Source:** k-plan1 (P0)
**Files:** `.env.local` (committed to git with live secrets)

`.env.local` was committed to git with live Stripe keys (`sk_live_...`, `pk_live_...`), FRED API key, and database URLs. Simply removing the file and rotating keys is **insufficient** — secrets remain in the git commit history and can be extracted by anyone with repo access.

**Fix:**
1. Rotate ALL exposed credentials immediately (see 0.3)
2. Use `git filter-repo` or BFG Repo-Cleaner to purge `.env.local` from entire git history:

```bash
pip install git-filter-repo
git filter-repo --invert-paths --path .env.local --force
```

3. Force-push the rewritten history (requires all collaborators to re-clone)
4. Add `.env.local` to `.gitignore` (should already be there, verify)
5. Verify no other secret files are in history: `git log --all --full-history -- '*.env*' '*.exp' '*password*'`

### 0.7 SQL Injection in ORDER BY Clause

**Severity:** CRITICAL
**Source:** dsi-plan1 (Scale 1.6)
**File:** `src/app/actions.ts:69`

```typescript
const query = `SELECT ... FROM listings WHERE ... ORDER BY ${orderBy} ...`;
```

`orderBy` is interpolated directly into SQL. While currently gated by a fixed set of allowed values, if the enum is bypassed or extended without updating the allowlist, this is a direct SQL injection vector. Unlike parameterized values (`$1`, `$2`), ORDER BY cannot use query parameters — it must be validated against an explicit allowlist.

**Fix:**

```typescript
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  'price_asc': 'listing_price ASC',
  'price_desc': 'listing_price DESC',
  'rent_desc': 'estimated_rent DESC',
  'created_desc': 'created_at DESC',
  'rent_price_ratio_desc': 'rent_price_ratio DESC',
};

const sortClause = ALLOWED_SORT_COLUMNS[orderBy] ?? 'created_at DESC';
const query = `SELECT ... FROM listings WHERE ... ORDER BY ${sortClause} ...`;
```

### 0.8 Error Responses Leak Internal Schema Details

**Severity:** HIGH
**Source:** m-plan1 (Phase 2.6)
**Files:** `src/app/api/clusters/route.ts:37`, `src/app/api/estimate-rent/route.ts:64`, `src/app/api/admin/reset-jobs/route.ts:23`, `src/app/api/seed/route.ts:46`, `src/app/api/webhooks/route.ts:87`

Multiple API routes return `error.message` directly to clients. Postgres error messages include table names, column names, constraint names, and sometimes data values. This leaks schema information to attackers.

```typescript
return Response.json({ error: error.message }, { status: 500 });
```

**Fix:** Create a safe error helper and use it everywhere:

```typescript
// src/lib/api-error.ts
export function safeErrorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const isDev = process.env.NODE_ENV === 'development';
  return Response.json(
    { error: isDev ? message : 'Internal server error' },
    { status }
  );
}
```

### 0.9 Add HTTP Security Headers

**Severity:** HIGH
**Source:** dsi-plan1 (Scale 2.10)
**File:** `next.config.ts`

No Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, or Referrer-Policy headers. Standard production hardening is completely absent.

**Fix:** Add security headers via `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://api.mapbox.com; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src 'self' data: https:; connect-src 'self' https://api.mapbox.com https://events.mapbox.com;" },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      ],
    }];
  },
};
```

Start with `Content-Security-Policy-Report-Only` to validate before enforcing.

---

## Tier 1 — Data Integrity & Correctness (Days)

> **Goal:** Fix bugs that produce wrong financial results or risk data loss.

### 1.1 PMI Included in NOI, Corrupting Cap Rate

**Severity:** HIGH (misleads investors)
**File:** `src/lib/calculators.ts:100-117`

```typescript
const monthlyOperatingExpenses = vacancyAmount + managementAmount + monthlyPMI
  + monthlyPropertyTax + monthlyInsurance + monthlyMaintenance + monthlyCapEx;
const noi = (rent * 12) - (monthlyOperatingExpenses * 12);
const capRate = price > 0 ? (noi / price) * 100 : 0;
```

Cap rate is an **unlevered** metric — it must exclude all financing costs (mortgage, PMI). Including PMI in operating expenses understates the cap rate, potentially causing investors to reject good deals.

**Fix:** Compute NOI both levered and unlevered:

```typescript
const monthlyUnleveredExpenses = vacancyAmount + managementAmount
  + monthlyPropertyTax + monthlyInsurance + monthlyMaintenance + monthlyCapEx;
const unleveredNOI = (rent * 12) - (monthlyUnleveredExpenses * 12);
const capRate = price > 0 ? (unleveredNOI / price) * 100 : 0;
```

### 1.2 Zero Interest Rate Returns Mortgage = 0

**Severity:** HIGH
**File:** `src/lib/calculators.ts:58`

```typescript
if (principal <= 0 || annualRate <= 0 || years <= 0) return 0;
```

A zero-interest loan still has monthly payments: `principal / (years * 12)`. Returning 0 makes deals look impossibly good.

**Fix:**

```typescript
if (principal <= 0 || years <= 0) return 0;
if (annualRate <= 0) return principal / (years * 12);
```

### 1.3 Cash-on-Cash Ignores Closing Costs

**Severity:** MEDIUM
**File:** `src/lib/calculators.ts:121`

```typescript
const cashOnCash = downPayment > 0 ? (annualCashflow / downPayment) * 100 : 0;
```

Closing costs (2-5% of purchase price) are a significant real-world cost. Omitting them inflates CoC return.

**Fix:** Add closing costs to the denominator:

```typescript
const totalCashInvested = downPayment + (price * closingCostPercent);
const cashOnCash = totalCashInvested > 0 ? (annualCashflow / totalCashInvested) * 100 : 0;
```

### 1.4 DB Connection Leaks (No try/finally)

**Severity:** HIGH (pool exhaustion under load)
**Files:** `src/app/actions.ts:75-77, 128-134, 175-177, 252-260`, `src/app/api/mortgage-rates/route.ts:13,59`, `src/app/api/webhooks/route.ts:13,23`, `src/app/api/properties/route.ts:20,43`, `src/app/api/map/clusters/route.ts:15,105`, `src/app/api/seed/route.ts:62,121`

Every `pool.connect()` + `client.release()` pair lacks `try/finally`. If any code between them throws, the connection leaks permanently. With `max: 20` connections, a few leaks exhaust the pool and hang all future requests.

**Fix:** Always wrap in `try/finally`:

```typescript
const client = await pool.connect();
try {
  const result = await client.query(query, params);
  // ...
} finally {
  client.release();
}
```

Or use `pool.query()` directly for single-query operations (auto-releases).

### 1.5 Division by Zero in `calculateRequiredRent`

**Severity:** MEDIUM
**File:** `src/lib/finance.ts:88`

```typescript
(annualDebtService * targetDSCR + fixedCosts) / (1 - variableExpenseRate)
```

If `vacancyRate + managementRate >= 1.0`, this divides by zero or a negative number, producing `Infinity`.

**Fix:** Add guard:

```typescript
if (variableExpenseRate >= 0.95) return Infinity;
```

### 1.6 Price/sqft Division by Zero

**Severity:** MEDIUM
**File:** `src/app/property/[id]/page.tsx:167`

```typescript
Math.round(listing_price / (raw_data?.sqft || 1))
```

When sqft is 0 or null, `|| 1` produces absurd values (e.g., $200,000/sqft).

**Fix:**

```typescript
raw_data?.sqft > 0 ? `$${Math.round(listing_price / raw_data.sqft).toLocaleString()}/sqft` : 'N/A'
```

### 1.7 `analyzeDeal` Double-Computes Fixed Costs

**Severity:** LOW
**File:** `src/lib/finance.ts:114-143`

`analyzeDeal` calls `calculateRequiredRent` (which calls `calculateFixedCostFloor` internally), then calls `calculateFixedCostFloor` again on line 123. Redundant computation.

**Fix:** Cache the result:

```typescript
const fixedCosts = calculateFixedCostFloor(price, sqft, taxRate, insuranceRate, condition);
const requiredRent = calculateRequiredRent(price, downPaymentPercent, interestRate, loanTerm, fixedCosts, vacancyRate, managementRate, targetDSCR);
```

### 1.8 PropertyMap Source ID Mismatch — Cluster Layers Silently Broken

**Severity:** HIGH (feature broken)
**Source:** dsi-plan1 (Scale 1.1)
**File:** `src/components/PropertyMap.tsx`

Cluster layers (`clusterLayer`, `clusterCountLayer`, `unclusteredPointLayer`) reference `source: 'properties'` (lines 27, 37, 49, 62), but the `<Source>` component has `id="listings-source"` (line 157). This means cluster and heatmap layers **never render** — only the `listings-circle` layer works because it correctly references `listings-source`.

This bug is invisible to users (the map still shows circles) but the clustering UX is completely non-functional.

**Fix:**
1. Align all layer source references to `listings-source` (or rename the source to `properties`)
2. Or remove the dead cluster layers entirely if MVT tiles are the intended approach (see 3.18)

### 1.9 Schema/Application Column Drift — Silent Data Loss

**Severity:** HIGH (data loss)
**Source:** dsi-plan1 (Scale 1.3)
**Files:** `infrastructure/listings_schema.sql` vs `_backend/scraper.py` vs `_backend/scraper_service/main.py`

Column mismatches between the DB schema and what the application inserts:
- `images` column: inserted by scraper but missing from schema definition
- `user_id` column: referenced in code but missing from schema
- `status` vs `listing_status`: naming conflict between schema and app code
- `expense_ratio`: hardcoded in one path but computed differently in another

When the scraper inserts columns that don't exist in the schema, PostgreSQL silently drops them (no error if using `INSERT` without column list, or errors if using explicit columns). Either way, data is lost.

**Fix:**
1. Audit all INSERT statements across both scraper implementations against the actual schema
2. Create a migration that adds missing columns (`images`, `user_id`, etc.)
3. Resolve naming conflicts (`status` → `listing_status` everywhere, or vice versa)
4. Add schema validation test that compares expected vs actual columns

### 1.10 Null Price Displayed as "$0"

**Severity:** HIGH (misleading)
**Source:** dsi-plan1 (Scale 2.3)
**File:** `src/app/actions.ts:106`

```typescript
Number(null) // returns 0
```

When `listing_price` is null, `Number(null)` returns 0, which is then formatted as "$0" in the frontend instead of "Price unavailable". This misleads investors into thinking a property is free or has an error.

**Fix:**

```typescript
const price = row.listing_price != null ? Number(row.listing_price) : null;
// In the frontend:
{price != null ? formatCurrency(price) : 'Price unavailable'}
```

Apply this pattern to all numeric fields that could be null (rent, sqft, etc.).

### 1.11 Stripe Checkout — No Price ID Validation

**Severity:** HIGH (financial risk)
**Source:** m-plan1 (Phase 2.3)
**File:** `src/app/api/checkout/route.ts:20-39`

The checkout endpoint accepts a `priceId` from the client and passes it directly to `stripe.checkout.sessions.create()`. Without server-side validation, a user could submit any valid Stripe price ID — potentially a test price, a price from another product, or a manipulated price amount.

**Fix:** Whitelist valid price IDs server-side:

```typescript
const VALID_PRICE_IDS: Record<string, string> = {
  'monthly': 'price_live_monthly_id',
  'annual': 'price_live_annual_id',
};

const validatedPriceId = VALID_PRICE_IDS[body.plan];
if (!validatedPriceId) {
  return Response.json({ error: 'Invalid plan' }, { status: 400 });
}
```

### 1.12 Stripe Webhook — No Idempotency Handling

**Severity:** HIGH (double-charges, double-updates)
**Source:** dsi-plan1 (Scale 5.2)
**File:** `src/app/api/webhooks/route.ts`

Stripe can deliver the same webhook event multiple times. Without idempotency handling, duplicate events could:
- Double-charge a customer
- Double-update subscription status
- Create duplicate database records

**Fix:** Store processed webhook event IDs in Redis with a 24h TTL:

```typescript
const eventId = event.id;
const alreadyProcessed = await redis.get(`webhook:${eventId}`);
if (alreadyProcessed) {
  return Response.json({ received: true }); // Already handled, acknowledge
}

// Process the event...
await handleEvent(event);

// Mark as processed
await redis.set(`webhook:${eventId}`, '1', 'EX', 86400); // 24h TTL
```

### 1.13 Stripe Metadata — Unauthenticated Client Controls userId

**Severity:** HIGH (auth bypass)
**Source:** m-plan1 (Phase 2.4)
**File:** `src/app/api/webhooks/route.ts:8-9`

The webhook handler trusts `session.metadata.userId` that was set from the unauthenticated client during checkout creation. A malicious user can set any `userId` in metadata, potentially getting another user's subscription credited to their account.

**Fix:** Set `metadata.userId` server-side during checkout creation from the authenticated session, not from client-supplied data:

```typescript
// In checkout route (after auth is implemented):
const session = await stripe.checkout.sessions.create({
  // ...
  metadata: { userId: session.user.id }, // From auth, not client
});
```

### 1.14 Admin Routes Have No RBAC — Auth ≠ Admin Access

**Severity:** HIGH
**Source:** m-plan1 (Phase 2.2)
**Files:** `src/app/api/admin/seed-jobs/route.ts:4`, `src/app/api/admin/reset-jobs/route.ts:4`

Admin endpoints (`/api/admin/seed-jobs`, `/api/admin/reset-jobs`) have no role-based access control. Even when auth is implemented (0.2, 4.2), a regular authenticated user could hit these admin endpoints. Admin routes need elevated privilege checks — not just "is authenticated" but "is admin".

**Fix:**

```typescript
import { getServerSession } from 'next-auth';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
  // ... proceed with admin logic
}
```

---

## Tier 2 — Frontend Performance (Week 1)

> **Goal:** Reduce initial bundle by ~1MB, fix rendering performance, add proper loading states.

### 2.1 Dynamic Import html2canvas + jsPDF (~500KB savings)

**Severity:** CRITICAL (bundle size)
**File:** `src/app/property/[id]/page.tsx:15-16`

```typescript
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
```

Combined size: ~500-700KB minified. Only used when the user clicks "Export PDF". Loaded on every page visit.

**Fix:**

```typescript
const handleExportPdf = async () => {
  setExporting(true);
  try {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    // ... rest of export logic
  } catch (err) {
    console.error('PDF export failed:', err);
  } finally {
    setExporting(false);
  }
};
```

### 2.2 Dynamic Import recharts (~400KB savings)

**Severity:** HIGH
**Files:** `src/app/property/[id]/page.tsx:17-19`, `src/components/MarketTrends.tsx:4-12`, `src/components/PortfolioCharts.tsx:5-9`

recharts is ~400-500KB and imported statically in 3 files. Charts only render in specific tabs/sections.

**Fix:** Create thin wrapper components and dynamically import them:

```typescript
// src/components/charts/DealEconomicsChart.tsx
'use client';
import { BarChart, Bar, ... } from 'recharts';
export function DealEconomicsChart(props) { ... }

// Usage:
const DealEconomicsChart = dynamic(() => import('@/components/charts/DealEconomicsChart'), { ssr: false });
```

### 2.3 Use `next/image` Everywhere (No `<img>` Tags)

**Severity:** HIGH (CLS, no lazy loading, no WebP)
**Files:** `src/components/PropertyHero.tsx:31-36,43-48,56-61,93`, `src/components/ui/card.tsx:61-64`, `src/app/compare/page.tsx:98`

Zero usage of `next/image` in the entire codebase. 100+ PropertyCard images load at full resolution with no lazy loading, no responsive srcsets, and no CLS prevention.

**Fix:**
1. Add remote patterns to `next.config.ts`:

```typescript
images: {
  remotePatterns: [{ protocol: 'https', hostname: '**' }],
}
```

2. Replace all `<img>` with `<Image>` from `next/image`
3. Exception: `PropertyReport.tsx:56` can stay as `<img>` since html2canvas needs a real DOM element
4. Add `loading="lazy"` and `decoding="async"` to PropertyCard images as a quick fix

### 2.4 Memoize PropertyCard + Stabilize Callbacks

**Severity:** HIGH (re-render performance)
**Files:** `src/components/ui/card.tsx:27`, `src/app/page.tsx:102-114`

`PropertyCard` is not wrapped in `React.memo`. When `toggleSelection` creates a new `Set` and calls `setSelectedProperties`, **every single PropertyCard re-renders**. With 100+ cards, this causes visible lag.

Additionally, `toggleSelection` is recreated every render and passed as `onSelect`, preventing any memoization from working.

**Fix:**

```typescript
// card.tsx
export const PropertyCard = React.memo(function PropertyCard({ property, isSelected, onSelect }: PropertyCardProps) {
  const { isOnePercentRule, monthlyCashflow } = useMemo(
    () => calculatePropertyMetrics(property.listing_price, property.estimated_rent),
    [property.listing_price, property.estimated_rent]
  );
  // ...
});

// page.tsx
const toggleSelection = useCallback((id: string) => {
  setSelectedProperties(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
}, []);
```

### 2.5 Module-Level `Intl.NumberFormat` (Repeated Construction)

**Severity:** MEDIUM
**Files:** `src/components/ui/card.tsx:35-36`, `src/app/property/[id]/page.tsx:105-108`, `src/app/compare/page.tsx:68-69`, `src/components/PropertyReport.tsx:13-14`, `src/components/AdvancedRentEstimator.tsx:87-93`

`Intl.NumberFormat` is created inside component render bodies. With 100 PropertyCards, this creates 100 formatters per render cycle.

**Fix:** Move to module scope:

```typescript
// src/lib/format.ts
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
export const formatCurrency = (val: number) => currencyFormatter.format(val);
```

### 2.6 Add `loading.tsx` and `error.tsx` Files

**Severity:** HIGH (UX)
**Files:** None exist — zero `loading.tsx` or `error.tsx` in the entire app directory

Users see a blank screen or full-screen spinner until client-side data fetch completes. No instant navigation states. Any runtime error crashes the entire page with no recovery.

**Fix:** Create at minimum:

```
src/app/loading.tsx           — Global skeleton
src/app/error.tsx             — Global error boundary with retry
src/app/property/[id]/loading.tsx — Property skeleton
src/app/compare/loading.tsx   — Compare skeleton
```

### 2.7 Convert Pages to Server Components

**Severity:** HIGH (SEO, FCP)
**Files:** `src/app/page.tsx:1`, `src/app/property/[id]/page.tsx:1`, `src/app/compare/page.tsx:1`

All main pages are `'use client'` with `useEffect` data fetching. No server-rendered HTML, no streaming, no SEO benefit from the App Router.

**Fix for property/[id]/page.tsx:**

```typescript
// Server Component — data fetches on the server
export default async function PropertyPage({ params }) {
  const { id } = await params;
  const property = await getProperty(id);
  const benchmark = property?.raw_data?.zip_code
    ? await getHudBenchmark(property.raw_data.zip_code)
    : null;

  return <PropertyClientWrapper property={property} benchmark={benchmark} />;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const property = await getProperty(id);
  return {
    title: `${property?.address} — 1% Real Estate`,
    description: `${property?.listing_price ? formatCurrency(property.listing_price) : 'Property'} — ${property?.estimated_rent ? formatCurrency(property.estimated_rent) + '/mo rent' : 'Investment analysis'}`,
  };
}
```

### 2.8 Fix Data Waterfall on Property Page

**Severity:** HIGH
**File:** `src/app/property/[id]/page.tsx:30-51`

Property fetch and HUD benchmark fetch are sequential — HUD can't start until property returns (need zip_code). This adds 200-500ms latency.

**Fix:** Include HUD data in the `getProperty` server action (join at DB level), or if converting to Server Component, use `Promise.all` with a pre-computed zip code.

### 2.9 Remove Always-Mounted PropertyReport

**Severity:** MEDIUM
**File:** `src/app/property/[id]/page.tsx:117-119`

The `PropertyReport` component is always in the DOM (positioned off-screen at -9999px). The browser still lays out this element, and images inside it load even if the user never exports PDF.

**Fix:**

```typescript
{exporting && (
  <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
    <PropertyReport ref={reportRef} property={property} />
  </div>
)}
```

### 2.10 Conditional Render PropertyMap When Hidden

**Severity:** MEDIUM
**File:** `src/app/page.tsx:219-223`

On mobile, `PropertyMap` is hidden with `display: none` but remains mounted. The Mapbox GL instance still consumes memory and runs its render loop.

**Fix:**

```typescript
{showMap && <PropertyMap filters={mapFilters} />}
```

### 2.11 Add `experimental.optimizePackageImports` to next.config

**Severity:** MEDIUM
**File:** `next.config.ts`

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};
```

### 2.12 Remove Dead Cluster Layer Code

**Severity:** LOW
**File:** `src/components/PropertyMap.tsx:23-84`

~60 lines of unused cluster layer definitions (`clusterLayer`, `clusterCountLayer`, `unclusteredPointLayer`, `unclusteredLabelLayer`). The map uses tile-based rendering, not GeoJSON clusters.

### 2.13 Fix Heatmap/Circle Zoom Overlap

**Severity:** LOW
**File:** `src/components/PropertyMap.tsx:162-201`

Between zoom 12-13, both heatmap and circle layers render simultaneously. Set heatmap `maxzoom={12}` and circle `minzoom={12}` for a clean handoff.

### 2.14 Replace `alert()` with Toast Notifications

**Severity:** MEDIUM
**Files:** `src/app/page.tsx:108`, `src/app/property/[id]/page.tsx:80`, `src/app/pricing/page.tsx:111`

Three `alert()` calls block the UI thread. Replace with a toast component (sonner is recommended with shadcn/ui).

### 2.15 Debounce Filter Inputs (Slider Burst Requests)

**Severity:** HIGH
**Source:** dsi-plan1 (Scale 2.4)
**Files:** `src/app/page.tsx`, `src/components/PropertyFilters.tsx`

Price range slider, bedroom/bathroom selectors, and sort dropdown all trigger immediate DB queries via server actions. Rapid slider changes cause burst requests — each slider drag fires a separate `getProperties()` call that hits PostgreSQL. At 10M+ properties, each query is expensive.

**Fix:**

```typescript
import { useDebouncedCallback } from 'use-debounce';

const handleFilterChange = useDebouncedCallback((newFilters: FilterState) => {
  setFilters(newFilters);
}, 300); // 300ms debounce
```

Apply to all slider and range inputs. Text search should use 500ms debounce.

### 2.16 Add TanStack Query for Client-Side Data Fetching

**Severity:** HIGH (architectural)
**Source:** k-plan1 (P1)
**Files:** All client-side data fetching in `page.tsx`, `property/[id]/page.tsx`, `compare/page.tsx`

Currently, client components fetch data via `useEffect` + `fetch` with manual loading/error state management. This means:
- No request deduplication (multiple components fetching the same data)
- No background refetching
- No stale-while-revalidate
- No caching between navigations
- Manual `isLoading`/`isError` boilerplate everywhere

Server Actions used for data reads (not mutations) violate the intended Server Actions pattern — they should be for form submissions only.

**Fix:**
1. Install `@tanstack/react-query`
2. Create a `QueryClient` provider
3. Convert `getProperties`/`getProperty` from Server Actions to regular API routes
4. Use `useQuery` for reads, `useMutation` + Server Actions for mutations

```typescript
// src/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

// Usage:
const { data, isLoading, error } = useQuery({
  queryKey: ['properties', filters],
  queryFn: () => fetchProperties(filters),
});
```

---

## Tier 3 — Backend & Data Layer Performance (Week 1-2)

> **Goal:** Optimize for 10M property scale. Fix the most expensive queries and caching gaps.

### 3.1 Add Bounding Box Pre-filter to `calculate_smart_rent`

**Severity:** CRITICAL (5-30s per call at scale)
**File:** `infrastructure/smart_rent_estimate.sql:85-110`

The `scored_comps` CTE queries ALL `rental_listings` with matching bedrooms nationwide, then computes `ST_Distance` on every result. At 10M rental listings, this is O(N) where N = all matching-bedroom rentals nationwide.

**Fix:** Add bounding box pre-filter before distance calculation:

```sql
AND latitude BETWEEN p_lat - (p_radius_miles / 69.0)
                AND p_lat + (p_radius_miles / 69.0)
AND longitude BETWEEN p_lon - (p_radius_miles / (69.0 * cos(radians(p_lat))))
                  AND p_lon + (p_radius_miles / (69.0 * cos(radians(p_lat))))
```

This turns the query into an index range scan, reducing candidates from 500K to ~500.

### 3.2 Disable Rent Estimation Trigger During Bulk Inserts

**Severity:** CRITICAL (hours for bulk imports at scale)
**File:** `infrastructure/rent_estimation_trigger.sql:34-38`

Every listing INSERT fires `calculate_smart_rent`, which performs the full spatial scan from 3.1. Inserting 1000 listings = 1000 spatial scans = hours.

**Fix:**
1. Disable the trigger during bulk imports:

```sql
ALTER TABLE listings DISABLE TRIGGER set_smart_rent_estimate;
-- ... bulk INSERT ...
ALTER TABLE listings ENABLE TRIGGER set_smart_rent_estimate;
```

2. Batch-compute rent estimates after import using a separate job
3. Or change the trigger to only fire on UPDATE, not INSERT

### 3.3 Add Missing Composite Indexes

**Severity:** HIGH
**Files:** `infrastructure/add_performance_indexes.sql`, `infrastructure/smart_rent_estimate.sql`

Current indexes don't support real query patterns at 10M scale.

**Fix:**

```sql
-- For map clustering queries (listing_type + spatial)
CREATE INDEX idx_listings_lat_lon_type ON listings(latitude, longitude)
  WHERE listing_type = 'for_sale' AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- For smart rent estimation (rental_listings + spatial + beds)
CREATE INDEX idx_rental_listings_smart_rent ON rental_listings(latitude, longitude, bedrooms, price)
  WHERE price > 0 AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- For address lookup (replaces ILIKE '%address%')
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_listings_address_trgm ON listings USING GIN(address gin_trgm_ops);

-- For zip code lookups (replaces JSON extraction)
CREATE INDEX idx_listings_zip ON listings(zip_code) WHERE zip_code IS NOT NULL;

-- For crawl_jobs status queries
CREATE INDEX idx_crawl_jobs_status ON crawl_jobs(status);

-- Drop redundant single-column index
DROP INDEX idx_listings_listing_type;  -- covered by idx_listings_type_created
```

### 3.4 Add Redis Caching to All Read-Heavy Routes

**Severity:** CRITICAL (only 1 of 8 routes cached)
**Files:** Only `src/app/api/properties/viewport/route.ts` uses Redis

Uncached routes hitting PostgreSQL directly on every request:

| Route | Current | Recommended TTL |
|-------|---------|-----------------|
| `/api/clusters` | No cache | 300s (low zoom), 60s (high zoom) |
| `/api/map/clusters` | No cache | 300s (low zoom), 60s (high zoom) |
| `/api/estimate-rent` | No cache | 300s (key: `rent:${lat}:${lon}:${beds}`) |
| `/api/properties` | No cache | 60s |
| `/api/mortgage-rates` | PostgreSQL as cache | 86400s (FRED data updates daily) |

### 3.5 Fix Redis Connection Permanently Dies After 3 Retries

**Severity:** HIGH
**File:** `src/lib/redis.ts:10-11`

```typescript
retryStrategy: (times) => {
  if (times > 3) { return null; }  // Permanently disables Redis
  return Math.min(times * 50, 2000);
}
```

After 3 failed retries, the connection is permanently dead for the rest of the Node process lifetime.

**Fix:**

```typescript
retryStrategy: (times) => {
  if (times > 100) return 5000; // Cap at 5s, but keep trying
  return Math.min(times * 100, 5000);
}
```

### 3.6 Fix Float Zoom in Cache Key

**Severity:** HIGH (near-zero cache hit rate)
**File:** `src/app/api/properties/viewport/route.ts:54`

Mapbox sends fractional zoom levels (e.g., 14.3). Each creates a unique cache key, making Redis caching nearly useless.

**Fix:** Floor the zoom value:

```typescript
const roundedParams = { ...params, zoom: Math.floor(params.zoom) };
const cacheKey = `viewport:${Object.keys(roundedParams).sort().map(k => `${k}=${roundedParams[k]}`).join('&')}`;
```

### 3.7 Add Cache Invalidation on Data Updates

**Severity:** HIGH
**File:** `src/app/api/properties/viewport/route.ts:172`

When the scraper inserts/updates listings, no cache invalidation occurs. Users see stale data for up to 60 seconds.

**Fix:** After bulk scraper inserts, flush the viewport cache:

```typescript
// In scraper service after bulk insert
const keys = await redis.keys('viewport:*');
if (keys.length > 0) await redis.del(...keys);
```

Or use a versioned cache key: `viewport:v${version}:${params}`, incrementing the version on data changes.

### 3.8 Increase Cache TTL for Clustering Data

**Severity:** MEDIUM
**File:** `src/app/api/properties/viewport/route.ts:172`

60-second TTL for clustering data that changes infrequently.

**Fix:** Use 300-600s for low zoom clusters, 60s for high zoom individual properties.

### 3.9 Fix Sitemap Query (JSON Extraction on Full Table)

**Severity:** HIGH
**File:** `src/app/sitemap.ts:25-29`

```sql
SELECT DISTINCT raw_data->>'zip_code' as zip_code FROM listings WHERE raw_data->>'zip_code' IS NOT NULL LIMIT 500
```

Extracts a JSON field on every row, then deduplicates. The `zip_code` column exists but is unused here.

**Fix:**

```sql
SELECT DISTINCT zip_code FROM listings WHERE zip_code IS NOT NULL AND zip_code ~ '^\d{5}$' LIMIT 500
```

### 3.10 Fix HUD API Query (Same JSON Extraction Issue)

**Severity:** HIGH
**File:** `_backend/hud_api.py:57-66`

Same pattern — extracts `raw_data->>'zip_code'`, `raw_data->>'city'`, etc. from every row.

**Fix:** Use the normalized columns `zip_code`, `city`, `state` that exist on the `listings` table.

### 3.11 Fix Scraper N+1 Geocode Pattern

**Severity:** CRITICAL (100s of seconds for 500 rows)
**Files:** `_backend/scraper.py:134`, `_backend/scraper_service/main.py:172`

Each listing triggers an individual HTTP call to Mapbox for geocoding. 500 properties = 500 sequential requests at ~200ms each = 100 seconds.

**Fix:**
1. Skip geocoding when `latitude`/`longitude` already exists in scraped data (HomeHarvest often provides coordinates)
2. Cache geocode results in a `geocode_cache` table
3. Use Mapbox batch API for remaining lookups

### 3.12 Fix Scraper Row-by-Row INSERT

**Severity:** HIGH
**File:** `_backend/scraper.py:357-427`

Each row does: SELECT (check exists) → INSERT/UPDATE → COMMIT. That's 2-3 round-trips per row, with a WAL flush per commit.

**Fix:** Use bulk `INSERT ... ON CONFLICT DO UPDATE` (the scraper service at `main.py:215-238` already does this correctly — align the standalone scraper with this pattern).

### 3.13 Remove `CREATE EXTENSION IF NOT EXISTS postgis` from API Route

**Severity:** MEDIUM
**File:** `src/app/api/map/clusters/route.ts:18`

Runs `CREATE EXTENSION IF NOT EXISTS postgis` on every clustering request. Acquires a brief exclusive lock on `pg_extension`.

**Fix:** Remove. PostGIS should be installed via init scripts.

### 3.14 Fix String Replacement for Geometry Column

**Severity:** MEDIUM
**File:** `src/app/api/map/clusters/route.ts:76`

```typescript
const geometryQuery = query.replace(/geometry/g, 'ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)');
```

Fragile string replacement that prevents GiST index usage. The `geom` column exists via `phase1_geometry_migration.sql`.

**Fix:** Use `geom` column directly in the query.

### 3.15 Add Deterministic ORDER BY to Viewport Query

**Severity:** MEDIUM
**File:** `src/app/api/properties/viewport/route.ts:131-148`

`LIMIT 2000` without `ORDER BY` returns non-deterministic results, defeating caching.

**Fix:** Add `ORDER BY created_at DESC`.

### 3.16 Add PostgreSQL Performance Tuning

**Severity:** HIGH
**File:** `infrastructure/docker-compose.yml:54-68`

PostgreSQL uses default config (`shared_buffers=128MB`). At 10M rows, the `listings` table alone will be ~20GB.

**Fix:**

```yaml
postgres:
  command: >
    postgres
    -c shared_buffers=2GB
    -c work_mem=64MB
    -c effective_cache_size=6GB
    -c maintenance_work_mem=512MB
    -c random_page_cost=1.1
    -c max_parallel_workers_per_gather=4
```

### 3.17 Add Redis Memory Limits

**Severity:** MEDIUM
**File:** `infrastructure/docker-compose.yml:92`

No `maxmemory` policy. At scale, Redis could consume all available memory.

**Fix:**

```yaml
command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD}
```

### 3.18 Wire MVT Tiles to Frontend

**Severity:** HIGH (biggest single performance win for 10M+)
**Files:** `infrastructure/phase3_mvt_function.sql` (exists), `infrastructure/docker-compose.yml` (pg_tileserv service exists)

The MVT tile function and pg_tileserv container are deployed but the frontend still uses JSON cluster endpoints. At 10M properties, JSON cluster responses will be megabytes per request; MVT tiles are kilobytes.

**Fix:** Update `PropertyMap.tsx` to use the tile source (it already references `martin` at line 111-121, but verify the connection works in production).

### 3.19 Strip `raw_data` JSONB from List Query

**Severity:** HIGH (~80% data reduction per page load)
**Source:** m-plan1 (Phase 4.2)
**File:** `src/app/actions.ts:64`

The `getProperties` server action selects the full `raw_data` JSONB column (5-50KB per row) for the property list view. PropertyCard only needs: `id`, `address`, `listing_price`, `estimated_rent`, `bedrooms`, `bathrooms`, `sqft`, `primary_photo`, `listing_type`. That's ~200 bytes vs ~50KB per row.

With 100 results per page, this is 5MB of unnecessary JSONB transferred from DB → Node → client on every search.

**Fix:** Remove `raw_data` from the SELECT list in `getProperties`. Only include it in `getProperty` (detail view):

```typescript
// In getProperties (list query):
const query = `SELECT id, address, listing_price, estimated_rent, bedrooms, bathrooms,
  sqft, primary_photo, listing_type, city, state, zip_code, created_at
  FROM listings WHERE ...`;

// In getProperty (detail query):
const query = `SELECT *, raw_data FROM listings WHERE id = $1`;
```

### 3.20 Cursor-Based Pagination + Reduce Default Limit

**Severity:** HIGH
**Source:** m-plan1 (Phase 4.5)
**Files:** `src/app/actions.ts:7`, `src/app/page.tsx:59`

Current pagination is offset-based with a default limit of 100. Two problems:
1. **Default 100 is too many** — PropertyCard renders 100 DOM nodes on initial load. Reduce to 25.
2. **Offset pagination is O(n) at depth** — `OFFSET 50000` scans 50K rows. At 10M properties, deep pagination kills performance.
3. **`showSold` filtered client-side** — all sold properties are fetched from DB then hidden in React. Wasted bandwidth and DB time.

**Fix:**

```typescript
// Reduce default limit
const DEFAULT_LIMIT = 25;

// Cursor-based pagination
const query = `SELECT ... FROM listings
  WHERE ($1::text IS NULL OR created_at < $1::timestamptz)
  AND listing_type = 'for_sale'
  ${showSold ? '' : "AND status != 'sold'"}
  ORDER BY created_at DESC
  LIMIT $2`;

// Move showSold filter server-side
```

### 3.21 Add `rent_price_ratio` Generated Column + Descending Index

**Severity:** HIGH (core business metric can't use index sorting)
**Source:** m-plan1 (Phase 4.7)

The 1% Rule is this app's core value proposition, yet `rent_price_ratio` is computed on-the-fly and can't benefit from an index for sorting. At 10M rows, `ORDER BY (estimated_rent / listing_price) DESC` requires a full-table sort.

**Fix:**

```sql
ALTER TABLE listings ADD COLUMN rent_price_ratio numeric GENERATED ALWAYS AS (
  CASE WHEN listing_price > 0 THEN estimated_rent / listing_price ELSE 0 END
) STORED;

CREATE INDEX idx_listings_rent_price_ratio_desc ON listings (rent_price_ratio DESC)
  WHERE listing_price > 0 AND estimated_rent > 0;
```

This also enables "sort by 1% rule" without computation and makes the filter `rent_price_ratio >= 0.01` an index scan instead of a seq scan.

### 3.22 Add Redis Caching to Server Actions

**Severity:** HIGH
**Source:** m-plan1 (Phase 4.4)
**File:** `src/app/actions.ts`

Redis is configured (`src/lib/redis.ts`) and used for the viewport API route, but `getProperties` and `getProperty` server actions — the primary data-fetching paths — hit PostgreSQL on every call with no caching. These are called on every page load and every filter change.

**Fix:**

```typescript
export async function getProperties(filters: FilterState) {
  const cacheKey = `properties:${hashFilters(filters)}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const results = await pool.query(query, params);
  await redis.set(cacheKey, JSON.stringify(results.rows), 'EX', 60);
  return results.rows;
}
```

### 3.23 Add `.dockerignore` File

**Severity:** MEDIUM
**Source:** dsi-plan1
**File:** Missing — no `.dockerignore` exists

Without `.dockerignore`, the Docker build context includes `node_modules`, `.git`, `.next`, `.env*`, and Python `venv/`. This:
- Bloated build context (100s of MB) → slow builds
- `.env.local` could be leaked into image layers
- `node_modules` copied then overwritten by `npm install`

**Fix:**

```
# .dockerignore
node_modules
.next
.git
.env*
*.exp
venv
__pycache__
.DS_Store
```

### 3.24 Pin n8n Docker Image Tag

**Severity:** MEDIUM
**Source:** dsi-plan1 (Scale 0.3)
**File:** `infrastructure/docker-compose.yml`

n8n uses `:latest` tag — builds are non-deterministic. A new n8n release could break the deployment at any time.

**Fix:** Pin to a specific version:

```yaml
n8n:
  image: n8nio/n8n:1.85.0  # or current stable
```

### 3.25 Docker Network Segmentation

**Severity:** MEDIUM (defense-in-depth)
**Source:** dsi-plan1 (Scale 0.3)
**File:** `infrastructure/docker-compose.yml`

All services share a flat Docker network with no segmentation. If the app container is compromised, the attacker has network access to PostgreSQL, Redis, n8n, and the scraper — all on the same network.

**Fix:**

```yaml
networks:
  frontend:  # app only
  backend:   # app, postgres, redis, scraper
  internal:  # postgres, redis only (no app access for n8n)

services:
  app:
    networks: [frontend, backend]
  postgres:
    networks: [backend, internal]
  redis:
    networks: [backend, internal]
  n8n:
    networks: [frontend]  # cannot reach DB directly
  scraper:
    networks: [backend]
```

---

## Tier 4 — Architecture & Code Quality (Week 2-3)

> **Goal:** Decompose monoliths, add type safety, implement auth, establish patterns.

### 4.1 Decompose 675-Line Property Page

**Severity:** HIGH
**File:** `src/app/property/[id]/page.tsx`

A single 675-line client component containing data fetching, PDF export, chart rendering, school parsing, financial calculations, neighborhood analytics, and raw data display.

**Target structure:**

```
src/app/property/[id]/
  page.tsx                  — Server Component (data fetching, metadata)
  PropertyClientWrapper.tsx — Client Component shell
  OverviewTab.tsx           — Overview tab content
  FinancialsTab.tsx         — Financial analysis tab
  MarketTab.tsx             — Market data tab
  usePropertyData.ts        — Custom hook for data fetching
  usePdfExport.ts           — Custom hook for PDF export logic
  formatUtils.ts            — formatCurrency, formatNumber at module scope
  schoolParser.ts           — Extracted school data parsing IIFE
```

### 4.2 Re-implement Authentication with NextAuth.js

**Severity:** HIGH
**Files:** `src/middleware.ts` (disabled), `src/app/login/page.tsx` (redirects to `/`)

Auth was removed (Supabase disabled). This blocks Stripe payments, favorites, and all user-specific features.

**Fix:**
1. Implement NextAuth.js with credential/OAuth providers
2. Add `session()` checks to API routes that need protection
3. Re-enable middleware with proper route matching
4. Migrate Stripe checkout to require authenticated sessions

### 4.3 Remove `@ts-ignore` and Type All `any`

**Severity:** MEDIUM
**Files:** `src/app/page.tsx:67,72,75`, `src/lib/db.ts:24`

**Fix:**
1. Type the return of `getProperties` server action (create a `Property` interface)
2. Refactor the `db.ts` query logger to avoid monkey-patching (use a wrapper function instead)
3. Type `financial_snapshot` and `raw_data` (currently `any` in `page.tsx:17-18`)

### 4.4 Consolidate Duplicate Clustering Endpoints

**Severity:** MEDIUM
**Files:** `src/app/api/clusters/route.ts`, `src/app/api/map/clusters/route.ts`

Two overlapping clustering implementations. `/api/clusters` calls `get_property_clusters()`, `/api/map/clusters` builds SQL inline.

**Fix:** Consolidate into a single endpoint using the optimized viewport route pattern.

### 4.5 Add `propertyType` Filter or Remove It

**Severity:** MEDIUM
**File:** `src/app/api/properties/viewport/route.ts:20`

`propertyType: z.string().optional()` is in the Zod schema but never added to the SQL WHERE clause. Users think they're filtering but nothing happens.

**Fix:** Either implement the filter in `buildFilterClause` or remove it from the schema.

### 4.6 Remove Python Connection Boilerplate

**Severity:** MEDIUM
**Files:** All `_backend/*.py` files

Every Python module creates a new `psycopg2.connect()` on every call with no pooling.

**Fix:** Create a shared `db.py` module with `psycopg2.pool.ThreadedConnectionPool`.

### 4.7 Add `connectionTimeoutMillis` to DB Pool

**Severity:** MEDIUM
**File:** `src/lib/db.ts`

No connection timeout configured. A query that cannot acquire a client waits indefinitely.

**Fix:** Add `connectionTimeoutMillis: 5000` and increase `max` to 50.

### 4.8 Validate Environment Variables with Zod at Startup

**Severity:** HIGH
**Source:** k-plan1 (P1), m-plan1 (Phase 2.5)
**File:** `src/lib/env.ts` (new)

Environment variables are accessed ad-hoc throughout the codebase with no validation. Missing `DATABASE_URL` causes a runtime error deep in a query; missing `STRIPE_SECRET_KEY` causes a cryptic Stripe error. Hardcoded fallbacks (especially `FRED_API_KEY`) mask missing configuration.

**Fix:** Create a validated env module:

```typescript
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().min(1),
  FRED_API_KEY: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
```

Import this at the top of `db.ts`, `redis.ts`, and API routes. App fails immediately on startup with a clear error if any required variable is missing.

### 4.9 Add Database Migration Tooling

**Severity:** HIGH
**Source:** dsi-plan1 (Scale 4.8)
**Files:** `infrastructure/*.sql` (applied manually)

Schema changes are applied via ad-hoc SQL files executed manually or through `.exp` expect scripts. There is no migration versioning, no rollback capability, and no way to know which migrations have been applied. At 10M rows, ad-hoc schema changes are dangerous.

**Fix:**
1. Install `node-pg-migrate` (lightweight, no ORM) or Drizzle Kit
2. Move existing SQL files into versioned migrations
3. Add `npm run migrate` and `npm run migrate:rollback` scripts
4. Run migrations as part of CI/CD deploy pipeline (6.4)

### 4.10 Add Prettier + Strengthen ESLint Rules + Pre-commit Hooks

**Severity:** MEDIUM
**Source:** k-plan1 (P2)

No Prettier for formatting. ESLint config is Next.js defaults — missing critical rules:
- `@typescript-eslint/no-explicit-any` — `any` types used in 5+ files
- `eslint-plugin-jsx-a11y` — no accessibility linting
- `eslint-plugin-unused-imports` — dead imports accumulate
- `react-hooks/exhaustive-deps` — missing dependencies in `useEffect`
- No pre-commit hooks to enforce any of this

**Fix:**

```bash
npm install -D prettier eslint-config-prettier @typescript-eslint/eslint-plugin eslint-plugin-jsx-a11y eslint-plugin-unused-imports husky lint-staged
```

```json
// .eslintrc.json additions
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "unused-imports/no-unused-imports": "warn",
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-is-valid": "warn"
  }
}
```

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

### 4.11 Remove 71 `console.log` Statements from Production

**Severity:** MEDIUM (information leakage + noise)
**Source:** k-plan1 (P2)

71 `console.log` statements in production code. These:
- Leak internal state to browser DevTools (API keys fragments, query details)
- Pollute server logs with unstructured noise
- Are never removed because there's no lint rule enforcing it

**Fix:**
1. Add `no-console` ESLint rule (allow `console.error` and `console.warn`)
2. Replace meaningful logs with `pino` structured logging (6.5)
3. Remove trivial debug logs entirely

```json
// .eslintrc.json
{
  "rules": {
    "no-console": ["error", { "allow": ["error", "warn"] }]
  }
}
```

### 4.12 Add Python Structured Logging

**Severity:** MEDIUM
**Source:** dsi-plan1 (Scale 4.6)
**Files:** All 28 `_backend/*.py` files — all use `print()`

Every Python backend file uses `print()` for logging. No log levels, no structured format, no configurable output. In production, these prints go to stdout with no context (no timestamp, no severity, no request ID).

**Fix:**

```python
# _backend/logging_config.py
import structlog

def configure_logging():
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )

logger = structlog.get_logger()
```

Replace all `print()` calls with `logger.info()`, `logger.error()`, etc.

### 4.13 Deduplicate Scraper Code (~80% Overlap)

**Severity:** MEDIUM
**Source:** dsi-plan1 (Scale 2.2)
**Files:** `_backend/scraper.py` vs `_backend/scraper_service/main.py`

`scraper.py` (standalone) and `scraper_service/main.py` (FastAPI service) share ~80% code overlap: geocoding logic, NaN cleaning, property type extraction, address construction, bathroom calculation. Bug fixes must be applied twice.

**Fix:** Extract shared logic into `_backend/scraper_common.py`:

```python
# _backend/scraper_common.py
def clean_nan_values(record: dict) -> dict: ...
def extract_property_type(raw: dict) -> str: ...
def construct_address(raw: dict) -> str: ...
def calculate_bathrooms(raw: dict) -> float: ...
def geocode_address(address: str, cache: dict) -> tuple: ...
```

Both implementations import from `scraper_common`.

### 4.14 Add Database Backup Strategy

**Severity:** HIGH (operational risk)
**Source:** dsi-plan1 (Scale 2.9)

No `pg_dump` scripts, no backup automation, no restore procedure documented. At 1.2M+ properties (growing to 10M+), data loss from a corrupted volume, accidental `DROP TABLE`, or host failure would be catastrophic and unrecoverable.

**Fix:**
1. Add daily `pg_dump` cron job to the VPS or a separate backup host:

```bash
# Daily full backup with 7-day retention
pg_dump -U postgres -Fc onepercentrealestate > /backups/db_$(date +%Y%m%d).dump
find /backups -name "*.dump" -mtime +7 -delete
```

2. Add a `backup` service to docker-compose that runs scheduled pg_dump
3. Test restore procedure: `pg_restore -U postgres -d onepercentrealestate backup.dump`
4. Consider WAL archiving for point-in-time recovery at 10M+ scale
5. Store backups off-site (S3, GCS) — not on the same VPS

---

## Tier 5 — Product & UX (Week 3-4)

> **Goal:** Fix the most impactful UX gaps and missing features for real estate investors.

### 5.1 Fix Root Metadata (Currently "Create Next App")

**Severity:** CRITICAL (SEO)
**File:** `src/app/layout.tsx:15-18`

```typescript
export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};
```

**Fix:**

```typescript
export const metadata: Metadata = {
  title: "1% Real Estate — Investment Property Analyzer",
  description: "Find rental properties that meet the 1% rule. Analyze cashflow, cap rate, and cash-on-cash returns across 1M+ listings nationwide.",
  openGraph: {
    title: "1% Real Estate — Investment Property Analyzer",
    description: "Find rental properties that meet the 1% rule.",
    type: "website",
    url: "https://one.octavo.press",
  },
  twitter: {
    card: "summary_large_image",
  },
};
```

### 5.2 Add Mobile Navigation

**Severity:** HIGH
**File:** `src/components/Header.tsx:18`

Desktop nav is `hidden lg:flex` with **no mobile hamburger menu**. Mobile users have zero navigation to "Acquire Data", "Analytics", or "Pricing".

**Fix:** Add a mobile hamburger menu with a slide-out drawer.

### 5.3 Add Missing Investor Filters

**Severity:** HIGH
**File:** `src/components/PropertyFilters.tsx`

Current filters: Max Price, Min Beds, Min Baths, Show Sold, 1% Rule Only.

**Critical missing filters:**

| Filter | Why It Matters |
|--------|---------------|
| Min Price | Avoid distressed properties; `minPrice` is in `FilterState` but has no UI control (`PropertyFilters.tsx:42`) |
| Property Type | Single-family, multi-family, condo, townhouse — data exists in `raw_data.style` |
| Zip Code / City | No geographic text search; map is purely visual |
| Min Cashflow | Core value prop; pre-calculable from existing data |
| Cap Rate / Gross Yield | Key investor metrics |
| HOA / No HOA | HOA destroys cashflow; data exists in `raw_data.hoa_fee` |
| Sqft Range | Only beds/baths, no square footage |
| Year Built | Older homes = higher maintenance |

**Also fix:**
- Replace native `<input type="range">` with Radix Slider (`src/components/ui/slider.tsx` already exists)
- Add "Clear All Filters" button
- Show filter chips for active filters
- Make quick toggles visible on mobile (not `hidden md:flex`)

### 5.4 Display Cap Rate & Cash-on-Cash on Property Overview

**Severity:** HIGH
**File:** `src/app/property/[id]/page.tsx:158-215`

`calculators.ts` computes `capRate` and `cashOnCash`, but the property overview only shows `isOnePercentRule` and `monthlyCashflow`. These are the two metrics experienced investors look at first.

**Fix:** Add Cap Rate and Cash-on-Cash to the three prominent financial cards on the overview tab.

### 5.5 Add Link to Original Listing

**Severity:** MEDIUM
**File:** `src/app/property/[id]/page.tsx`

The database stores `url` and `property_url` (`actions.ts:169-170`), but the detail page never renders a link to the source listing. Investors must verify on the original site.

**Fix:** Add "View Original Listing" button linking to `property_url`.

### 5.6 Replace Location Placeholder with Actual Map

**Severity:** MEDIUM
**File:** `src/app/property/[id]/page.tsx:349-355`

Shows a gray box with a MapPin icon instead of an actual map. The app has a fully functional `PropertyMap` component.

**Fix:** Embed a small PropertyMap centered on the property's coordinates.

### 5.7 Fix Compare Checkbox Invisible on Mobile

**Severity:** HIGH
**File:** `src/components/ui/card.tsx:41`

`opacity-0 group-hover:opacity-100` — hover doesn't exist on touch devices. Compare feature is effectively unusable on mobile.

**Fix:** Make checkbox always visible on mobile (use `md:opacity-0 md:group-hover:opacity-100`).

### 5.8 Implement localStorage Favorites (Zero-Auth Quick Win)

**Severity:** MEDIUM
**Files:** None exist — no favorites anywhere

The pricing page (`pricing/page.tsx:19`) advertises "3 Saved Properties" on Free tier and "Unlimited Property Saves" on Pro — but the feature doesn't exist.

**Fix:**
1. Store favorites in localStorage as an array of property IDs
2. Add heart/bookmark icon to PropertyCard
3. Add "Saved" tab in the filter/navigation
4. If auth is re-enabled, migrate to database

### 5.9 Add Proper Error States

**Severity:** HIGH
**Files:** Multiple — `page.tsx:80-81`, `property/[id]/page.tsx:44-45`, `compare/page.tsx:39-40`

Errors are silently `console.error`'d. The user sees an empty grid indistinguishable from a legitimate "no results" state. No retry button, no error message.

**Fix:**
1. Distinguish "no results" (empty state with guidance) from "request failed" (error state with retry)
2. Add a `error` state alongside `loading` and `properties`
3. Add React Error Boundaries around map and chart components

### 5.10 Add Skeleton Loaders

**Severity:** MEDIUM
**Files:** All loading states use full-screen `Loader2` spinner

No progressive rendering. No visual structure before data arrives.

**Fix:** Create skeleton cards matching PropertyCard layout (image placeholder, 2-3 text lines, price row).

### 5.11 Fix ARIA Accessibility on Tabs

**Severity:** HIGH
**File:** `src/components/PropertyTabs.tsx:15-33`

Tabs use plain `<button>` elements without `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, or `role="tabpanel"`. Keyboard arrow navigation is missing.

**Fix:** Implement WAI-ARIA Tabs pattern. Or use Radix Tabs (already have `@radix-ui/react-tabs` available).

### 5.12 Fix Color Contrast on Deal Labels

**Severity:** MEDIUM
**File:** `src/components/ui/card.tsx:82-83`

`text-[10px]` with `text-gray-400` on white ≈ 3.3:1 contrast ratio. WCAG AA requires 4.5:1.

**Fix:** Increase size to `text-xs` (12px) and use `text-gray-500` or darker.

### 5.13 Add JSON-LD Structured Data

**Severity:** MEDIUM
**Files:** None exist

No `RealEstateListing` schema markup. Major SEO opportunity for property pages.

**Fix:** Add to property detail pages:

```typescript
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "RealEstateListing",
  name: property.address,
  description: `${property.bedrooms} bed / ${property.bathrooms} bath — ${formatCurrency(property.listing_price)}`,
  price: property.listing_price,
  address: { "@type": "PostalAddress", addressLocality: property.city, addressRegion: property.state },
};
```

### 5.14 Add Property Pages to Sitemap

**Severity:** MEDIUM
**File:** `src/app/sitemap.ts`

Sitemap includes `/`, `/search`, `/analytics`, `/pricing`, and zip code pages. Individual property pages are excluded — the primary content that should be indexed.

**Fix:** Add the most recent 1000 property pages to the sitemap.

### 5.15 Rename "Acquire Data" Nav Link

**Severity:** LOW
**File:** `src/components/Header.tsx:7-37`

"Acquire Data" is a power-user scraping tool, not a primary nav item for investors.

**Fix:** Rename to "Import Listings" or move to a settings/admin area.

### 5.16 Add `alt` Text to Property Images + Lightbox Escape Key

**Severity:** MEDIUM (WCAG failures)
**Source:** k-plan1 (P3)
**Files:** `src/components/PropertyHero.tsx`, `src/components/ui/card.tsx:61-64`

Property images have no `alt` text — screen readers announce "image" or the filename. The lightbox/modal has no `Escape` key handler for closing, trapping keyboard users.

**Fix:**

```typescript
// PropertyCard images
<img src={property.primary_photo} alt={`${property.address} — ${property.bedrooms} bed ${property.bathrooms} bath`} />

// PropertyHero lightbox
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setLightboxOpen(false);
  };
  if (lightboxOpen) document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [lightboxOpen]);
```

### 5.17 Color-Only Status Indicators Need Text/Icon Alternatives

**Severity:** MEDIUM (WCAG 1.4.1)
**Source:** k-plan1 (P3)
**File:** `src/components/ui/card.tsx:82-83`

Deal quality indicators use color only (green = good deal, red = bad deal). Approximately 8% of men and 0.5% of women have red-green color blindness. Without text or icon alternatives, these indicators violate WCAG 1.4.1 (Use of Color).

**Fix:** Add text labels alongside color:

```typescript
// Before:
<span className="text-green-500">●</span>

// After:
<span className="text-green-600 flex items-center gap-1">
  <CheckCircle className="w-3 h-3" /> Good Deal
</span>
```

---

## Tier 6 — DevOps, Monitoring & CI/CD (Week 4+)

> **Goal:** Replace manual SSH deploy with a real pipeline. Add observability.

### 6.1 Add Resource Limits to Docker Services

**Severity:** HIGH
**File:** `infrastructure/docker-compose.yml`

No `mem_limit`, `cpus`, or `deploy.resources.limits` on any service. A misbehaving container can consume all host resources.

**Fix:**

```yaml
app:
  deploy:
    resources:
      limits: { memory: 2G, cpus: '2' }
postgres:
  deploy:
    resources:
      limits: { memory: 4G, cpus: '2' }
redis:
  deploy:
    resources:
      limits: { memory: 1G, cpus: '0.5' }
n8n:
  deploy:
    resources:
      limits: { memory: 512M, cpus: '1' }
```

### 6.2 Add Healthchecks to All Docker Services

**Severity:** MEDIUM
**File:** `infrastructure/docker-compose.yml`

No `healthcheck` defined on any service. Docker can't determine if a service is truly healthy.

**Fix:**

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 10s
    timeout: 5s
    retries: 5

redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5

app:
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/"]
    interval: 30s
    timeout: 10s
    retries: 3
```

### 6.3 Add HEALTHCHECK to Dockerfile

**Severity:** LOW
**File:** `Dockerfile`

**Fix:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
```

### 6.4 Set Up CI/CD Pipeline

**Severity:** HIGH
**Files:** `deploy_production.exp`, `deploy_v2.exp`, etc.

All deploys are manual via Expect scripts with plaintext passwords. No automated testing or deployment.

**Fix:**
1. GitHub Actions workflow: lint → typecheck → test → build → deploy
2. SSH key-based deploy (no passwords)
3. Docker Compose via GitHub Actions runner
4. Add `AGENTS.md` with lint/typecheck/test commands

### 6.5 Add Structured Logging & APM

**Severity:** HIGH
**Files:** No observability anywhere

No structured logging, no APM, no uptime monitoring. Connection pool exhaustion, slow queries, and Redis failures are invisible.

**Fix:**
1. Add Sentry for error tracking + APM
2. Add `pino` or `winston` for structured logging
3. Add pool monitoring: periodic `pool.totalCount`, `pool.idleCount`, `pool.waitingCount`
4. Set up uptime monitoring (e.g., UptimeRobot, BetterStack)

### 6.6 Add Rate Limiting to All API Routes

**Severity:** HIGH
**Files:** `src/lib/rate-limit.ts` (only used in `viewport/route.ts`)

7 of 8 API routes have no rate limiting. `/api/scrape` (launches subprocess!) and `/api/estimate-rent` (5-30s spatial scan!) are completely unprotected.

**Per-route rate limits:**

| Route | Limit |
|-------|-------|
| `/api/estimate-rent` | 10 req/min |
| `/api/clusters`, `/api/map/clusters` | 30 req/min |
| `/api/properties/viewport` | 60 req/min |
| `/api/seed`, `/api/scrape` | 5 req/min (authenticated only) |
| `/api/admin/*` | 5 req/min (authenticated only) |

### 6.7 Fix Rate Limiter Fails Open

**Severity:** MEDIUM
**File:** `src/lib/rate-limit.ts:11-17`

Both "rate limited" and "Redis error" return `false`, making them indistinguishable. On Redis outage, users get 429 even though they haven't exceeded any limit.

**Fix:** Check `rejRes instanceof RateLimiterRes` to distinguish. On Redis error, allow the request through (fail open for infrastructure failure, fail closed for actual rate limits).

### 6.8 Remove `build-essential` from Scraper Dockerfile

**Severity:** MEDIUM
**File:** `_backend/scraper_service/Dockerfile:6-8`

Adds ~200MB of compilers to production image. Use `libpq-dev` instead.

### 6.9 Fix Dockerfile Telemetry Setting

**Severity:** LOW
**File:** `Dockerfile:22,32`

`NEXT_TELEMETRY_DISABLED=1` is set in builder stage but not in runner stage (commented out on line 32).

**Fix:** Uncomment line 32 or add `ENV NEXT_TELEMETRY_DISABLED=1` to the runner stage.

---

## Backlog — Future Consideration (Post-Launch)

> **Goal:** Items identified by cross-referencing dsi-plan1, m-plan1, and k-plan1 that are valid but low urgency. Revisit after Tiers 0-5 are complete.

### BL.1 Data Archival and Retention Policy

**Source:** dsi-plan1 (Scale 5.9)
**Severity:** LOW

`crawl_jobs` table auto-recycles but never archives old data. Old rental comps should be archived. Listings need a `deleted_at` soft-delete pattern. At 10M+ rows, unbounded growth degrades query planning and increases backup sizes.

### BL.2 ML Model `pickle` RCE Risk + Hardcoded Year

**Source:** dsi-plan1 (Scale 5.10)
**Files:** `_backend/ml_rent_estimator/`
**Severity:** MEDIUM (security)

Model serialized with `pickle` (RCE risk if model file is tampered). Hardcoded year 2025 in feature extraction. No model versioning, no drift monitoring, no A/B testing for rent estimates.

**Fix:** Switch to `safetensors` or `onnx`. Extract year from data. Add model registry.

### BL.3 API Versioning

**Source:** dsi-plan1 (Scale 4.7)
**Severity:** LOW

All routes at `/api/...` with no version prefix. Recommend `/api/v1/...` with backward-compat redirect. Not urgent until external consumers exist.

### BL.4 GDPR/Privacy Compliance

**Source:** dsi-plan1 (Scale 5.11)
**Severity:** LOW (becomes HIGH if serving EU users)

No privacy policy, no cookie consent, no data deletion endpoint. Required if serving EU users or processing EU resident data.

### BL.5 Dark Mode / Theme Support

**Source:** dsi-plan1 (Scale 5.6)
**Severity:** LOW

Light mode only. Use `next-themes` with dark mode CSS variables, localStorage persistence, and `prefers-color-scheme` detection.

### BL.6 PWA Support

**Source:** dsi-plan1 (Scale 5.4)
**Severity:** LOW

No service worker, no manifest, no offline support. Use `@serwist/next` when offline property browsing becomes a priority.

### BL.7 CDN Strategy

**Source:** dsi-plan1 (Scale 3.3)
**Severity:** MEDIUM

No CDN configured. At 10M+ properties with map tiles and images, CloudFront or similar in front of the VPS with `stale-while-revalidate` would reduce origin load and improve global latency.

### BL.8 Enable React Compiler for Automatic Memoization

**Source:** k-plan1 (P2)
**Severity:** LOW

React 19 supports the experimental React Compiler for automatic memoization. Could replace manual `useMemo`/`useCallback` work (2.4). Worth evaluating once stable.

### BL.9 Add `noUncheckedIndexedAccess` to tsconfig

**Source:** k-plan1 (P1), dsi-plan1 (Scale 4.4)
**Severity:** MEDIUM

Adding `"noUncheckedIndexedAccess": true` to `tsconfig.json` catches missing array/object access at compile time. Many potential null reference bugs would be caught. Requires fixing existing type errors first.

### BL.10 Move PropertyCard Out of `ui/` Primitives Directory

**Source:** m-plan1 (Phase 3.6)
**Severity:** LOW

`PropertyCard` is a 150-line business component in `src/components/ui/card.tsx` alongside generic primitives. Should be in `src/components/PropertyCard.tsx`. Clean up during 4.1 decomposition.

### BL.11 Consolidate `calculators.ts` + `finance.ts`

**Source:** m-plan1 (Phase 3.7)
**Files:** `src/lib/calculators.ts`, `src/lib/finance.ts`
**Severity:** LOW

`finance.ts` defines `analyzeDeal`, `calculateMortgageConstant`, `calculateRequiredRent` — not used in any component. Either integrate into `calculators.ts` or remove dead code.

---

## Cross-Cutting: Testing Strategy

> **Current state: Zero tests.** No framework, no test scripts, no test files.

### Priority Test Implementation Order

#### Phase A: Financial Calculator Unit Tests (Day 1)

The most critical code to test — financial correctness directly impacts investor decisions.

```typescript
// src/lib/__tests__/calculators.test.ts
describe('calculateMortgage', () => {
  it('returns correct monthly payment for standard loan', () => { ... });
  it('returns principal-only for zero interest rate', () => { ... });
  it('returns 0 for zero principal', () => { ... });
});

describe('calculateCashflow', () => {
  it('excludes PMI from NOI/capRate calculation', () => { ... });
  it('includes closing costs in cash-on-cash denominator', () => { ... });
  it('handles zero down payment', () => { ... });
});

// src/lib/__tests__/finance.test.ts
describe('analyzeDeal', () => {
  it('does not double-compute fixed costs', () => { ... });
  it('handles variableExpenseRate near 1.0', () => { ... });
  it('clamps deal score to 0-100', () => { ... });
});
```

#### Phase B: API Route Integration Tests (Week 1)

```typescript
// src/app/api/__tests__/viewport.test.ts
describe('GET /api/properties/viewport', () => {
  it('validates input with Zod schema', () => { ... });
  it('returns clustered data at low zoom', () => { ... });
  it('returns individual properties at high zoom', () => { ... });
  it('respects filter parameters', () => { ... });
  it('caches responses in Redis', () => { ... });
});
```

#### Phase C: Component Tests (Week 2)

Use React Testing Library for PropertyCard, CashflowCalculator, PropertyFilters.

#### Phase D: E2E Tests (Week 3)

Use Playwright for core flows: map interaction → property detail → cashflow calculator → PDF export.

### Test Infrastructure Setup

1. Install: `vitest` (fast, Vite-native), `@testing-library/react`, `playwright`
2. Add `vitest.config.ts` with `environment: 'node'`
3. Add test scripts to `package.json`: `"test"`, `"test:watch"`, `"test:e2e"`
4. Add `AGENTS.md` with test commands for CI

---

## Appendix A: Complete Issue Index

### Critical (16)

| # | Area | Issue | Location |
|---|------|-------|----------|
| 1 | Security | Command injection via `exec()` | `api/scrape/route.ts:15-31` |
| 2 | Security | No auth on any endpoint | `middleware.ts:1-8` |
| 3 | Security | Hardcoded DB passwords in source | `docker-compose.yml:18,43,59,103`, `db.ts:12` |
| 4 | Security | Postgres port exposed to internet | `docker-compose.yml:69-70` |
| 5 | Security | Redis port exposed with no auth | `docker-compose.yml:88-89` |
| 6 | Security | Server root password in plaintext | `deploy_production.exp`, `setup_server.sh` |
| 7 | Security | `.env.local` with live secrets in git history | `.env.local` (entire git history) |
| 8 | Security | SQL injection in ORDER BY clause | `actions.ts:69` |
| 9 | DB Perf | `calculate_smart_rent` full spatial scan | `smart_rent_estimate.sql:85-110` |
| 10 | DB Perf | Rent trigger fires spatial scan on every INSERT | `rent_estimation_trigger.sql:34-38` |
| 11 | API | Only 1/8 routes uses Redis caching | Multiple route files |
| 12 | Scraper | N+1 geocode API calls | `scraper.py:134`, `scraper_service/main.py:172` |
| 13 | Frontend | html2canvas + jsPDF eagerly loaded (~500KB) | `property/[id]/page.tsx:15-16` |
| 14 | SEO | Root metadata is "Create Next App" | `layout.tsx:15-18` |
| 15 | Data | No database backup strategy | Missing entirely |
| 16 | Data | Schema/application column drift — silent data loss | `listings_schema.sql` vs scraper code |

### High (31)

| # | Area | Issue | Location |
|---|------|-------|----------|
| 13 | DB | Connection leaks (no try/finally) | `actions.ts:75-77,128-134,175-177,252-260` + 5 more files |
| 14 | Calc | PMI in NOI corrupts capRate | `calculators.ts:100-117` |
| 15 | Calc | Zero interest returns mortgage = 0 | `calculators.ts:58` |
| 16 | Cache | Float zoom in cache key = near-zero hit rate | `viewport/route.ts:54` |
| 17 | Cache | No cache invalidation on data updates | `viewport/route.ts:172` |
| 18 | Redis | Connection permanently dies after 3 retries | `redis.ts:10-11` |
| 19 | DB | Missing composite indexes for clustering | `add_performance_indexes.sql` |
| 20 | DB | Missing index for smart rent spatial query | `rental_schema_upgrade.sql:27-28` |
| 21 | DB | `quick_rent_estimate` uses `ILIKE '%address%'` | `smart_rent_estimate.sql:231` |
| 22 | DB | Sitemap uses JSON extraction on full table | `sitemap.ts:25-29` |
| 23 | DB | HUD API uses JSON extraction on full table | `hud_api.py:57-66` |
| 24 | Scraper | Row-by-row INSERT with per-row commit | `scraper.py:357-427` |
| 25 | API | `/api/estimate-rent` has no caching | `estimate-rent/route.ts` |
| 26 | API | `/api/clusters` and `/api/map/clusters` have no caching | Both cluster route files |
| 27 | API | Rate limiting only on 1 of 8 routes | `rate-limit.ts` only imported in viewport |
| 28 | Docker | PostgreSQL has no performance tuning | `docker-compose.yml:54-68` |
| 29 | Docker | No resource limits on any service | `docker-compose.yml` |
| 30 | Frontend | recharts statically imported (~400KB) | 3 component files |
| 31 | Frontend | No `next/image` usage anywhere | 4 component files |
| 32 | Frontend | PropertyCard not memoized | `card.tsx:27` |
| 33 | Frontend | No `loading.tsx` or `error.tsx` files | `app/` directory |
| 34 | Frontend | All pages are `'use client'` | `page.tsx:1`, `[id]/page.tsx:1`, `compare/page.tsx:1` |
| 35 | UX | No mobile navigation menu | `Header.tsx:18` |
| 36 | UX | Cap Rate & CoC computed but never displayed | `property/[id]/page.tsx` |
| 37 | Security | Error responses leak Postgres schema details | 5 API route files |
| 38 | Security | No HTTP security headers (CSP, X-Frame-Options, etc.) | `next.config.ts` |
| 39 | Frontend | PropertyMap cluster layers broken (source ID mismatch) | `PropertyMap.tsx` |
| 40 | Calc | Null price displayed as "$0" | `actions.ts:106` |
| 41 | Stripe | No price ID validation on checkout | `checkout/route.ts:20-39` |
| 42 | Stripe | No webhook idempotency (duplicate events) | `webhooks/route.ts` |
| 43 | Stripe | Metadata userId set by unauthenticated client | `webhooks/route.ts:8-9` |
| 44 | API | No RBAC on admin routes | `admin/seed-jobs/route.ts`, `admin/reset-jobs/route.ts` |
| 45 | Frontend | No debounce on filter inputs (burst requests) | `page.tsx`, `PropertyFilters.tsx` |
| 46 | Frontend | No TanStack Query (no client-side caching/dedup) | All client pages |
| 47 | API | `raw_data` JSONB (5-50KB/row) in list query | `actions.ts:64` |
| 48 | API | Offset pagination + default limit 100 + client-side `showSold` | `actions.ts:7`, `page.tsx:59` |
| 49 | DB | `rent_price_ratio` computed — no index for 1% rule sorting | `listings` table |
| 50 | API | No Redis caching on server actions | `actions.ts` |
| 51 | Env | No env var validation at startup | Missing `src/lib/env.ts` |

### Medium (43)

| # | Area | Issue | Location |
|---|------|-------|----------|
| 52 | Calc | CoC ignores closing costs | `calculators.ts:121` |
| 53 | Calc | Division by zero in `calculateRequiredRent` | `finance.ts:88` |
| 54 | Calc | `analyzeDeal` double-computes fixed costs | `finance.ts:114-143` |
| 55 | Calc | No input validation for negative values | `finance.ts`, `calculators.ts` |
| 56 | DB | Monkey-patched query logger bypassed by `pool.connect()` | `db.ts:22-25` |
| 57 | DB | Pool size 20 insufficient at scale | `db.ts:7` |
| 58 | DB | No `connectionTimeoutMillis` | `db.ts` |
| 59 | DB | Slow query threshold 500ms too high | `db.ts:32-34` |
| 60 | DB | No pool monitoring | `db.ts` |
| 61 | DB | Redundant single-column indexes | `add_performance_indexes.sql:4,12` |
| 62 | DB | `add_rent_columns.sql` bulk UPDATE without batching | `add_rent_columns.sql:12-29` |
| 63 | API | `/api/seed` does row-by-row INSERT | `api/seed/route.ts:68-113` |
| 64 | API | `/api/properties` returns full `raw_data` JSON twice | `api/properties/route.ts:25-41` |
| 65 | API | `/api/mortgage-rates` uses PG as cache instead of Redis | `mortgage-rates/route.ts` |
| 66 | API | Viewport query has no ORDER BY | `viewport/route.ts:131-148` |
| 67 | API | `CREATE EXTENSION IF NOT EXISTS postgis` on every request | `map/clusters/route.ts:18` |
| 68 | API | String replacement for geometry column | `map/clusters/route.ts:76` |
| 69 | Cache | 60s TTL too short for cluster data | `viewport/route.ts:172` |
| 70 | Redis | No `maxmemory` policy configured | `docker-compose.yml:92` |
| 71 | Scraper | `ON CONFLICT` RETURNING logic flawed | `scraper_service/main.py:215-249` |
| 72 | Scraper | Scheduler is single-threaded with no timeout | `scheduler.py:139-155` |
| 73 | Scraper | Python creates new DB connection per call | All `_backend/*.py` |
| 74 | Scraper | `rent_estimator_v2.py` fetches all rentals nationwide | `rent_estimator_v2.py:196-210` |
| 75 | Frontend | `Intl.NumberFormat` created on every render | 5 component files |
| 76 | Frontend | `toggleSelection` creates new Set, no useCallback | `page.tsx:102-114` |
| 77 | Frontend | Inline filter object causes PropertyMap re-render | `page.tsx:225-231` |
| 78 | Frontend | PropertyReport always mounted off-screen | `property/[id]/page.tsx:117-119` |
| 79 | Frontend | PropertyMap mounted but hidden on mobile | `page.tsx:219-223` |
| 80 | Frontend | AdvancedRentEstimator fetches on every page load | `AdvancedRentEstimator.tsx:39-43` |
| 81 | Frontend | CashflowCalculator fetches mortgage rates on mount | `CashflowCalculator.tsx:122-141` |
| 82 | UX | Compare checkbox invisible on mobile | `card.tsx:41` |
| 83 | UX | No skeleton loaders | All loading states |
| 84 | UX | `alert()` used for user messages | 3 files |
| 85 | UX | Tabs lack ARIA tab pattern | `PropertyTabs.tsx:15-33` |
| 86 | UX | Missing investor filters (type, zip, cashflow, cap rate) | `PropertyFilters.tsx` |
| 87 | UX | No image `alt` text + lightbox has no Escape key | `PropertyHero.tsx`, `card.tsx` |
| 88 | UX | Color-only status indicators (WCAG 1.4.1) | `card.tsx:82-83` |
| 89 | Docker | No `.dockerignore` (bloated builds, secret leak risk) | Missing file |
| 90 | Docker | n8n uses `:latest` tag (non-deterministic) | `docker-compose.yml` |
| 91 | Docker | No network segmentation (flat network) | `docker-compose.yml` |
| 92 | DX | No Prettier, weak ESLint, no pre-commit hooks | Config files |
| 93 | DX | 71 `console.log` statements in production | Multiple files |
| 94 | Python | All 28 backend files use `print()` (no structured logging) | `_backend/*.py` |
| 95 | Python | ~80% code overlap between `scraper.py` and `scraper_service/main.py` | `_backend/` |

### Low (26)

| # | Area | Issue | Location |
|---|------|-------|----------|
| 96 | Calc | `calculateDealScore` fragile (could exceed 100) | `finance.ts:108` |
| 97 | Calc | `isOnePercentRule` no epsilon tolerance | `calculators.ts:125` |
| 98 | DB | Single-column indexes with low selectivity | `add_performance_indexes.sql:6-7,14` |
| 99 | DB | Nested BEGIN block in `calculate_smart_rent` | `smart_rent_estimate.sql:168-172` |
| 100 | API | `/api/properties/route.ts` no limit on ID count | `api/properties/route.ts` |
| 101 | API | `propertyType` filter accepted but ignored | `viewport/route.ts:20` |
| 102 | Docker | `version: '3.8'` deprecated | `docker-compose.yml:1` |
| 103 | Docker | Scraper service missing `depends_on: postgres` | `docker-compose.yml:72-83` |
| 104 | Docker | Scraper Dockerfile missing env vars | `scraper_service/Dockerfile` |
| 105 | Docker | `build-essential` in production image | `scraper_service/Dockerfile:6-8` |
| 106 | Docker | Dockerfile no `COPY --chown` for public | `Dockerfile:37` |
| 107 | Docker | Dockerfile telemetry disabled in builder only | `Dockerfile:22,32` |
| 108 | Docker | No `.dockerignore` verification | `Dockerfile:17` |
| 109 | Frontend | Staggered animation delay for 100+ cards | `page.tsx:178` |
| 110 | Frontend | Heatmap/circle zoom overlap at zoom 12-13 | `PropertyMap.tsx:162-201` |
| 111 | Frontend | Map style could be lighter | `PropertyMap.tsx:149` |
| 112 | Frontend | `PropertyTabs` tabs array recreated per render | `PropertyTabs.tsx:9-13` |
| 113 | Frontend | Lightbox loads all images at once | `PropertyHero.tsx:92-93` |
| 114 | Frontend | No `generateMetadata` for property pages | `property/[id]/page.tsx` |
| 115 | UX | "Acquire Data" nav label confusing for investors | `Header.tsx:7-37` |
| 116 | UX | Market Trends "coming soon" placeholder misleading | `property/[id]/page.tsx:665-668` |
| 117 | UX | Price Distribution chart uses black bars | `PortfolioCharts.tsx:106` |
| 118 | UX | Charts too small (200px height) | `MarketTrends.tsx:48,91` |
| 119 | UX | `hover:scale-105` sticky on touch devices | `pricing/page.tsx:130` |
| 120 | UX | No "Back to Results" preserving scroll position | `property/[id]/page.tsx` |
| 121 | SEO | No `robots.ts` configuration | `app/` directory |

### Backlog (11)

| # | Area | Issue | Source |
|---|------|-------|--------|
| BL.1 | Data | No archival/retention policy for 10M+ rows | dsi-plan1 |
| BL.2 | ML | `pickle` RCE risk + hardcoded year 2025 | dsi-plan1 |
| BL.3 | API | No API versioning (`/api/v1/`) | dsi-plan1 |
| BL.4 | Legal | No GDPR/privacy compliance (cookie consent, data deletion) | dsi-plan1 |
| BL.5 | UX | No dark mode / theme support | dsi-plan1 |
| BL.6 | UX | No PWA support (service worker, offline) | dsi-plan1 |
| BL.7 | Infra | No CDN strategy for 10M+ scale | dsi-plan1 |
| BL.8 | Frontend | React Compiler for automatic memoization | k-plan1 |
| BL.9 | TS | `noUncheckedIndexedAccess` tsconfig flag | k-plan1, dsi-plan1 |
| BL.10 | Arch | PropertyCard misplaced in `ui/` primitives directory | m-plan1 |
| BL.11 | Arch | `calculators.ts` + `finance.ts` consolidation | m-plan1 |

---

## Appendix B: Quick Wins Cheat Sheet

These can be done in under 30 minutes each with outsized impact:

| # | Fix | Time | Impact |
|---|-----|------|--------|
| 1 | Replace `exec()` with `execFile()` in scrape route | 15 min | Closes command injection |
| 2 | Floor zoom value in cache key | 5 min | 10x+ cache hit rate |
| 3 | Add `try/finally` to all `pool.connect()` calls | 30 min | Prevents connection leaks |
| 4 | Replace `layout.tsx` metadata | 5 min | Fixes SEO for all pages |
| 5 | Dynamic import html2canvas + jsPDF | 15 min | -500KB initial bundle |
| 6 | Conditional render PropertyMap when hidden | 5 min | Saves memory on mobile |
| 7 | Add `loading="lazy"` to PropertyCard images | 5 min | Bandwidth savings |
| 8 | Move `Intl.NumberFormat` to module scope | 10 min | -100 formatter creations |
| 9 | Remove dead cluster layer code from PropertyMap | 10 min | Code clarity |
| 10 | Remove `CREATE EXTENSION IF NOT EXISTS postgis` from API route | 2 min | Removes lock contention |
| 11 | Add `ORDER BY created_at DESC` to viewport query | 2 min | Deterministic caching |
| 12 | Fix zero-interest mortgage edge case | 5 min | Correct financial output |
| 13 | Fix price/sqft division by zero | 5 min | Prevents absurd values |
| 14 | Add `Redis.maxmemory` + `allkeys-lru` | 5 min | Prevents Redis OOM |
| 15 | Remove `version: '3.8'` from docker-compose | 1 min | Removes deprecation warning |
| 16 | Create `safeErrorResponse()` helper, replace all `error.message` returns | 15 min | Closes schema info leakage |
| 17 | Add null-price guard in `actions.ts` (`null` → "Price unavailable") | 5 min | No more "$0" listings |
| 18 | Run `git filter-repo --invert-paths --path .env.local` | 10 min | Purges secrets from git history |

---

## Appendix C: Cross-Reference Sources

The following items were identified by cross-referencing g-plan1 against three independent improvement plans (dsi-plan1, m-plan1, k-plan1). Items are listed with their source and the g-plan1 section where they were incorporated.

| G-Plan Section | Issue | Source Plan | Original Section |
|----------------|-------|-------------|------------------|
| 0.6 | Purge `.env.local` from git history | k-plan1 | P0 (Security #1) |
| 0.7 | SQL injection in ORDER BY | dsi-plan1 | Scale 1.6 |
| 0.8 | Error responses leak schema details | m-plan1 | Phase 2.6 |
| 0.9 | No HTTP security headers | dsi-plan1 | Scale 2.10 |
| 1.8 | PropertyMap source ID mismatch | dsi-plan1 | Scale 1.1 |
| 1.9 | Schema/application column drift | dsi-plan1 | Scale 1.3 |
| 1.10 | Null price → "$0" display | dsi-plan1 | Scale 2.3 |
| 1.11 | Stripe price ID validation | m-plan1 | Phase 2.3 |
| 1.12 | Stripe webhook idempotency | dsi-plan1 | Scale 5.2 |
| 1.13 | Stripe metadata trust issue | m-plan1 | Phase 2.4 |
| 1.14 | Admin route RBAC | m-plan1 | Phase 2.2 |
| 2.15 | Debounce filter inputs | dsi-plan1 | Scale 2.4 |
| 2.16 | TanStack Query for client data | k-plan1 | P1 (Data Fetching) |
| 3.19 | Strip `raw_data` from list query | m-plan1 | Phase 4.2 |
| 3.20 | Cursor pagination + server-side `showSold` | m-plan1 | Phase 4.5 |
| 3.21 | `rent_price_ratio` generated column | m-plan1 | Phase 4.7 |
| 3.22 | Redis caching for server actions | m-plan1 | Phase 4.4 |
| 3.23 | Add `.dockerignore` | dsi-plan1 | Implied Scale 3.6/3.7 |
| 3.24 | Pin n8n Docker image tag | dsi-plan1 | Scale 0.3 |
| 3.25 | Docker network segmentation | dsi-plan1 | Scale 0.3 |
| 4.8 | Env var validation with Zod | k-plan1, m-plan1 | k P1 (Type Safety #5), m Phase 2.5 |
| 4.9 | Database migration tooling | dsi-plan1 | Scale 4.8 |
| 4.10 | Prettier + ESLint + pre-commit hooks | k-plan1 | P2 (Developer Experience) |
| 4.11 | Remove 71 `console.log` statements | k-plan1 | P2 (Developer Experience #3) |
| 4.12 | Python structured logging | dsi-plan1 | Scale 4.6 |
| 4.13 | Scraper code dedup (~80% overlap) | dsi-plan1 | Scale 2.2 |
| 4.14 | Database backup strategy | dsi-plan1 | Scale 2.9 |
| 5.16 | Image alt text + lightbox Escape key | k-plan1 | P3 (Accessibility #1, #4) |
| 5.17 | Color-only status indicators | k-plan1 | P3 (Accessibility #5) |
| BL.1 | Data archival/retention policy | dsi-plan1 | Scale 5.9 |
| BL.2 | ML model `pickle` RCE + hardcoded year | dsi-plan1 | Scale 5.10 |
| BL.3 | API versioning | dsi-plan1 | Scale 4.7 |
| BL.4 | GDPR/privacy compliance | dsi-plan1 | Scale 5.11 |
| BL.5 | Dark mode | dsi-plan1 | Scale 5.6 |
| BL.6 | PWA support | dsi-plan1 | Scale 5.4 |
| BL.7 | CDN strategy | dsi-plan1 | Scale 3.3 |
| BL.8 | React Compiler | k-plan1 | P2 (Performance #4) |
| BL.9 | `noUncheckedIndexedAccess` | k-plan1, dsi-plan1 | k P1 (Type Safety #3), d Scale 4.4 |
| BL.10 | Move PropertyCard out of `ui/` | m-plan1 | Phase 3.6 |
| BL.11 | Consolidate `calculators.ts` + `finance.ts` | m-plan1 | Phase 3.7 |

**Methodology:** Each item in dsi-plan1, m-plan1, and k-plan1 was compared against g-plan1's original 97 issues. Items that g-plan1 already covered (even with different wording) were excluded. Only genuinely missing items were incorporated. 29 items were merged into the main tiers (0-5), 11 items were placed in the backlog.
