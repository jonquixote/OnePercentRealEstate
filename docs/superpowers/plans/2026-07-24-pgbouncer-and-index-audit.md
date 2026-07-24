# Finish PgBouncer + Execute the Index Audit (backend/db)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The DB & Backend Performance plan shipped the *pieces* of PgBouncer (config, service unit, userlist generator) and pre-flipped the `DATABASE_URL` cutover to `:6432` — but PgBouncer was never actually started, so the app connected to a dead port and went **db-down on prod** (health 503, empty sitemap) until the cutover was reverted to `:5432`. Today the pooler exists as dangerous dead weight: `oper-pgbouncer` inactive, config present, cutover reverted. This plan finishes it *safely* — deploy PgBouncer, prove it pools, and only then flip the cutover behind a verify — and executes the deferred index audit (the weekly `pg_stat` snapshots need a real window before any DROP). Outcome: connection pooling actually works, the half-state is resolved, and the ~900MB of maybe-unused indexes are decided on evidence.

**Architecture:** Bring `oper-pgbouncer` up on `:6432` in transaction mode with a dedicated least-privilege auth path (SCRAM/md5 via a generated userlist), verify it multiplexes real traffic, then move `DATABASE_URL` to `:6432` **only after** a health gate confirms the app connects through it — with the one-line `:5432` revert as the rollback. Session-scoped consumers (crawl advisory locks, LISTEN, migrations) stay on `DATABASE_URL_DIRECT=:5432`. Separately, enable the `oper-pg-stat` weekly snapshot timer, let it accumulate ≥7 days, then drop the indexes proven unused across the window (never a single reading — `idx_scan` resets on restart) and add indexes for the top `pg_stat_statements` seq-scanners (the 18s sitemap sort is a prime candidate).

**Tech Stack:** PgBouncer, Postgres 16, systemd, the app/worker `@/lib/db` pools, `gen-env.sh`, `pg_stat_statements`. No product-facing app changes.

## Global Constraints

- **The cutover is health-gated, not blind.** `DATABASE_URL` moves to `:6432` only inside a step that (a) confirms PgBouncer is `active` + listening, (b) confirms a query succeeds through `:6432`, and (c) leaves the `:5432` revert one `sed` away. The 2026-07-24 outage was exactly a blind cutover.
- **Never drop an index without a ≥7-day usage window + a recorded recreate DDL + a backup of the DDL.** `idx_scan=0` on a freshly-booted box is meaningless.
- **Never drop a UNIQUE/PK index** (integrity), even if unscanned.
- **Transaction pooling forbids cross-statement session state** — the Task 1 audit must confirm no app path relies on it before cutover; anything that does keeps `:5432`.
- **PgBouncer auth uses a dedicated role**, not the superuser, and the userlist file is root-only (0600), never in git (only `.example`).
- **Reversible + observable:** every step verifies behaviorally (SHOW POOLS, health, server-conn count) and states its rollback.
- **Tests:** SQL/shell behavioral; the deploy smoke gate must include a PgBouncer-reachability check once cutover lands.

## Current State (verified 2026-07-24 on prod `209.50.61.64`)

- `oper-pgbouncer.service` + `ops/pgbouncer/pgbouncer.ini` (transaction mode, `listen_port=6432`, `default_pool_size=20`, `max_client_conn=200`, `auth_type=md5`) + `ops/pgbouncer/gen-pgbouncer-userlist.sh` exist. **`oper-pgbouncer` is inactive; `:6432` not listening.**
- `gen-env.sh` reverted: `DATABASE_URL=:5432`, `DATABASE_URL_DIRECT=:5432` (both direct) after the outage. Workers already read `DATABASE_URL_DIRECT` for session-scoped work (crawl/rent-estimator).
- `pg_stat_statements` installed; `oper-pg-stat.timer` + `pg-stat-snapshot.sh` exist but the **timer is not enabled** (shows ○). No windowed index data yet.
- `max_connections=100`, `work_mem=32MB` (harden-memory). Current app+worker direct connections ~14 — no pressure yet, but no pooling either.
- Large zero-scan indexes (need a window): `idx_listings_type_sale_price_geom` 159MB, `idx_mv_cluster_tiles_zoom_geom` 158MB, `idx_parcels_addr` 151MB, `idx_listings_lat_lon` 143MB.
- The sitemap's property sort (10k, ORDER BY ratio/last_seen over ~450k rows) takes ~18s cold — a candidate for a supporting index.

## File Structure

| File | Responsibility |
|---|---|
| `ops/pgbouncer/setup-pgbouncer.sh` (create) | Idempotent: create the `pgbouncer` auth role, generate userlist, install/start the service, verify. |
| `ops/pgbouncer/pgbouncer.ini` (modify if needed) | Confirm pool sizes vs `max_connections=100`; `auth_query` or static userlist. |
| `ops/systemd/gen-env.sh` (modify) | Cutover: `DATABASE_URL` → `:6432` (gated); keep `DATABASE_URL_DIRECT=:5432`. |
| `ops/systemd/deploy-systemd.sh` (modify) | Smoke gate gains a PgBouncer `SHOW POOLS` reachability check (only when cutover is on). |
| `infrastructure/migrations/out-of-band/2026_08_XX_index_audit.sql` (create, executed AFTER the window) | DROP measured-unused indexes + ADD sitemap/hot-query indexes, with recreate DDL. |
| `documentation/operations/db-performance.md` (modify) | PgBouncer runbook (setup, cutover, rollback), the index-audit decision log. |

---

