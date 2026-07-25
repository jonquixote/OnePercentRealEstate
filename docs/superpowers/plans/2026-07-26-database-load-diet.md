# Database Load Diet — Stop Background Jobs From Eating the Database

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Over the last 25 hours of production, **6.9 hours of database time — about 27% of wall-clock — was spent on a single monitoring query**: the Prometheus postgres-exporter running `SELECT rent_calc_status, COUNT(*) FROM listings GROUP BY rent_calc_status`, a full scan of 1.3 M rows, **3 006 times at 8.2 s each**. Nothing user-facing needed any of it. Add the materialized-view refreshes (26 s and 31 s a pop, every 10 minutes) and a health probe I added that costs 9.3 s per run, and a large share of this database's capacity is consumed by jobs watching and maintaining it rather than serving anyone. That background load is also what makes cold user paths slow and pushed the box toward its OOM. This plan puts the background work on a diet, with a measured budget.

**Architecture:** Replace exact full-table counts in monitoring with cheap equivalents — `pg_class.reltuples` estimates for totals, and a small incrementally-maintained counter (or a partial-index-backed query) for the status breakdown — so a metrics scrape costs microseconds instead of seconds. Slow the exporter's scrape interval for expensive collectors. Make the freshness probe use an index-friendly predicate instead of `max()` over the whole table. Re-tune the MV refresh cadence to what the product actually needs, and confirm each refresh is incremental-friendly. Finally, add a standing **load budget** check so a future collector cannot quietly consume the database again.

**Tech Stack:** Postgres 16 (`pg_stat_statements`, `pg_class`), `infrastructure/monitoring/postgres-exporter/queries.yml`, `ops/monitoring/*`, `apps/worker` refresh loop.

## Global Constraints

- **Monitoring must stay meaningful.** Cheaper metrics may lose exactness but must preserve the *signal* — e.g. "is the rent-calc backlog growing?" must still be answerable. An estimate that moves correctly is fine; a metric that goes silent is not.
- **Measure before and after, from `pg_stat_statements`.** Every task states the total-time it removed. No change ships on intuition.
- **Do not weaken the productivity alerts** built after the 10-hour silent crawl outage (freshness/throughput/backlog/endpoint health). Make them cheap, never absent.
- **No user-facing behavior change.** This is background work only; the app's queries are out of scope (see the companion plan `2026-07-26-instant-numbers.md`).
- **Reversible:** each collector change is a config edit with the original recorded in the commit.
- **Never `DROP` an index or MV as part of this plan** — that is gated on the separate ≥7-day measurement window (`db-performance.md` §5).
- **Tests:** shell/SQL behavioral; `ops/ci/ops-lint.sh` for script changes.

## Current State (measured 2026-07-25, `pg_stat_statements` since 2026-07-24 04:49)

| Query | Calls | Mean | **Total** |
|---|---|---|---|
| `GROUP BY rent_calc_status` (exporter) | 3 006 | 8 239 ms | **24 766 s ≈ 6.9 h** |
| `REFRESH MATERIALIZED VIEW mv_market_grid` | 51 | 25 865 ms | 1 319 s |
| `REFRESH MATERIALIZED VIEW mv_cluster_tiles` | 41 | 31 052 ms | 1 273 s |
| ZIP-ranking `SELECT zip_code … GROUP BY` | 25 | 21 021 ms | 526 s |
| `COUNT(*) FROM listings` (exporter) | 3 004 | 166 ms | 498 s |
| `max(last_seen_at)` freshness probe | 44 | 9 320 ms | 399 s |

