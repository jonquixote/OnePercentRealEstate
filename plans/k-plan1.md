# 1% Real Estate — Comprehensive Improvement Plan

> Generated: 2026-05-31
> Based on: Next.js 16, React 19, TypeScript 5, Tailwind CSS v4, PostgreSQL+PostGIS, Python FastAPI scraper
> Assessment: Deep-dive analysis via subagent exploration of frontend, backend, database, and infrastructure layers

## 🔴 Executive Summary

This application is a **Next.js 16 + React 19** full-stack real estate investment analysis platform. It has a **strong modern foundation** but suffers from:

1. **Zero test coverage** — no unit, integration, or E2E tests
2. **Type safety gaps** — 33 `any` types, 4 `@ts-ignore`, duplicate property interfaces
3. **Data fetching anti-patterns** — Server Actions in `useEffect`, no caching layer
4. **Component bloat** — 675-line monolithic property page
5. **Security vulnerabilities** — hardcoded secrets, command injection, disabled auth
6. **No CI/CD or automated checks** — 78 custom Expect scripts instead of GitHub Actions
7. **Performance issues** — eager imports of PDF/chart libs, no lazy loading
8. **Accessibility gaps** — missing alt text, aria labels, keyboard navigation

---

## 📋 Priority Matrix

| Priority | Category | Effort | Impact |
|----------|----------|--------|--------|
| 🔴 P0 | Security | 2-4 hrs | Critical — live keys exposed, RCE possible |
| 🔴 P0 | Testing | 4-8 hrs | Critical — zero coverage |
| 🟡 P1 | Type Safety | 4-6 hrs | High — prevents bugs, improves DX |
| 🟡 P1 | Data Fetching | 4-6 hrs | High — better UX, fewer bugs |
| 🟡 P1 | Component Refactoring | 6-10 hrs | High — maintainability |
| 🟢 P2 | Performance | 4-6 hrs | Medium — faster page loads |
| 🟢 P2 | Developer Experience | 2-4 hrs | Medium — faster dev, consistency |
| 🔵 P3 | Documentation | 2-3 hrs | Low — onboarding, maintainability |
| 🔵 P3 | CI/CD & DevOps | 4-8 hrs | Low — automation |

---

## 🔴 P0: Security (Do Before Anything Else)

### 1. Rotate All Committed Secrets
**Files**: `.env.local`, `infrastructure/docker-compose.yml`, `infrastructure/setup_server.sh`, multiple Python files

The `.env.local` is **committed to git** with live secrets. This is a critical vulnerability. Anyone with access to the repo has full access to your Stripe, Mapbox, FRED, and Supabase accounts.

**Actions**:
- Rotate immediately: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `FRED_API_KEY`, `HUD_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`
- Add `.env.local` to `.gitignore`
- Create `.env.example` with placeholder values and documentation
- Revoke and regenerate all exposed API keys
- Check GitHub commit history — remove `.env.local` from history entirely (`git filter-repo` or BFG)

### 2. Fix Command Injection Vulnerability
**Files**: `src/app/api/scrape/route.ts`, `src/app/api/fetch-rentals/route.ts`

```typescript
// CRITICAL: Direct shell command execution with user input
const command = `cd "${backendDir}" && source venv/bin/activate && python scraper.py ${args}`;
```

An attacker could inject shell commands via the `location` or `minPrice` parameters.

**Action**: Replace with `child_process.spawn` or the scraper FastAPI service (`SCRAPER_URL`). Never execute shell commands with user input.

### 3. Remove Hardcoded Credentials
**Files**: `infrastructure/docker-compose.yml`, `_backend/seed_counties.py`, multiple Python files

```yaml
# docker-compose.yml
POSTGRES_PASSWORD=root_password_change_me_please
```

```python
# _backend/seed_counties.py
DB_PASS = "root_password_change_me_please"
```

### 4. Lock Down Admin Endpoints
**Files**: `src/app/api/admin/seed-jobs/route.ts`, `src/app/api/admin/reset-jobs/route.ts`

