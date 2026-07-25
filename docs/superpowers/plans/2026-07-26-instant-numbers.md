# Instant Numbers — Precomputed Stats, No Cold-Path Stampede

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The homepage hero numbers sometimes take a minute to appear. Measured on prod: `/api/stats` takes **18.5 s cold** and `/api/stats/median-rent` **7.1 s cold**, because each recomputes aggregates by **sequentially scanning 1.3 M `listings` rows** on demand. They *are* Redis-cached — but with a **120-second TTL**, so roughly every two minutes a real user is the unlucky one who pays full price, and because there is no request coalescing, every visitor who arrives during that window queues behind the same 18-second query. That is the "about a minute". This plan makes those numbers **precomputed and instantly served**, and makes a cold cache impossible for a user to feel.

**Architecture:** A `stats_summary` table holds one row per (strategy, scope) with every number the hero renders, refreshed by the existing worker on a short interval. The API reads that single row — an indexed point lookup instead of a 1.3 M-row scan. Redis stays in front as a hot cache, but its semantics change to **stale-while-revalidate**: a user is always served immediately from the last good value while a refresh happens in the background, and a **single-flight lock** guarantees only one recompute runs no matter how many requests arrive. The expensive SQL moves out of the request path entirely.

**Tech Stack:** Postgres 16, `apps/worker` (refresh loop), `apps/one/src/app/api/stats/*`, `@/lib/cache` (Redis), Vitest.

## Global Constraints

- **No number may change meaning.** The hero must render exactly the same values it does today — this is a latency change, not a semantics change. Task 1 captures the current output as a fixture and later tasks assert equality against it.
- **Never serve a blank hero.** If the summary row is missing or stale, serve the last known good value and refresh in the background; only a completely cold, never-populated system may compute inline (and it must be bounded).
- **Lifecycle filters preserved** — every aggregate keeps `listing_status NOT IN ('sold','stale','rental_misfiled')` and the existing `listing_type`/`sale_type` predicates. A faster wrong number is worse than a slow right one.
- **Refresh must not become the new load problem.** The worker refresh is a single pass that computes *all* hero metrics at once (not one query per metric) and runs on a bounded interval; it is measured in Task 5 against the load budget.
- **Single-flight is mandatory** — concurrent cache misses must collapse to one computation (a Redis `SET NX` lock or equivalent). The stampede is half the bug.
- **`stats_summary` is derived data**: it can be dropped and rebuilt at any time and holds no source of truth.
- **Tests:** `pnpm --filter @oper/one test`, `pnpm --filter @oper/worker test`; migration via the standard runner.

## Current State (measured 2026-07-25 on prod)

| Endpoint | Cold | Warm | Why |
|---|---|---|---|
| `/api/stats` | **18.5 s** | 0.006 s | multi-aggregate + histogram + `resolve_rule` per property type over 1.3 M rows |
| `/api/stats/median-rent` | **7.1 s** | 0.005 s | `percentile_cont(0.5)` over all listings |
| `/api/stats/cuts` | 0.49 s | 0.12 s | acceptable |