- Definitions live in `infrastructure/monitoring/postgres-exporter/queries.yml` (`rent_calc_status`, `listings_total`). The stack runs in Docker (`infrastructure-prometheus-1`, `-grafana-1`, `-alertmanager-1`), up 25 h.
- `listings` ≈ 1.3 M rows / 11 GB. `CLUSTER_REFRESH_INTERVAL_MS=600000` (10 min).
- `idx_listings_last_seen` exists but is **partial** (`listing_type='for_sale' AND listing_status IN ('active','pending_verify')`), so a bare `max(last_seen_at)` over the whole table cannot use it — hence 9.3 s.
- Postgres is memory-tuned (`work_mem=32MB`, `shared_buffers=2GB`) after the OOM; this background load competes directly with that budget.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/monitoring/postgres-exporter/queries.yml` (modify) | Cheap collectors + per-collector cache/interval. |
| `infrastructure/migrations/2026_07_26_listing_status_counters.sql` (create) | Counter table (+ trigger or worker upsert) for status breakdown. |
| `ops/monitoring/crawl-health.sh` (modify) | Index-friendly freshness predicate. |
| `apps/worker/src/index.ts` (modify) | MV refresh cadence from env; log each refresh duration. |
| `ops/monitoring/db-load-budget.sh` (create) + timer | Alerts when any single query exceeds a share of total DB time. |
| `documentation/operations/db-performance.md` (modify) | Record the before/after budget. |

---

## Task 1: Make the exporter cheap (the 6.9-hour win)

- [ ] **Step 1: Baseline** — record current totals for the two exporter queries from `pg_stat_statements`, then `SELECT pg_stat_statements_reset()` so the after-measurement is clean.
- [ ] **Step 2: `listings_total` → estimate.** Replace `COUNT(*)` with `SELECT reltuples::float FROM pg_class WHERE relname='listings'` (sub-millisecond). Document in the YAML that it is an estimate; the metric is used for trend, not billing.
- [ ] **Step 3: `rent_calc_status` → counter table.** Add `listing_status_counters(status text primary key, count bigint, updated_at timestamptz)`, maintained by the worker on a bounded interval (a single `GROUP BY` every N minutes instead of every scrape) — or by trigger if measurement shows the write cost is negligible. The exporter then selects from a 3-row table.
- [ ] **Step 4: Cache/slow the collector** — set the exporter's per-collector cache/scrape interval so even the cheap queries do not run every few seconds.
- [ ] **Step 5: Prove it** — after ≥1 hour, `pg_stat_statements` shows these collectors with a **total time under 1% of the previous 24 766 s**, and Grafana still plots the same series. Commit — `perf(monitoring): exporter uses estimates + counter table (was 27% of DB time)`

## Task 2: Fix the freshness probe I made expensive

- [ ] **Step 1: Failing check** — the crawl-freshness probe currently runs `max(last_seen_at)` over all 1.3 M rows (9.3 s). Rewrite it to match the partial index: bound it to `listing_type='for_sale' AND listing_status IN ('active','pending_verify')` **and** add an upper time bound so the planner can use `idx_listings_last_seen` (e.g. an existence check against `now() - threshold` rather than a global `max()`).
- [ ] **Step 2: Verify with `EXPLAIN (ANALYZE)`** that the plan is an index scan and the runtime is **< 50 ms**, and that the probe still fires correctly (temporarily set the threshold to force an alert, confirm Telegram, then restore — the alert must behave exactly as before).
- [ ] **Step 3:** Commit — `perf(monitoring): crawl-freshness probe uses the partial index (9.3s → <50ms)`

## Task 3: Right-size the materialized-view refreshes

- [ ] **Step 1: Measure need, not habit.** `mv_market_grid` (26 s) and `mv_cluster_tiles` (31 s) refresh every 10 minutes = ~2 592 s/day of pure write load. Determine the actual freshness requirement of the surfaces they feed (map clusters / market grid) and set `CLUSTER_REFRESH_INTERVAL_MS` accordingly; make each MV's interval independently configurable.
- [ ] **Step 2:** Log every refresh with its duration and row delta so the cost stays visible, and skip a refresh when the underlying data has not changed since the last one (cheap watermark check) — a no-op refresh is pure waste.
- [ ] **Step 3: Verify** the map/market surfaces still look correct at the new cadence (browser check, not just SQL), and record the reclaimed time. Commit — `perf(db): right-size MV refresh cadence + skip no-op refreshes`

## Task 4: A standing load budget

- [ ] **Step 1: `db-load-budget.sh`** (hourly timer): reads `pg_stat_statements`, and alerts via the existing Telegram path when any single normalized query exceeds a configurable share of total execution time in the window (default 10%), naming the query. This is the control that would have caught the exporter on day one.
- [ ] **Step 2:** Include a small `top 5 by total_exec_time` summary in the alert so the responder has context immediately.
- [ ] **Step 3: Prove it** — temporarily set the threshold very low so a benign query trips it, confirm the Telegram message names the query, then restore. Commit — `feat(monitoring): DB load-budget alert (no query may silently eat the database)`

## Task 5: Record the budget

- [ ] **Step 1:** In `db-performance.md`, record before/after: total DB time per hour, the top-5 table, and the reclaimed capacity. State the rule going forward: **a metrics collector may not run an unbounded aggregate against `listings`.**
- [ ] **Step 2:** Cross-link from `docs/HANDOFF.md` §10 and mark the "Monitoring eats the DB" issue resolved with its measured number. Commit — `docs(db): load budget before/after + collector rule`

## Self-Review

**Spec coverage:** the 6.9-hour exporter cost is removed while keeping the signal (T1) · the probe I made expensive is made index-friendly without weakening the alert (T2) · MV refreshes are sized to real need and stop running as no-ops (T3) · a standing budget alert prevents recurrence (T4) · the result is written down with numbers (T5). Covered.

**Placeholder scan:** every task carries a measured baseline and a numeric target (<1% of 24 766 s, <50 ms, alert-on-10%-share); no "optimize the queries" hand-waving. The one judgement call (MV cadence) is explicitly framed as "measure need, not habit" with a browser verification.

**Type consistency:** `listing_status_counters(status, count, updated_at)` is the single new contract, written by the worker and read by the exporter; the freshness probe keeps its existing alert key (`crawl-freshness`) so dedup/RESOLVED behavior is unchanged.
