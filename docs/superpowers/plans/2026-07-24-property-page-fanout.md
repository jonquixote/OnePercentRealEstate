# Tame the Property-Page Query Fan-Out (apps/one)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The property page is the product's most important — and heaviest — surface: a single view fires **~13 server-side DB queries** (getProperty, HUD benchmark, demographics, valuation, session prefs, schema data) plus **11 client sections that each fetch their own per-section API** (`/api/properties/[id]/{comps,context,history,rental-comps}`), every one a fresh DB round-trip. That was tolerable when nobody visited. But the SEO work just put **47,932 property/market URLs in the sitemap**, so crawlers will soon hit these pages at volume — and heavy per-page query fan-out against a memory-tuned Postgres (`work_mem=32MB`) is exactly the load pattern that contributed to the 2026-07-24 OOM. This plan measures the real per-page cost, parallelizes and caches the fan-out through the existing versioned Redis layer, and lazy-loads below-the-fold sections so a crawler (or a user) triggers a bounded, cache-friendly amount of work.

**Architecture:** Instrument the page to count queries + time per section (dev + a prod sample). Collapse the server-side fan-out: parallelize independent fetches (some are serial today) and cache each through `@/lib/cache`'s versioned `cached()` helper with per-domain TTLs. Wrap the four per-section API routes in the same cache so a repeat/crawler hit is served from Redis, not the DB. Convert below-the-fold client sections to lazy (`next/dynamic` + intersection) so the initial document render issues only the above-the-fold queries; a crawler that never scrolls never triggers the rest. Nothing changes visually.

**Tech Stack:** Next 16 App Router (server components + route handlers), `@/lib/cache` (Redis, versioned via `bumpCacheVersion`), the property page's server actions, Vitest.

## Global Constraints

- **No visual/behavioral change** — the page renders identically; only the timing/number of queries changes.
- **Cache invalidation stays correct** — property data caches key off the existing `props:version` (bumped on ingest); never serve stale price/status. TTLs: fast-moving (price/status) short, slow-moving (demographics/HUD/parcel) long.
- **Reuse `@/lib/cache`'s `cached()`** — do not hand-roll a second cache or import React `cache()` inside `'use server'` files (breaks the compiler; the repo already avoids this).
- **Crawler-safe** — an unauthenticated, no-scroll GET (a bot) must issue the fewest possible queries and be fully cacheable; personalized bits (session prefs / valuation gating) must not block or bloat the anonymous render.
- **Lifecycle filters intact** — all queries keep `listing_status NOT IN ('sold','stale','rental_misfiled')` where they already have it; caching must not resurrect quarantined listings.
- **Measurement before + after** — every optimization task states the query-count/latency it moved.
- **Tests:** `pnpm --filter @oper/one test`; cache-key + lazy-boundary unit tests where applicable.

## Current State (verified 2026-07-24)

