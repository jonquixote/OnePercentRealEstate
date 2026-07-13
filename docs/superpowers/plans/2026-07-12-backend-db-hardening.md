# Backend & Database Hardening — Performance, Security Posture, Code Health

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend measurable, fast, and least-privilege: query observability (pg_stat_statements), index/bloat/archive discipline on an 11GB database heading for 50GB, API rate limiting and input validation at every boundary, non-superuser DB roles per service, Postgres tuned for the actual box, and the 597-line `actions.ts` god-file split into testable query modules.

**Architecture:** Measurement first (you cannot tune what you cannot see), then the storage fixes the measurements justify, then API hardening, then code health. Every DB change follows the house discipline: txn-safe migrations in `infrastructure/migrations/`, wholesale writes out-of-band with keyset batches, never touch `listings.updated_at`.

**Tech Stack:** Postgres 16 + PostGIS (systemd, host-native), pg pool (`apps/one/src/lib/db.ts`, max 50), Redis (cache-version pattern), Next API routes (36), nginx front, Prometheus + postgres-exporter.

## Global Constraints

- **Zero-downtime**: all index builds `CREATE INDEX CONCURRENTLY` (out-of-band dir — concurrent builds can't run in the txn runner); config changes via `ALTER SYSTEM` + reload where possible, one planned restart window for the settings that need it (announce to user first).
- **Measure → change → re-measure**: every performance task records before/after numbers in the commit message. No speculative indexes.
- **Backups are the safety net**: confirm last nightly dump + R2 copy exist before any destructive-class change (`ls /var/backups/oper/ && rclone lsf oper-r2:onepercent-pg-backups | tail -1`).
- **Secrets discipline**: new DB role passwords go into `/opt/onepercent/.env` → `gen-env.sh` regenerates `/etc/oper.env` (deny-list passthrough carries them); never echo values.
- **The rent worker + ML service are consumers of these tables** — any schema change greps `services/` and `apps/worker/src/` for the touched columns first.

## Current-state findings (measured 2026-07-12)

| Finding | Number | Implication |
|---|---|---|
| `listings` | 5.5GB, 1.0M rows, 96K seq scans vs 109K idx scans | full scans on the hot table |
| `rent_predictions_audit` | 859MB, 1.79M rows, **0 index scans ever** | write-only; unbounded growth |
| `mv_cluster_tiles` | 493MB, 180K dead tuples (11%) | refresh pattern bloats; autovacuum losing |
| `listings_history` | 966K rows, growing per price change | no retention policy |
| `pg_stat_statements` | **not enabled** | flying blind on query cost |
| DB connections | app pool max=50 + 6 workers + ML + tileserv | check `max_connections` headroom |
| DB role | every service connects as `postgres` superuser | blast radius = everything |
| API rate limiting | none (nginx or app) | auth + search endpoints open to abuse |
| `actions.ts` | 597 lines, query building + caching + shaping | untestable monolith |
| Postgres config | unaudited (likely near-default) | 15GB box, default shared_buffers=128MB |

---

## Phase O — Observability first

### Task O1: pg_stat_statements + auto_explain

**Files:**
- Create: `ops/systemd/postgres-tuning.md` (running log of every setting change + why)

- [ ] `ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements, auto_explain';` + `pg_stat_statements.track = top`, `auto_explain.log_min_duration = '500ms'`, `auto_explain.log_analyze = off` (on is risky in prod). Requires one restart — coordinate with user, do it inside a quiet window, verify all services reconnect (the 2026-07-09 post-restart checklist: healthz, worker logs, tiles).
- [ ] `CREATE EXTENSION pg_stat_statements;`
- [ ] Add postgres-exporter queries (`infrastructure/monitoring/postgres-exporter/queries.yml`): top-10 by `mean_exec_time`, cache hit ratio, connection count by state, table bloat estimate. Restart exporter; verify series.
- [ ] Acceptance: `SELECT count(*) FROM pg_stat_statements;` > 0 after a day of traffic; Prometheus shows the new series. Commit.

### Task O2: One week of data → triage doc

- [ ] After ≥ 3 days: `SELECT round(mean_exec_time)::int AS ms, calls, rows, left(query, 120) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25;` → write `docs/perf/2026-07-query-triage.md` ranking by total time with a fix hypothesis each (missing index / rewrite / cache / acceptable).
- [ ] The seq-scan hotspots: `SELECT relname, seq_scan, seq_tup_read/GREATEST(seq_scan,1) AS avg_rows_per_scan FROM pg_stat_user_tables WHERE seq_scan > 1000 ORDER BY seq_tup_read DESC;` — any `listings` entry with avg_rows_per_scan > 10K gets a named query hunt (auto_explain log grep).
- [ ] Acceptance: triage doc committed; Phase S tasks reference its line items (S-tasks below list the *expected* fixes — replace/confirm against real data).

---

## Phase S — Storage & query fixes

### Task S1: Index audit driven by O2 (expected candidates, confirm first)

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_XX_indexes.sql`

- [ ] Expected gaps to validate: `listings (listing_type, sale_type, price) WHERE geom IS NOT NULL` for viewport/search paths; `listings (zip_code, created_at)` for saved-search freshness counts (the D3 badge query subselects per row); `rental_listings (source, listing_date)`; partial index for `rent_calc_status = 'pending'` (worker drain). Confirm each against pg_stat_statements + `EXPLAIN (ANALYZE, BUFFERS)`; build `CONCURRENTLY`; drop any indexes with `idx_scan = 0` after the audit (list them: `SELECT indexrelid::regclass, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0 AND NOT indisunique ...`).
- [ ] Acceptance: each new index shows `idx_scan > 0` within a day; before/after `EXPLAIN` timings in the commit. Commit.

### Task S2: `rent_predictions_audit` retention + partitioning

**Files:**
- Create: `infrastructure/migrations/2026_07_XX_audit_partition.sql` + out-of-band migration script

- [ ] 1.79M rows never read. Policy (confirm with user in PR): keep 90 days hot, archive older to a compressed monthly dump in `/var/backups/oper/audit/` (then R2), delete from live. Convert to a native-partitioned table by month (`created_at`) via the standard shadow-table swap: create partitioned `rent_predictions_audit_p`, backfill keyset, rename-swap in one txn, keep old as `_old` for a week. Worker INSERT path unchanged (same columns).
- [ ] Monthly systemd timer: create next partition + archive/drop expired ones (`ops/systemd/oper-audit-rotate.{service,timer}`).
- [ ] Acceptance: table ≤ 90 days of rows; inserts verified from worker logs post-swap; archived month restorable (`pg_restore --list`). Commit.

### Task S3: `mv_cluster_tiles` refresh + autovacuum tuning

- [ ] Find the refresher (`grep -rn "mv_cluster_tiles" apps/ services/ infrastructure/`): switch to `REFRESH MATERIALIZED VIEW CONCURRENTLY` (needs a unique index — add if missing) so reads never block and dead-tuple churn drops.
- [ ] Per-table autovacuum for the churn tables: `ALTER TABLE mv_cluster_tiles SET (autovacuum_vacuum_scale_factor = 0.02);` same for `listings` (0.05) — its 13K dead tuples at 1M rows is fine but the default 0.2 threshold means vacuum at 200K dead.
- [ ] `listings_history` retention decision with user: it feeds price sparklines — likely keep-all but add a yearly compression check (BRIN index on `observed_at` if scans are date-ranged).
- [ ] Acceptance: `n_dead_tup` on mv_cluster_tiles < 5% steady-state a day after; refresh no longer takes an exclusive lock (pg_locks check during refresh). Commit.

### Task S4: Postgres config for the actual box

- [ ] Current settings audit → `ops/systemd/postgres-tuning.md`. On 15GB shared with app+ML (ML spikes to ~2GB during train): `shared_buffers = 2GB`, `effective_cache_size = 8GB`, `work_mem = 32MB`, `maintenance_work_mem = 512MB`, `random_page_cost = 1.1` (SSD), `wal_compression = on`, `max_wal_size = 2GB`. `max_connections`: count actual peak (`SELECT max over a day from the exporter`) — pool 50 + workers ~15 + ml ~5 + tileserv ~4; set 120 and document why.
- [ ] Apply via `ALTER SYSTEM`; restart in the same window as O1 if sequenced together (ONE restart total for this plan).
- [ ] Acceptance: cache hit ratio ≥ 0.99 sustained (exporter); nightly train wall time not regressed; settings doc complete. Commit.

---

## Phase A — API hardening

### Task A1: Rate limiting at nginx

**Files:**
- Modify: nginx site config on server (capture into repo: `ops/nginx/one.octavo.press.conf` — the config is currently server-only, un-versioned! Copy it into the repo first, deploy by scp + `nginx -t` + reload)

- [ ] Zones: `limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m` on `/api/auth/(login|signup)` (burst 5, 429 + `Retry-After`); `zone=api:10m rate=30r/s burst=60 nodelay` on `/api/`; tiles excluded (map panning is bursty by design; cap at 100r/s).
- [ ] Acceptance: 6th login attempt in a minute → 429 (curl loop); normal search usage unaffected (map pan test); nginx config now versioned in repo. Commit.

### Task A2: Boundary validation + error shape

**Files:**
- Create: `apps/one/src/lib/api-utils.ts`
- Modify: the worst offenders among the 36 routes (audit first)

- [ ] Audit all 36 `route.ts` files for: unvalidated query params reaching SQL (grep `searchParams.get` → query), inconsistent error JSON, missing method guards. Table in PR.
- [ ] `api-utils.ts`: `parseQuery(schema, request)` (zod at the boundary, 400 with field errors) + `apiError(status, code, message)` standard shape `{error: {code, message}}`. Migrate the audited offenders (not a big-bang rewrite — routes touched by the audit only).
- [ ] Acceptance: fuzzing the migrated routes with garbage params returns 400s, never 500s (scripted curl matrix in the PR). Commit.

### Task A3: DB roles — end superuser-everywhere

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_XX_roles.sql`, update `/etc/oper.env` via gen-env

- [ ] Roles: `oper_app` (SELECT/INSERT/UPDATE/DELETE on app tables, EXECUTE on the functions it uses — enumerate from code), `oper_worker` (same + crawl/rent tables), `oper_ml` (SELECT broadly + INSERT/UPDATE on model/stats tables), `oper_tileserv` (SELECT on tile tables/views/functions only), `oper_readonly` (dashboards). Default-deny: no CREATE on schema public for any of them.
- [ ] Cut over one service at a time (env swap + restart + verify), postgres superuser retained for migrations/backups only. **Order: tileserv (lowest risk) → ml → workers → app.** Watch logs 10 min per service for permission errors; grant-and-note anything missed.
- [ ] Acceptance: `SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1;` shows no service on `postgres`; a deliberate `DROP TABLE` attempt from `oper_app` fails. Commit (the SQL; passwords never).

---

## Phase C — Code health

### Task C1: Split `actions.ts` into query modules

**Files:**
- Create: `apps/one/src/lib/queries/{properties,property,stats}.ts`, `apps/one/src/lib/cache.ts`
- Modify: `apps/one/src/app/actions.ts` (becomes thin `'use server'` wrappers)

- [ ] `cache.ts`: one helper `cached(key, ttl, fn)` wrapping the redis get/set + version-key pattern (currently copy-pasted per action); TTL taxonomy documented in the file header (listing data 60s, stats 300s, HUD 24h).
- [ ] Move query building into `queries/properties.ts` (`buildListingsQuery(filters, sort, page): {sql, params}` — pure, returns text+params) + `queries/property.ts`. `parsePolygonParam` moves here with its tests.
- [ ] Tests: `queries/properties.test.ts` — filter→WHERE snapshots for 8 filter combos (price band, polygon, bounds, one-percent gate, cursor vs offset), asserting parameterization (no filter value ever appears in the SQL text).
- [ ] Acceptance: vitest green; search page behavior unchanged (manual before/after on 3 filter combos); `actions.ts` < 150 lines. Commit.

### Task C2: Backend CI teeth

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] Ensure CI runs: `pnpm -r test` (now includes C1's query tests), `pnpm -r typecheck`, pytest for `ml_rent_estimator` (needs numpy≥2 in the runner — pin the setup step), and a migrations dry-run job: spin `postgres:16-postgis` service container, apply ALL of `infrastructure/migrations/*.sql` in filename order against empty DB — catches syntax/ordering rot forever.
- [ ] Acceptance: intentionally broken migration in a scratch branch fails CI. Commit.

## Execution order

```
O1 (restart window, with S4 settings batched into the same restart)
O2 (needs 3+ days of data — start Phase A + C while it collects)
A1 → A2 → A3
C1 → C2
S1 → S2 → S3   (after O2's data confirms the hypotheses)
```

Acceptance summary: query observability live with a committed triage doc; hot paths indexed with proof; audit table capped at 90 days; no service connects as superuser; auth endpoints rate-limited; nginx config versioned; `actions.ts` split with parameterization tests; CI catches broken migrations.
