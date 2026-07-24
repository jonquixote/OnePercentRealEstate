# DB & Backend Performance Foundation — Measure, Prune, Pool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 19GB Postgres is healthy (no bloat, autovacuum working, 14/120 connections) but flying blind and carrying dead weight: `pg_stat_statements` is installed yet nobody reads it, ~900MB of large indexes show zero scans (real audit needs a time window, not a post-reboot snapshot), an 859MB `rent_predictions_audit_old` table is pure cruft, and PgBouncer — which the OOM-hardening comment explicitly assumes handles pooling — is not running, so every app/worker connection hits Postgres directly against a freshly-lowered `max_connections=100`. This plan turns on measurement, prunes what's dead, and adds the pooling the memory model depends on — the foundation the next round of query work stands on.

**Architecture:** Expose `pg_stat_statements` through a small admin-gated endpoint + a weekly snapshot so slow queries are visible and tracked over time (never on a single reboot's stats). Establish an index-usage measurement window, then drop the confirmed-unused non-constraint indexes and add any the slow-query data proves missing. Retire the `_old` audit table and formalize partition retention through the existing `oper-audit-rotate` unit. Deploy PgBouncer in transaction mode and point the app + worker pools at `:6432`, keeping direct `:5432` for the few session-level consumers.

**Tech Stack:** Postgres 16, `pg_stat_statements`, PgBouncer, systemd, the app's `@/lib/db` pool + `/etc/oper.env` `DATABASE_URL`. No product-facing app changes.

## Global Constraints

- **Never drop an index/table without a measured window + a backup.** Index-drop candidates require ≥7 days of `pg_stat_user_indexes` accumulation (stats reset on restart — a post-reboot `idx_scan=0` is meaningless); `rent_predictions_audit_old` gets a `pg_dump` to cold storage before `DROP`.
- **Never drop a UNIQUE/PK index** even if unscanned — it enforces integrity (e.g. `listings_addr_type_saletype_uniq`, `uq_mv_cluster_tiles_zoom_xy`). Only redundant secondary indexes are candidates.
- **PgBouncer in transaction mode** — the app must not rely on session state (prepared statements across calls, `SET` that outlives a query). Audit for session dependence before cutover; session-scoped consumers keep `:5432`.
- **`max_connections=100` (set by harden-memory) stays** — PgBouncer's whole point is to multiplex many client conns onto few server conns.
- **Admin surfaces stay gated** — the pg_stat_statements endpoint requires the existing `ADMIN_API_KEY` (like `/api/admin/*`), never public.
- **Reversible:** every drop has a recorded recreate DDL; PgBouncer cutover is a one-line `DATABASE_URL` revert.
- **Tests:** shell/SQL verification behavioral; the one endpoint gets a Vitest route test.

## Current State (verified 2026-07-24 on prod `209.50.61.64`)

- DB 19GB: `listings` 11GB, `rental_listings` 1.8GB, `parcels` 1GB, `census_tracts` 894MB, **`rent_predictions_audit_old` 859MB (cruft)**, `rent_predictions_audit_p2026_07` 824MB (live partition).
- Connections: 14 total (1 active / 8 idle) — no pressure today, but `max_connections` was just lowered to 100 and workers/app open direct connections.
- `pg_stat_statements` extension **installed**, unused. `pgbouncer` **inactive**, `:6432` not listening.
- Large zero-scan indexes (post-reboot snapshot — NOT yet proof of unused): `idx_listings_type_sale_price_geom` 159MB, `idx_mv_cluster_tiles_zoom_geom` 158MB, `idx_parcels_addr` 151MB, `idx_listings_lat_lon` 143MB (+ two UNIQUE, keep).
- `oper-audit-rotate` unit exists (partition archive + drop >90d) per the unit list.
- `work_mem=32MB`, `shared_buffers=2GB` (harden-memory, live).

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/app/api/admin/db-stats/route.ts` (create) | ADMIN_API_KEY-gated: top pg_stat_statements by total/mean time + index-usage snapshot. |
| `ops/monitoring/pg-stat-snapshot.sh` + `oper-pg-stat.timer` (create) | Weekly append of pg_stat_statements + index scans to a stats table for trend. |
| `infrastructure/migrations/out-of-band/2026_07_25_drop_audit_old.sql` (create) | Backup-then-drop `rent_predictions_audit_old`. |
| `infrastructure/migrations/out-of-band/2026_07_25_drop_unused_indexes.sql` (create, executed AFTER the window) | DROP the confirmed-unused non-constraint indexes, with recreate DDL in comments. |
| `ops/pgbouncer/pgbouncer.ini` + `userlist.txt` template + `ops/systemd/oper-pgbouncer.service` (create) | Transaction-mode pooler on :6432. |
| `ops/systemd/gen-env.sh` (modify) | App/worker `DATABASE_URL` → `:6432`; a `DATABASE_URL_DIRECT` → `:5432` for session consumers + migrations. |
| `documentation/operations/db-performance.md` (create) | The measurement protocol, drop log, PgBouncer runbook. |

---

## Task 1: Turn on query visibility

**Files:** create `apps/one/src/app/api/admin/db-stats/route.ts` (+ test).

- [ ] **Step 1: Failing test** — the route 401s without the admin key, and with it returns `{ topByTotalTime: [...], topByMeanTime: [...], indexUsage: [...] }` (mock the pool); each slow-query row carries `query`, `calls`, `mean_exec_time`, `total_exec_time`.
- [ ] **Step 2: RED → implement.** Gate on `ADMIN_API_KEY` (mirror `/api/admin/*`); query `pg_stat_statements` ordered by `total_exec_time` and `mean_exec_time` (top 20 each), plus `pg_stat_user_indexes` (scans + size). Read-only.
- [ ] **Step 3:** Reset the baseline once (`SELECT pg_stat_statements_reset()`), note the timestamp. Suite + typecheck; commit — `feat(admin): db-stats endpoint surfaces pg_stat_statements + index usage`

## Task 2: Weekly stats trend (so audits use a window)

**Files:** create `ops/monitoring/pg-stat-snapshot.sh`, `ops/systemd/oper-pg-stat.service` + `.timer`.

- [ ] **Step 1:** Script appends, to a `perf_index_scan_history(captured_at, indexrelname, idx_scan, size_bytes)` table, the current `pg_stat_user_indexes` counters; likewise a `perf_statement_history` top-N from pg_stat_statements. Idempotent table creation.
- [ ] **Step 2:** `.timer` weekly; installed via the deploy unit list.
- [ ] **Step 3: Verify** — a manual run inserts a snapshot row-set; document that index-drop decisions read the DELTA across ≥2 weekly snapshots (never a single reading). Commit — `feat(monitoring): weekly pg index/statement snapshots for time-windowed audits`

## Task 3: Prune the audit cruft

**Files:** create `infrastructure/migrations/out-of-band/2026_07_25_drop_audit_old.sql`.

- [ ] **Step 1:** `pg_dump -Fc -t rent_predictions_audit_old` to `/opt/onepercent/backups/` (859MB cold copy) BEFORE any drop; verify the dump restores to a scratch schema + row count matches.
- [ ] **Step 2:** `DROP TABLE rent_predictions_audit_old;` (out-of-band, run by hand). Confirm no code/view references it first (`grep -r rent_predictions_audit_old`).
- [ ] **Step 3:** Confirm `oper-audit-rotate` actually drops partitions >90d (read its script; if it's inert, fix it so `rent_predictions_audit_p*` don't accumulate 800MB/month). Commit — `chore(db): drop rent_predictions_audit_old (backed up) + verify partition retention`

## Task 4: Index audit + drop (AFTER the Task 2 window)

**Files:** create `infrastructure/migrations/out-of-band/2026_07_25_drop_unused_indexes.sql`.

- [ ] **Step 1:** After ≥7 days of Task 2 snapshots, list non-constraint indexes with `idx_scan` delta == 0 across the window AND size > 50MB. Cross-check none are used by the planner for a known hot query (`EXPLAIN` the top pg_stat_statements entries).
- [ ] **Step 2:** `DROP INDEX CONCURRENTLY` each confirmed-unused index; keep the recreate DDL in a comment header (reversible). Never touch UNIQUE/PK.
- [ ] **Step 3:** Conversely, for any top-slow query doing a seq scan, add the missing index (`CREATE INDEX CONCURRENTLY`). Verify with `EXPLAIN (ANALYZE)` before/after. Commit — `perf(db): drop measured-unused indexes, add indexes for top slow queries`

## Task 5: PgBouncer connection pooling

**Files:** create `ops/pgbouncer/pgbouncer.ini`, `ops/systemd/oper-pgbouncer.service`; modify `ops/systemd/gen-env.sh`.

- [ ] **Step 1: Audit session dependence** — grep the app + workers for cross-call prepared statements / `SET`/`LISTEN`/advisory locks that outlive a single query; list any consumer that must keep a direct `:5432` session.
- [ ] **Step 2:** `pgbouncer.ini` transaction mode, `default_pool_size` sized to `max_connections` headroom, auth via a dedicated `pgbouncer` role; `oper-pgbouncer.service` on `:6432` with a MemoryMax cap (consistency with the OOM plan).
- [ ] **Step 3:** `gen-env.sh` sets the app/worker `DATABASE_URL` to `:6432`, adds `DATABASE_URL_DIRECT=:5432` for migrations + any session consumer from Step 1. Deploy; restart app+workers.
- [ ] **Step 4: Verify** — `SHOW POOLS` in pgbouncer shows the app multiplexing; `pg_stat_activity` server-conn count drops well below client count; app health + a search + a property page all 200. Rollback path = one-line `DATABASE_URL` revert. Commit — `feat(infra): PgBouncer transaction pooling on :6432 (the pooling harden-memory assumes)`

## Task 6: Document + baseline

- [ ] `db-performance.md`: the measurement protocol, the drop log (with recreate DDL), the PgBouncer runbook + rollback, and a "before" baseline (DB size, top-10 slow queries, server-conn count) so the next query-optimization plan has a yardstick. Commit — `docs(db): performance foundation baseline + runbooks`

## Self-Review

**Spec coverage:** slow queries become visible + tracked over time (T1, T2) · dead weight pruned safely with backups + windowed evidence (T3, T4) · the pooling the memory model assumes is real (T5) · a documented baseline for the next round (T6). Every destructive step is windowed + reversible. Covered.

**Placeholder scan:** each task names exact files/SQL and a behavioral verification; the two drops are explicitly gated on a measurement window + backup, not a snapshot.

**Type consistency:** the db-stats route returns one `{ topByTotalTime, topByMeanTime, indexUsage }` shape (T1) mirrored by the snapshot tables (T2); `DATABASE_URL` (pooled) vs `DATABASE_URL_DIRECT` (session) is the one naming split introduced (T5), consumed by gen-env + migrations.