These endpoints have **no authentication or authorization**. Anyone on the internet can trigger data scraping or reset stuck jobs.

**Action**: Add middleware check for admin API key or re-enable auth before deploying.

### 5. Re-enable Authentication
**Files**: `src/middleware.ts`, `src/app/api/checkout/route.ts`

Auth is completely disabled:
```typescript
// middleware.ts
// Middleware disabled - no Supabase auth
// Pass through all requests - no auth check
```

The checkout endpoint has no user check. Anyone can create checkout sessions.

**Recommended approach**: Use [Clerk](https://clerk.dev) or [NextAuth.js v5](https://github.com/nextauth/next-auth). Clerk is fastest to set up. If using existing Supabase, re-enable with proper RLS.

---

## 🔴 P0: Testing (Zero → Basic Coverage)

### Current State
- **Zero tests**: No unit, integration, or E2E tests
- **Frontend**: No React Testing Library, no Vitest, no Jest
- **Backend**: No Python unit tests
- **API**: No API testing (manual curl/expect scripts only)
- **E2E**: No Playwright, no Cypress

### Recommended Stack
- **Vitest** — Fast, ESM-native test runner (replaces Jest)
- **@testing-library/react** — React component testing
- **MSW (Mock Service Worker)** — Mock API calls in tests
- **Playwright** — E2E testing for critical user flows
- **pytest** — Python backend testing

### What to Test First (ROI Priority)

1. **Cashflow calculations** (`src/lib/calculators.ts`, `src/lib/finance.ts`)
   - These are financial calculations — a bug costs users money
   - Start here: they are pure functions, easiest to test

2. **API route handlers** (key routes)
   - `/api/properties/viewport` — Zod validation, rate limiting, caching
   - `/api/mortgage-rates` — fallback logic, caching
   - `/api/checkout` — Stripe integration (mocked)

3. **Critical user flows** (Playwright E2E)
   - Dashboard → property detail → cashflow calculator → compare
   - Search → trigger scraper (if implemented as E2E)
   - Pricing → Stripe checkout

4. **Component rendering**
   - `PropertyCard` — renders with minimal data
   - `CashflowCalculator` — form validation, calculation display
   - `PropertyMap` — renders without crashing

### Implementation Plan

```bash
# 1. Install dependencies
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event msw playwright

# 2. Add scripts to package.json
"test": "vitest",
"test:e2e": "playwright test",
"test:ui": "vitest --ui"
```

Create `vitest.config.ts` and `playwright.config.ts`.

---

## 🟡 P1: Type Safety & Shared Types

### Current State
- 33 occurrences of `any` across 9 files
- 4 `@ts-ignore` suppressions
- `Property` interface defined inline in `page.tsx`, also in `PropertyMap.tsx` (duplicate)
- `CashflowCalculator` prop is `any`
- No Zod schemas for API responses

### Actions

1. **Create `src/types/index.ts`**
   - Define shared `Property`, `Listing`, `MarketTrend`, `CashflowInput`, etc.
   - Export Zod schemas alongside TypeScript types using `z.infer<>`

2. **Remove all `any` and `@ts-ignore`**
   - Replace `any` with proper types in `page.tsx`, `property/[id]/page.tsx`, `compare/page.tsx`, etc.
   - Fix `getProperties` and `getProperty` return types in `src/app/actions.ts`

3. **Stricter TypeScript Config**
   - Add to `tsconfig.json`:
     ```json
     "noUncheckedIndexedAccess": true,
     "noUnusedLocals": true,
     "noUnusedParameters": true
     ```

4. **Zod for API Input Validation**
   - Already used in `src/app/api/properties/viewport/route.ts` — apply to ALL routes
   - Validate request body, query params, and path params on every API endpoint

5. **Validate Environment Variables**
   - Create `src/lib/env.ts` using Zod:
     ```typescript
     import { z } from 'zod';
     const envSchema = z.object({
       DATABASE_URL: z.string().url(),
       STRIPE_SECRET_KEY: z.string().startsWith('sk_live_').or(z.string().startsWith('sk_test_')),
       // ... validate all required env vars
     });
     export const env = envSchema.parse(process.env);
     ```
   - Fail fast on startup if env vars are missing or invalid
   - Remove all hardcoded fallbacks (especially `FRED_API_KEY`)

---

## 🟡 P1: Data Fetching (Server Actions in useEffect → Proper Patterns)

### Current State
- **Anti-pattern**: `page.tsx` is `'use client'` but fetches via Server Action in `useEffect`
- No caching strategy beyond basic Redis on one endpoint
- No query deduplication
- Manual loading/error state management

### Actions

1. **Convert Dashboard to Server Component**
   - Remove `'use client'` from `src/app/page.tsx`
   - Fetch data directly in the Server Component (it can be async)
   - Pass data to child Client Components as needed

2. **Add React Query (TanStack Query) v5**
   - For data that needs to be fetched on the client (e.g., search results, filtering)
   - Provides caching, deduplication, background refetching, and isLoading/isError states
   - Install: `npm install @tanstack/react-query`
   - Wrap app in `QueryClientProvider`

3. **Server Actions for Mutations Only**
   - Server Actions should be used for form submissions and mutations, not data fetching
   - Convert `getProperties` and `getProperty` to regular API routes (or keep as Server Actions but call from Server Components)

4. **Implement Proper Error Boundaries**
   - Add `react-error-boundary` package
   - Create `ErrorFallback` component for API errors
   - Wrap data-fetching sections in error boundaries

---

## 🟡 P1: Component Architecture (Monolithic → Modular)

### Current State
- `src/app/property/[id]/page.tsx` — **675 lines** with all 3 tabs inline
- `src/app/page.tsx` — **269 lines** with filters, map, list, and selection
- Mixed business logic and presentation
- `PropertyCard` is defined inside `src/components/ui/card.tsx` (should be separate)

### Actions

1. **Split Property Detail Page**
   - `PropertyOverview.tsx` — Hero, key facts, photos
   - `PropertyFinancialsSection.tsx` — Cashflow, charts
   - `PropertyMarketSection.tsx` — Market trends, charts
   - `PropertyAmenities.tsx` — Amenities list
   - `PropertySchools.tsx` — School data
   - `PropertyTabs.tsx` — Tab navigation wrapper

2. **Move Domain Components Out of UI Primitives**
   - `PropertyCard` → `src/components/property/PropertyCard.tsx`
   - `CashflowCalculator` is well-placed but could be decomposed further
   - Keep `src/components/ui/` for truly generic primitives only

3. **Extract Custom Hooks**
   - `usePropertyCalculations(property)` — from `CashflowCalculator`
   - `usePropertySearch(filters)` — from `page.tsx`
   - `useMapBounds()` — from `PropertyMap`

4. **Extract Shared Utilities**
   - `formatCurrency`, `formatNumber`, `formatPercent` — shared across components, currently recreated in multiple files
   - Image extraction from `raw_data` — duplicated in `actions.ts` and API routes

---

## 🟢 P2: Performance

### Current State
- `html2canvas` and `jspdf` are eagerly imported (only needed for PDF export)
- `recharts` is eagerly imported (only needed on market charts tab)
- No lazy loading of heavy components
- No Suspense boundaries for streaming data

### Actions

1. **Lazy Load Heavy Libraries**
   ```tsx
   import dynamic from 'next/dynamic';
   const html2canvas = dynamic(() => import('html2canvas'));
   const jsPDF = dynamic(() => import('jspdf'));
   ```

2. **Add Suspense Boundaries**
   ```tsx
   // app/property/[id]/page.tsx
   <Suspense fallback={<PropertySkeleton />}>
     <PropertyDetail id={id} />
   </Suspense>
   ```

3. **Use Next.js Image**
   - Replace `<img>` with `next/image` in `PropertyHero.tsx` and `PropertyCard`
   - Get lazy loading, blur placeholders, and size optimization

4. **React Compiler for React 19**
   - Enable experimental React Compiler for automatic memoization
   - Remove manual `useMemo`/`useCallback` where possible

5. **Virtualize Long Lists**
   - If property lists get very long, use `@tanstack/react-virtual`

---

## 🟢 P2: Developer Experience

### Current State
- No Prettier (inconsistent formatting)
- Minimal ESLint rules (no accessibility, no unused imports)
- 71 `console.log` statements in production code
- No pre-commit hooks
- No formatting on save configured

### Actions

1. **Add Prettier**
   ```bash
   npm install -D prettier
   ```
   Create `.prettierrc` and `.prettierignore`.

2. **Strengthen ESLint**
   - Add `@typescript-eslint/no-explicit-any`
   - Add `eslint-plugin-jsx-a11y` for accessibility
   - Add `eslint-plugin-unused-imports`
   - Enforce `react-hooks/exhaustive-deps`

3. **Remove console.logs in Production**
   - Add to ESLint: `no-console` (warn)
   - Remove or replace with a proper logging library (Pino, Winston)
   - Use `logger.debug()` that only logs in development

4. **Add Husky + lint-staged**
   ```bash
   npm install -D husky lint-staged
   npx husky init
   ```
   Run `eslint --fix` and `prettier --write` on pre-commit.

---

## 🔵 P3: CI/CD & DevOps

### Current State
- **78 `.exp` (Expect) scripts** for VPS deployment instead of standard CI/CD
- No GitHub Actions, no automated testing on PR
- Deployment is manual via SSH and Expect scripts
- No staging environment

### Recommended Actions

1. **Add GitHub Actions**
   - On PR: Run `npm ci`, `npm run lint`, automated tests, type check
   - On merge to `main`: Deploy to staging
   - On tag: Deploy to production

2. **Container Health Checks**
   - Add `healthcheck` to Docker Compose services
   - Currently only `pg_tileserv` has a health check

3. **Add Sentry for Monitoring**
   ```bash
   npm install @sentry/nextjs
   ```
   Capture frontend errors, API route errors, and performance data.

4. **Structured Logging**
   - Replace `console.log/error` with a structured logger (Pino)
   - Include request ID, user ID, and structured context
   - Forward logs to a central log aggregation (e.g., Datadog, Grafana Loki)

---

## 🔵 P3: Accessibility (a11y)

### Current State
- Missing `alt` text on property images
- Missing `aria-label` on interactive elements
- Tab buttons missing `aria-selected`
- `alert()` for user feedback (blocking)
- Lightbox missing keyboard `Escape` handler
- Color-only status indicators (violates WCAG)

### Actions
1. Add proper `alt` to all images (use `aria-label` for decorative images)
2. Add `aria-label` to all interactive elements
3. Replace `alert()` with inline error states or toast notifications
4. Add `Escape` key handler for modal/lightbox
5. Ensure all color-only indicators have text or icon alternatives
6. Run `axe-core` or Lighthouse a11y audit to catch remaining issues

---

## 📊 Technical Debt Register

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | 675-line monolithic property page | `app/property/[id]/page.tsx` | High |
| 2 | Duplicate financial logic | `lib/calculators.ts`, `lib/finance.ts` | High |
| 3 | `any` property prop | `components/ui/card.tsx` | Medium |
| 4 | Inline function definitions | `app/property/[id]/page.tsx` | Medium |
| 5 | Missing error boundaries | All data-fetching components | Medium |
| 6 | `form.watch` in useEffect deps | `components/CashflowCalculator.tsx` | Medium |
| 7 | No debounce on calculator | `components/CashflowCalculator.tsx` | Low |
| 8 | Hardcoded `LIMIT 500` in sitemap | `app/sitemap.ts` | Low |

---

## ✅ Quick Wins (Can Do Today)

1. **Enable Prettier** (5 min) — Run `npx prettier --write src/` to standardize formatting
2. **Remove `.env.local` from git** (5 min) — `git rm --cached .env.local && echo ".env.local" >> .gitignore`
3. **Replace `alert()` with inline UI** (15 min) — In `page.tsx` and `pricing/page.tsx`
4. **Add `next/image`** (20 min) — Replace `<img>` in `PropertyHero.tsx` and `PropertyCard`
5. **Add basic Suspense** (30 min) — Wrap heavy data sections with `<Suspense fallback={<Skeleton />}>`
6. **Consolidate `formatCurrency`/`formatNumber`** (15 min) — Extract to a shared util
7. **Add `.env.example`** (10 min) — Document all required environment variables
8. **Remove `console.log` from production** (30 min) — Replace with proper logging or remove
9. **Fix `@ts-ignore`** (15 min) — Fix types properly or document with `// @ts-expect-error` and reason
10. **Add `aria-label` to interactive elements** (30 min) — Quick accessibility pass

---

## 🗺️ Implementation Roadmap

### Week 1: Emergency & Foundation
- [ ] Rotate all exposed secrets (Stripe, Mapbox, FRED, Supabase)
- [ ] Remove `.env.local` from git, create `.env.example`
- [ ] Fix command injection in `scrape/route.ts`
- [ ] Add `child_process.spawn` or use FastAPI scraper service
- [ ] Lock down admin endpoints (add API key auth)
- [ ] Add Prettier, ESLint rules, and pre-commit hooks
- [ ] Enable basic error boundaries

### Week 2: Type Safety & Testing
- [ ] Remove all `any` and `@ts-ignore`
- [ ] Create shared `src/types/` with Zod schemas
- [ ] Add Zod validation to all API routes
- [ ] Install Vitest, write first tests for `calculators.ts`
- [ ] Add `no-explicit-any` and `jsx-a11y` to ESLint

### Week 3: Architecture Refactoring
- [ ] Split `property/[id]/page.tsx` into tab components
- [ ] Convert `page.tsx` dashboard to Server Component
- [ ] Add TanStack Query for client-side data fetching
- [ ] Extract custom hooks (`usePropertyCalculations`, etc.)
- [ ] Lazy load `html2canvas`, `jspdf`, `recharts`

### Week 4: Performance & Polish
- [ ] Add `next/image` everywhere
- [ ] Add Suspense boundaries with skeletons
- [ ] Replace `alert()` with toast notifications
- [ ] Add keyboard navigation for modals/lightbox
- [ ] Run Lighthouse audit and fix scores
- [ ] Write first Playwright E2E tests

### Week 5: DevOps & Monitoring
- [ ] Add GitHub Actions CI workflow
- [ ] Integrate Sentry for error tracking
- [ ] Add Python tests with pytest
- [ ] Add health checks to Docker services
- [ ] Document deployment process

---

## 📝 Notes

1. **Next.js 16 + React 19 are very new** — some libraries may not be fully compatible. Test carefully when adding new dependencies.

2. **The app uses both Server Actions and API routes** — pick a single pattern and standardize. Recommend: Server Components for fetching, API routes for external integrations (Stripe, scrapers).

3. **The Python scraper is a significant piece** — it has its own deployment, Docker service, and n8n integration. Any changes to scraping need careful coordination.

4. **PostGIS is used for spatial queries** — ensure any database refactoring maintains spatial indexes and queries.

5. **Auth is completely disabled** — this is fine for current phase, but must be enabled before taking payments.

---

## 📚 References

- [React 19 Upgrade Guide](https://react.dev/blog/2024/12/08/react-19)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Testing](https://playwright.dev/)
- [Zod TypeScript Validation](https://zod.dev/)
- [TanStack Query](https://tanstack.com/query/latest)
- [Next.js Data Fetching](https://nextjs.org/docs/app/building-your-application/data-fetching)
- [Web Content Accessibility Guidelines (WCAG)](https://www.w3.org/WAI/standards-guidelines/wcag/)
