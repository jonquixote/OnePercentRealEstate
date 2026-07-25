# Instant Market Pages — 21,466 Cold Pages at 10.4 Seconds Each

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/market/77002` takes **10.4 seconds** on first view. So does `/market/44102`, and every other ZIP — the second hit is 0.005 s because it caches, but each of the **21,466 market pages** pays the full cost the first time anyone (or any crawler) touches it. We just published all of those URLs in the sitemap, so search engines are about to walk them one cold page at a time. This is the same disease we cured on the homepage hero, on a surface with twenty thousand times the cardinality: the page computes market aggregates on demand instead of reading a precomputed row.

**Architecture:** A `market_summary` table holds one row per ZIP with everything the market page renders above the fold (inventory counts, median price/rent/ratio, 1%-clearing count, distribution, trend). A worker pass refreshes it — the whole table in **one grouped scan**, not one query per ZIP, so refreshing 21k markets costs about what a single market page costs today. The page reads its row by primary key and falls back to the existing on-demand path only for a ZIP that has never been summarized. Reuses `cachedSWR` (stale-while-revalidate + single-flight) so a cold cache is never user-visible, exactly as on the hero.

**Tech Stack:** Postgres 16, `apps/one/src/app/market/[zip]/page.tsx` + its API routes, `@/lib/cache-swr`, the worker refresh pattern from `oper-stats-refresh`, Vitest.

## Global Constraints

- **The page must render identically.** Capture the current output for several representative ZIPs as fixtures first; the refactor is latency-only.
- **One grouped pass, never per-ZIP loops.** The refresh must compute all ZIPs in a single `GROUP BY zip_code` scan. A per-ZIP loop over 21k markets would recreate the load problem we just fixed (see `db-performance.md` §6).
- **Lifecycle filters preserved** — `listing_status NOT IN ('sold','stale','rental_misfiled')` everywhere, matching the current page.
- **Respect the load budget.** The refresh must cost meaningfully less than the on-demand traffic it replaces, and must be verified against `db-load-budget.sh`. Moving work off the request path is only a win if the total goes down — the hero refresh initially got this wrong at a 5-minute cadence.
- **Sparse ZIPs must not break.** Many ZIPs have a handful of listings; medians and percentiles must degrade to null cleanly, never NaN or a divide-by-zero.
- **Crawler-safe:** an unauthenticated cold GET must be fast and fully cacheable. This is the surface search engines are about to crawl 21k times.
- **Tests:** `pnpm --filter @oper/one test`; migration via the standard runner.

## Current State (measured 2026-07-26 on prod)

- `/market/77002` cold: **10.45 s**; second hit **0.005 s**. `/market/44102` cold: **10.41 s** — i.e. the cost is per-ZIP, not one-time warmup.
- The sitemap now publishes **21,466 market URLs** (all distinct active ZIPs), so cold-page traffic is about to arrive in volume.
- `pg_stat_statements` shows a ZIP-ranking aggregate at **21,021 ms mean × 25 calls** — the market surface's heavy query family.
- The homepage precedent works and is deployed: `stats_summary` + `cachedSWR` took `/api/stats` from 18.5 s → 0.012 s, and 20 concurrent cold requests from "all queue behind one query" to a 0.12 s worst case.
- `listings` is 9.6 GB / 1.3 M rows with 1.29 GB of indexes; **59% of rows are `stale`** — the companion plan (`2026-07-27-hot-cold-listings.md`) shrinks what every one of these scans has to read.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_27_market_summary.sql` (create) | `market_summary(zip_code PK, payload jsonb, computed_at)`. |
| `apps/one/src/lib/market-compute.ts` (create) | The grouped SQL + row shaping + `readMarketSummary(zip)`; single source of truth. |
| `apps/one/src/app/api/internal/refresh-markets/route.ts` (create) | ADMIN_API_KEY-gated full refresh (one grouped pass). |
| `ops/systemd/oper-market-refresh.{service,timer}` (create) | Drives the refresh off the request path. |
| `apps/one/src/app/market/[zip]/page.tsx` (modify) | Read the summary row; on-demand only when absent. |
| `documentation/operations/db-performance.md` (modify) | Record the before/after and the refresh's load cost. |

---