- `EXPLAIN ANALYZE` of just the count+median portion: **Seq Scan on listings, 511 578 rows, 7 329 ms**.
- `apps/one/src/app/api/stats/route.ts:9` — `CACHE_TTL_S = 120`. Cache is written with `redis.setex` **after** a full recompute; on a miss every concurrent request recomputes (no lock).
- The hero consumes: `histogram`, `thresholdPct`, `onePercentPasses`, `medianRatioPct`, `rentCalcPending` (from `/api/stats`), plus `priceCuts` and `medianRent`.
- Existing materialized views (`mv_market_grid`, `mv_cluster_tiles`) prove the pattern and the worker refresh loop already exists (`CLUSTER_REFRESH_INTERVAL_MS`).

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_26_stats_summary.sql` (create) | `stats_summary` table + PK + `computed_at`. |
| `apps/worker/src/stats-refresh.ts` (create) + test | Single-pass compute of all hero metrics → upsert one row. |
| `apps/worker/src/index.ts` (modify) | Schedule the refresh loop. |
| `apps/one/src/app/api/stats/route.ts` (modify) | Read `stats_summary`; SWR + single-flight; inline compute only if never populated. |
| `apps/one/src/app/api/stats/median-rent/route.ts` (modify) | Read from the same summary row. |
| `apps/one/src/lib/cache.ts` (modify) | Add `cachedSWR(key, ttl, staleTtl, fn)` with single-flight. |

---

## Task 1: Freeze today's numbers as a fixture

- [ ] **Step 1:** Capture the live JSON of `/api/stats` and `/api/stats/median-rent` (per strategy the hero uses) and commit them as test fixtures with the capture date.
- [ ] **Step 2:** Write a test that asserts the *shape* and the invariants that must survive the refactor: `onePercentPasses` ≤ total, `histogram` bins sum to the counted population, `thresholdPct` matches `resolve_rule`'s default, no field becomes null.
- [ ] **Step 3:** Commit — `test(stats): freeze current hero numbers as the refactor contract`

## Task 2: `stats_summary` table + worker refresh

- [ ] **Step 1: Migration** — `stats_summary(strategy text, scope text, payload jsonb, computed_at timestamptz, PRIMARY KEY (strategy, scope))`. `payload` holds the full hero object so the API does no assembly.
- [ ] **Step 2: Failing test** for `computeStatsPayload()`: given a mocked pool returning known rows it produces the exact fixture shape from Task 1; it issues **one** query pass (assert call count), not one per metric.
- [ ] **Step 3: RED → implement** `stats-refresh.ts`: compute every hero metric (count, 1% passes, median ratio, histogram, rent-calc pending, median rent) in a single scan, then `INSERT … ON CONFLICT (strategy, scope) DO UPDATE`. Log duration + row counts.
- [ ] **Step 4: Schedule** it in the worker (`STATS_REFRESH_INTERVAL_MS`, default 5 min) and run once at boot so the table is never empty after a deploy.
- [ ] **Step 5:** Commit — `feat(stats): stats_summary table + single-pass worker refresh`

## Task 3: Stale-while-revalidate + single-flight in the cache layer

- [ ] **Step 1: Failing tests** for `cachedSWR`: a **fresh** hit returns instantly without calling the loader; a **stale-but-present** hit returns the stale value *immediately* and triggers exactly one background refresh; **N concurrent misses call the loader once** (single-flight) and all receive the same value; a loader error leaves the previous value served (never throws to the caller when a stale value exists).
- [ ] **Step 2: RED → implement** in `@/lib/cache` alongside `cached()` — do not change `cached()`'s behavior for existing callers. Use a Redis `SET NX PX` lock for single-flight and store `{value, computedAt}` so staleness is explicit.
- [ ] **Step 3:** Suite + typecheck; commit — `feat(cache): cachedSWR — stale-while-revalidate with single-flight`

## Task 4: Serve the hero from the summary row

- [ ] **Step 1: Failing test** — `/api/stats` reads `stats_summary` (assert the query, and that **no aggregate over `listings`** is issued on the hot path); output equals the Task 1 fixture; when the row is missing entirely it falls back to an inline compute **once** and populates the table; `/api/stats/median-rent` reads the same row.
- [ ] **Step 2: RED → implement.** Route becomes: `cachedSWR` → `SELECT payload FROM stats_summary WHERE strategy=$1 AND scope=$2`. Raise the Redis TTL (the value is already precomputed; freshness now comes from the worker) and set `stale` well above it.
- [ ] **Step 3:** Suite + typecheck; commit — `perf(stats): serve hero from precomputed summary (no request-path aggregates)`

## Task 5: Deploy + prove it

- [ ] **Step 1:** Apply the migration, deploy `app` + `worker`, confirm the refresh loop populates `stats_summary` and logs its duration.
- [ ] **Step 2: Latency proof** — with Redis **flushed for these keys** (true cold), `/api/stats` and `/api/stats/median-rent` respond in **< 300 ms** (target: < 100 ms). Compare against the recorded 18.5 s / 7.1 s baseline in the commit message.
- [ ] **Step 3: Stampede proof** — 20 concurrent requests against a cold key produce **one** compute (assert via the worker/route log or a counter) and every response is fast; no request waits on another.
- [ ] **Step 4: Correctness proof** — the served payload equals the Task 1 fixture (allowing for genuine data movement: assert field-by-field within tolerance, not byte equality).
- [ ] **Step 5: Load proof** — the refresh pass costs less than the load it removed: record its duration × frequency vs the previous on-demand cost, and confirm `pg_stat_statements` no longer shows the stats aggregates among the top consumers.

## Self-Review

**Spec coverage:** the 18.5 s/7.1 s cold paths leave the request path entirely (T2, T4) · a user can never feel a cold cache — stale is served instantly and only one refresh runs (T3) · numbers are provably unchanged (T1, T5 Step 4) · the cure is measured against the disease so we don't trade a slow read for a heavy write (T5 Step 5). Covered.

**Placeholder scan:** every task names exact files, the table schema is specified, and each proof states a number to beat (< 300 ms, one compute for 20 concurrent requests).

**Type consistency:** `stats_summary.payload` holds the same object the hero already consumes (`histogram`, `thresholdPct`, `onePercentPasses`, `medianRatioPct`, `rentCalcPending`, `medianRent`), so `computeStatsPayload()`'s return type is the single shared contract across worker, table, and both routes; `cachedSWR` is additive and leaves `cached()` untouched.