## Task 1: Session-dependence audit (gate for transaction pooling)

- [ ] **Step 1:** Grep app + workers for cross-statement session state: multi-call prepared statements, `SET`/`SET LOCAL` outliving a query, `LISTEN`/`NOTIFY`, `pg_advisory_lock` held across calls, `SELECT ... FOR UPDATE` spanning round-trips. Crawl uses advisory locks → already on `DATABASE_URL_DIRECT`; confirm nothing else does.
- [ ] **Step 2:** Write the finding into `db-performance.md`: the definitive list of `:5432`-direct consumers vs `:6432`-poolable. If any app (not worker) path needs session state, it stays direct.
- [ ] **Step 3:** Commit — `docs(db): session-dependence audit — what can move behind PgBouncer transaction pooling`

## Task 2: Bring PgBouncer up (no cutover yet)

**Files:** create `ops/pgbouncer/setup-pgbouncer.sh`.

- [ ] **Step 1:** Idempotent script: create a `pgbouncer` login role (dedicated, not superuser) with a generated password stored root-only; generate `/etc/pgbouncer/userlist.txt` (0600) via the existing generator; install `pgbouncer.ini` to `/etc/pgbouncer/`; `systemctl enable --now oper-pgbouncer`.
- [ ] **Step 2: Verify PgBouncer works WITHOUT touching the app** — connect a test client to `:6432` (`psql "postgresql://postgres:…@localhost:6432/postgres" -c "SELECT 1"`), then `psql -p 6432 pgbouncer -c "SHOW POOLS"` shows the admin console. Confirm `max_connections=100` headroom vs `default_pool_size`.
- [ ] **Step 3:** Add the PgBouncer unit to the deploy `ALL_UNITS` if missing; MemoryMax cap (consistency with harden-memory). Commit — `feat(infra): deploy PgBouncer on :6432 (running + verified, app still on :5432)`

## Task 3: Health-gated cutover

**Files:** modify `ops/systemd/gen-env.sh`, `ops/systemd/deploy-systemd.sh`.

- [ ] **Step 1:** `gen-env.sh`: `DATABASE_URL` → `:6432`; `DATABASE_URL_DIRECT` stays `:5432`; role env files likewise (poolable roles → 6432, keep a direct for migrations).
- [ ] **Step 2:** Deploy-time gate: BEFORE restarting the app onto the new env, assert `systemctl is-active oper-pgbouncer` AND `psql :6432 -c 'SELECT 1'` succeed; if not, abort the cutover and keep `:5432` (fail-safe — the opposite of what broke prod). After restart, the existing smoke `health` check (db:up) confirms the app pools; add a `SHOW POOLS` reachability smoke check.
- [ ] **Step 3: Verify** — `SHOW POOLS` shows app clients multiplexing; `pg_stat_activity` server-conn count stays well under client count under a small load loop; health `db:up`. Rollback documented (one-line `:5432`). Commit — `feat(infra): health-gated DATABASE_URL cutover to PgBouncer (:6432)`

## Task 4: Enable the index/statement measurement window

**Files:** none new — enable `oper-pg-stat.timer`.

- [ ] **Step 1:** `systemctl enable --now oper-pg-stat.timer`; confirm the first snapshot writes to `perf_index_scan_history` / `perf_statement_history`. Reset `pg_stat_statements` once to baseline.
- [ ] **Step 2:** Let it run ≥7 days (this task's DROP step is gated on that). Document the "read the delta across ≥2 weekly snapshots" rule.
- [ ] **Step 3:** Commit — `chore(db): enable weekly pg-stat snapshots (measurement window for the index audit)`

## Task 5: Execute the index audit (AFTER ≥7 days)

**Files:** create `infrastructure/migrations/out-of-band/2026_08_XX_index_audit.sql`.

- [ ] **Step 1:** From the window: list non-constraint indexes with zero `idx_scan` delta across snapshots AND size > 50MB. Cross-check each against `EXPLAIN` of the top pg_stat_statements queries (a rarely-scanned index may still serve a critical rare query).
- [ ] **Step 2:** `DROP INDEX CONCURRENTLY` the confirmed-unused; recreate DDL in the file header (reversible). Never UNIQUE/PK.
- [ ] **Step 3:** Add supporting indexes for the top seq-scanners — notably the sitemap property sort: `CREATE INDEX CONCURRENTLY … ON listings (rent_price_ratio DESC NULLS LAST, last_seen_at DESC) WHERE listing_type='for_sale' AND listing_status NOT IN ('sold','stale','rental_misfiled')` — verify the 18s cold sitemap drops with `EXPLAIN (ANALYZE)` before/after.
- [ ] **Step 4:** Commit — `perf(db): drop measured-unused indexes, add sitemap/hot-query supporting indexes`

## Self-Review

**Spec coverage:** the dangerous PgBouncer half-state is resolved — pooling actually runs and the cutover is health-gated so it can't repeat the outage (T1–T3) · the index audit runs on real evidence, not a snapshot, and speeds the known-slow sitemap sort (T4, T5). Every mutation is reversible + verified. Covered.

**Placeholder scan:** the cutover is explicitly gated on a live PgBouncer check (the fix for the exact 2026-07-24 failure); the index DROP is gated on a ≥7-day window; the `2026_08_XX` migration date is intentionally deferred to execution.

**Type consistency:** `DATABASE_URL` (pooled `:6432`) vs `DATABASE_URL_DIRECT` (`:5432`) is the one env split, consumed by app + workers + migrations; the pgbouncer role/userlist are the auth identifiers, defined once in setup.
