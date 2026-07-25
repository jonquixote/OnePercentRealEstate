# Latency Observability — Stop Finding Slow Paths by Archaeology

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every performance problem fixed in the last two days was found by hand, after a human noticed: the homepage hero at **18.5 s**, market pages at **10.4 s each**, a monitoring query eating **79% of all database time**, a health probe costing **8.4 s a run**. In each case the evidence was already there — the app even logs `[SLOW QUERY] 9985ms` — but nothing watched it, so the only detection mechanism was somebody complaining. That does not scale, and the next regression will be found the same way unless we fix the detection, not just the symptoms. This plan makes slowness *page us* the way the crawl outage now does.

**Architecture:** Three layers, each cheap. (1) A tiny per-request timing wrapper records duration by route into a bounded in-memory ring plus a rolling Postgres table, exposed through an admin-gated `/api/admin/perf` returning p50/p95/p99 and slowest routes. (2) The existing `[SLOW QUERY]` logger — currently write-only — gets a threshold, a dedup key, and a Telegram alert, so a single request that crosses a budget is reported with its query. (3) A `perf-budget` probe on the existing 10-minute timer alerts when any route's p95 exceeds its declared budget, reusing `notify-telegram.sh` and the alert-key/RESOLVED conventions already in place.

**Tech Stack:** Next 16 route instrumentation (`apps/one`), the existing `withSpan`/tracing helper, Postgres, `ops/monitoring/*` timers, Telegram via `notify-telegram.sh`.

## Global Constraints

- **Observability must not become the load problem it detects.** This is not hypothetical: the postgres-exporter's metric collection consumed 79% of the database, and the crawl-freshness probe I wrote cost 8.4 s per run. Every write here is bounded (ring buffer + periodic flush, never a row per request) and every probe query must be index-backed and verified with `EXPLAIN`.
- **Budgets are declared, not inferred.** Each instrumented route gets an explicit p95 budget in one table (e.g. hero APIs 300 ms, market/property pages 1 s, search 1.5 s). An alert means "we broke a promise we wrote down".
- **No PII in perf data** — record route patterns (`/market/[zip]`), never resolved URLs with user identifiers, and never query parameters.
- **Alerts must survive the "idle system" trap**: a percentage or a single sample is not a signal. Require a minimum sample count in the window before alerting (the load-budget alert needed an absolute floor for exactly this reason).
- **Admin surfaces stay gated** (`ADMIN_API_KEY`), consistent with `/api/admin/*`.
- **Tests:** `pnpm --filter @oper/one test`; probe scripts pass `ops/ci/ops-lint.sh`.

## Current State (verified 2026-07-27)