- `apps/one/src/app/property/[id]/page.tsx`: ~13 server `await`s — `getProperty(id)`, `getHudBenchmark(zip)`, `getDemographics(zip)`, `fetchValuationRow`+`computeValuation`+`getSessionPrefs`, `buildSchemaData`, metrics. `getProperty`/`getHudBenchmark` already use `cached()` (Redis, `CACHE_TTL`); demographics/valuation caching unverified.
- **11** client section components under `components/property/sections/` fetch via `useSWR`/`fetch`/`useEffect` — hitting `/api/properties/[id]/{comps,context,history,rental-comps}` after hydration. These fire on EVERY load regardless of scroll.
- `@/lib/cache`: versioned Redis cache (`CACHE_VERSION_KEY='props:version'`, `bumpCacheVersion` on ingest, `CACHE_TTL` map).
- Sitemap now lists 47,932 URLs (top 25k deals + all markets) → crawler traffic incoming; `work_mem=32MB`, `max_connections=100` (post-OOM tuning).
- No per-page query instrumentation today.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/query-trace.ts` (create, dev-gated) | Wrap the pool to count/time queries per request for measurement. |
| `apps/one/src/app/property/[id]/page.tsx` (modify) | Parallelize the server fan-out; cache demographics/valuation; anon fast-path. |
| `apps/one/src/app/api/properties/[id]/{comps,context,history,rental-comps}/route.ts` (modify) | Wrap in `cached()` with per-route TTL. |
| `apps/one/src/components/property/sections/*` (modify) | Below-the-fold sections become `next/dynamic` + intersection-lazy. |
| `apps/one/src/lib/cache.ts` (modify) | Add TTL entries for the per-section domains if missing. |

---

## Task 1: Measure the real per-page cost

**Files:** create `apps/one/src/lib/query-trace.ts` (dev/flag-gated).

- [ ] **Step 1:** A pool wrapper (enabled only under a `QUERY_TRACE` flag) that logs, per request, the count + total time of DB queries and the slowest one. No-op in prod unless flagged.
- [ ] **Step 2: Capture the baseline** — load `/property/877` (a rich page) with tracing on: record server query count + time, then the client section API calls (from the network panel). Write the baseline into the plan's Decisions section: "server N queries / Xms; client M requests".
- [ ] **Step 3:** Commit — `feat(perf): request-scoped query tracing (flag-gated) + property-page baseline`

## Task 2: Cache the per-section API routes

**Files:** modify `apps/one/src/app/api/properties/[id]/{comps,context,history,rental-comps}/route.ts`; `apps/one/src/lib/cache.ts`.

- [ ] **Step 1: Failing test** — each route, called twice for the same id, issues its DB query ONCE (second served from a mocked cache); the cache key includes the id + `props:version`; a version bump misses.
- [ ] **Step 2: RED → implement.** Wrap each route's data load in `cached(key, CACHE_TTL.<domain>, loader)`. TTLs: `context`/`history` longer (slow-moving), `comps`/`rental-comps` medium. Keep lifecycle filters inside the loader.
- [ ] **Step 3:** Suite + typecheck; commit — `perf(property): cache comps/context/history/rental-comps routes (Redis, version-keyed)`

## Task 3: Collapse + cache the server fan-out

**Files:** modify `apps/one/src/app/property/[id]/page.tsx`.

- [ ] **Step 1:** Parallelize independent server fetches with a single `Promise.all` (today some run serially); ensure `getDemographics` + the valuation row load are `cached()` like `getProperty` already is (add TTL entries if missing).
- [ ] **Step 2: Anon fast-path** — the valuation/session-prefs branch must not block the anonymous render: for a signed-out request (a crawler), skip session work entirely and render the public view; personalization hydrates client-side for signed-in users only.
- [ ] **Step 3:** Re-measure with the Task 1 tracer: server query count for an anon load drops (target: the fan-out is parallel + cache-hit on repeat). Suite + typecheck; commit — `perf(property): parallelize + cache server fan-out, anon fast-path`

## Task 4: Lazy-load below-the-fold sections

**Files:** modify the below-fold `components/property/sections/*` + their mount in the page.

- [ ] **Step 1:** Identify above-the-fold (verdict, photos, price, rent-three-ways) vs below (nearby-by-strategy, risk, neighborhood, market-context, comps lists). Convert below-fold sections to `next/dynamic(..., { ssr: false })` mounted behind an IntersectionObserver so their per-section API calls fire only when scrolled into view.
- [ ] **Step 2:** A no-scroll load (crawler) issues only the above-the-fold section requests; assert via the network capture that the 4 heavy per-section calls do NOT fire on initial paint.
- [ ] **Step 3:** Verify the page still renders all sections on scroll (no visual regression); Lighthouse/TTFB improves. Commit — `perf(property): lazy-load below-the-fold sections (crawler issues bounded queries)`

## Task 5: Deploy + load proof

- [ ] **Step 1:** `bash ops/systemd/deploy-systemd.sh app` (smoke gate covers health/sitemap/property).
- [ ] **Step 2: Before/after proof:** the tracer + a small loop hitting 50 distinct `/property/<id>` pages shows (a) far fewer DB queries per page vs baseline, (b) a warm-cache repeat hit issuing ~0 DB queries for the cached sections; `pg_stat_activity` peak server connections during the loop stays modest (no spike toward `max_connections`).
- [ ] **Step 3: Crawler safety:** `curl` (no JS) of a property page triggers only the above-the-fold server work; the 4 section APIs are not hit. Commit proof into Decisions.
- [ ] **Step 4: No-regression:** every section still loads on scroll in a real browser; search + market pages unaffected; suites green.

## Self-Review

**Spec coverage:** the per-page cost is measured (T1) · repeat/crawler hits serve from Redis instead of the DB (T2, T3) · a bot triggers only bounded, above-the-fold work (T4) · deployed with a before/after load proof tied to the sitemap-crawler risk (T5). Every task states the query-count it moved. Covered.

**Placeholder scan:** exact files, the four section routes named, cache-key semantics specified; the above/below-fold split is enumerated. Measurement gates each optimization.

**Type consistency:** all caching flows through `@/lib/cache`'s `cached()` (one helper, version-keyed on `props:version`); no React `cache()` in `'use server'`; the tracer is a dev-only pool wrapper with no prod type surface.