## Task 1: Freeze current market-page output

- [ ] **Step 1:** Capture the rendered data for 4 representative ZIPs — dense (`77002`), mid (`44102`), sparse (a ZIP with <20 listings), and one with no rent estimates — as fixtures with capture dates.
- [ ] **Step 2:** Write invariant assertions mirroring `api/stats/contract.test.ts`: counts non-negative and internally consistent, medians null-or-positive (never NaN), distribution buckets contiguous, and the sparse ZIP degrading cleanly.
- [ ] **Step 3:** Commit — `test(market): freeze market-page output as the refactor contract`

## Task 2: `market_summary` + one-pass refresh

- [ ] **Step 1: Migration** — `market_summary(zip_code text PRIMARY KEY, payload jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now())`, commented as derived/disposable.
- [ ] **Step 2: Failing test** for `computeAllMarkets()`: issues **exactly one** grouped query (assert call count) and returns one payload per ZIP matching the Task 1 fixtures for the sampled ZIPs.
- [ ] **Step 3: RED → implement** in `market-compute.ts`: a single `... FROM listings WHERE <lifecycle filters> GROUP BY zip_code` producing every field the page needs, then a bulk `INSERT … ON CONFLICT (zip_code) DO UPDATE`. Log duration + ZIP count.
- [ ] **Step 4:** Internal refresh route + `oper-market-refresh.timer`. **Start at a conservative cadence (hourly)** and let Task 5's measurement justify any change — the hero refresh taught us to size the cadence against the load it replaces.
- [ ] **Step 5:** Commit — `feat(market): market_summary + single-pass refresh for all ZIPs`

## Task 3: Serve the page from the summary

- [ ] **Step 1: Failing test** — the market page reads `market_summary` (assert no aggregate over `listings` on the hot path); output matches the fixtures; a ZIP with no row computes once, stores, and serves.
- [ ] **Step 2: RED → implement** with `cachedSWR` around `readMarketSummary(zip)`, mirroring `/api/stats`.
- [ ] **Step 3:** Suite + typecheck; commit — `perf(market): serve market pages from precomputed summary`

## Task 4: Crawl-safety for 21k URLs

- [ ] **Step 1:** Confirm `generateStaticParams`/`revalidate` on the market route do not trigger a per-ZIP cold compute at build time; the summary table must be the only source.
- [ ] **Step 2:** Set cache headers so a crawler's repeat visits are served from the edge/CDN cache (`s-maxage` + `stale-while-revalidate`), consistent with the hero routes.
- [ ] **Step 3:** Commit — `perf(market): crawler-safe caching for the 21k sitemap URLs`

## Task 5: Deploy + prove

- [ ] **Step 1:** Apply the migration, deploy, run the refresh, confirm `market_summary` holds ~21k rows and log the pass duration.
- [ ] **Step 2: Latency proof** — with the SWR keys flushed, **5 previously-unvisited ZIPs** each respond in **< 300 ms** (baseline: 10.4 s). Include a sparse ZIP and a dense one.
- [ ] **Step 3: Volume proof** — request 100 distinct ZIPs sequentially; total wall time and DB load stay flat (today this would be ~17 minutes of database work).
- [ ] **Step 4: Load proof** — `db-load-budget.sh` shows the refresh does not become the new top consumer; record its cost/hour against the traffic it replaced.
- [ ] **Step 5: Correctness proof** — sampled ZIPs match the Task 1 fixtures field-by-field within tolerance for genuine data movement.

## Self-Review

**Spec coverage:** the 10.4 s per-ZIP cold cost leaves the request path (T2, T3) · the surface we just published 21k URLs for becomes crawler-safe (T4) · correctness is pinned before the refactor and re-verified after (T1, T5) · the refresh is explicitly measured against the load it replaces so we don't repeat the hero-cadence mistake (T5 Step 4). Covered.

**Placeholder scan:** exact files, exact table schema, numeric targets (<300 ms, 100 ZIPs, ~21k rows), and named representative ZIPs including sparse/no-rent edge cases.

**Type consistency:** `market_summary.payload` is the single contract produced by `computeAllMarkets()` and consumed by the page via `readMarketSummary()`; `cachedSWR` is reused unchanged from the hero work.