- The app already logs `[SLOW QUERY] <ms>: <sql>` — that line is how the market-page culprit was finally identified — but **nothing consumes it**. A 6-hour journal sample shows a recurring family: the ZIP ranking (now fixed), walkability/schools/NRI enrichment joins, and a `raw_data->>'city'` lookup.
- `withSpan()` exists and wraps some handlers (`home.stats`), but its output is not aggregated anywhere.
- Monitoring today covers **infrastructure** (`oper-healthcheck`: mem/disk/units/HTTP-up) and **crawl productivity** (`oper-crawl-health`: freshness/throughput/backlog/endpoints) and **DB load** (`oper-db-load-budget`, hourly, delta-based with an absolute floor). There is **no user-latency signal at all**.
- `pg_stat_statements` is enabled with weekly snapshots (`oper-pg-stat.timer`) — good for *database* time, blind to time spent rendering.
- Known remaining smell to fold in: 5 call sites read `raw_data->>'city'/'state'` although `listings` has **native `city` and `state` columns**, which prevents index use and is fragile.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/perf-track.ts` (create) | Bounded in-memory ring + `trackRoute(route, ms)`; percentile helpers. |
| `apps/one/src/lib/perf-flush.ts` (create) | Periodic bounded flush into `route_latency_samples`. |
| `infrastructure/migrations/2026_07_28_route_latency.sql` (create) | Rolling samples table + retention. |
| `apps/one/src/app/api/admin/perf/route.ts` (create) | ADMIN-gated p50/p95/p99 by route + slowest recent requests. |
| `apps/one/src/lib/db.ts` (modify) | `[SLOW QUERY]` gains a threshold + Telegram hook (fire-and-forget). |
| `ops/monitoring/perf-budget.sh` (create) + timer | Alerts when a route's p95 breaks its declared budget. |
| `documentation/operations/perf-budgets.md` (create) | The budget table and what each alert means. |

---

## Task 1: Per-route timing, bounded

- [ ] **Step 1: Failing tests** — `trackRoute()` keeps at most N samples per route (assert the ring never grows past the cap under 10k pushes); `percentiles()` returns correct p50/p95/p99 for a known distribution; unknown routes are created lazily; recording is O(1) and never throws.
- [ ] **Step 2: RED → implement** `perf-track.ts` with a fixed-size ring per route pattern. **No allocation per request beyond the sample**, no unbounded Map growth (cap distinct routes and fold the rest into `other`).
- [ ] **Step 3: Wire it** into the handful of routes that matter (hero APIs, market page, property page, search) via the existing `withSpan` so instrumentation lives in one place.
- [ ] **Step 4:** Suite + typecheck; commit — `feat(perf): bounded per-route latency tracking`

## Task 2: Surface it

- [ ] **Step 1: Migration** — `route_latency_samples(captured_at, route, p50_ms, p95_ms, p99_ms, count)`; retention deletes rows older than 30 days.
- [ ] **Step 2:** Periodic flush (every 5 min) writes **one aggregated row per route**, never per request — the bounded-write rule.
- [ ] **Step 3: Failing test** for `/api/admin/perf`: 401 without the key; with it returns per-route p50/p95/p99 and sample counts; includes the trailing window from the table so the view survives a restart.
- [ ] **Step 4:** Commit — `feat(perf): route_latency_samples + admin perf endpoint`

## Task 3: Make `[SLOW QUERY]` actually alert

- [ ] **Step 1:** Give the existing logger a configurable threshold (`SLOW_QUERY_MS`, default 1000) and a **dedup key derived from the normalized SQL** so one pathological query does not spam.
- [ ] **Step 2:** On breach, fire-and-forget a Telegram alert with the duration and the first ~200 chars of the query. It must **never** block or fail the request (the notifier is best-effort everywhere else too).
- [ ] **Step 3: Prove it** — run a deliberately slow query (`SELECT pg_sleep(2)`) through the pool and confirm exactly one Telegram alert with the duration; repeat immediately and confirm dedup suppresses it.
- [ ] **Step 4:** Commit — `feat(perf): slow queries alert instead of scrolling past in the journal`

## Task 4: Declared budgets + the probe

- [ ] **Step 1:** Write the budget table in `perf-budgets.md`: hero APIs **300 ms**, `/market/[zip]` and `/property/[id]` **1 s**, `/search` **1.5 s**, sitemap **45 s** (cold generation). Each entry cites the measured current value so drift is obvious.
- [ ] **Step 2:** `perf-budget.sh` on the 10-minute timer reads `/api/admin/perf`, compares p95 to the budget, and alerts (keyed per route, with RESOLVED). **Requires ≥20 samples** in the window before alerting — a single slow request is not a trend.
- [ ] **Step 3: Prove it** — temporarily set one route's budget to 1 ms, confirm the alert names that route and its p95, restore, confirm RESOLVED.
- [ ] **Step 4:** Commit — `feat(perf): p95 budget alerts per route`

## Task 5: Clear the known smells + deploy proof

- [ ] **Step 1:** Replace the 5 `raw_data->>'city'/'state'` reads with the native `city`/`state` columns; verify identical output on a sample of ZIPs (some rows may have one and not the other — check before assuming).
- [ ] **Step 2:** Deploy; confirm `/api/admin/perf` reports real traffic and that the numbers match hand-timed `curl` for two routes.
- [ ] **Step 3: Regression guard** — assert the tracking itself costs nothing measurable: hand-time a route before/after instrumentation; the difference must be within noise. Also confirm `db-load-budget.sh` does not newly flag the flush.
- [ ] **Step 4:** Update `docs/HANDOFF.md` §7 with the new signal. Commit — `docs(perf): latency budgets + what to do when one breaks`

## Self-Review

**Spec coverage:** the detection gap that made every recent fix reactive is closed at three levels — per-route p95, per-query slowness, and declared budgets (T1–T4) · the observability is explicitly prevented from becoming the load problem it hunts (constraints, T5 Step 3) · alerts avoid the idle-system false-positive trap with a minimum sample count (T4) · the known `raw_data` smell is cleared while we are in there (T5). Covered.

**Placeholder scan:** every task names files, thresholds, and a proof that *causes* the alert; budgets are concrete numbers tied to measured values, not "reasonable defaults".

**Type consistency:** `trackRoute(route, ms)` and `percentiles()` are the only new runtime contracts; `route_latency_samples` mirrors what `/api/admin/perf` returns, so the endpoint, the table, and the probe share one shape.
