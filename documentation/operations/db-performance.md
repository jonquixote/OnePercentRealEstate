# DB Performance Foundation — Measurement, Runbooks, Baseline

Baseline captured 2026-07-24 on prod (`209.50.61.64`). This document is the yardstick for any future query-optimization or index-pruning work.

---

## 1. Measurement Protocol

### Admin Endpoint (`/api/admin/db-stats`)

Gated on `ADMIN_API_KEY` (same header as other `/api/admin/*` routes). Returns:

```json
{
  "topByTotalTime":  [ { "query", "calls", "mean_exec_time", "total_exec_time" } ],
  "topByMeanTime":   [ { "query", "calls", "mean_exec_time", "total_exec_time" } ],
  "indexUsage":      [ { "schemaname", "relname", "indexrelname", "idx_scan", "idx_blks_read", "size_bytes" } ]
}
```

**Source:** `pg_stat_statements` (top 20 by total time, top 20 by mean time) + a join of `pg_stat_user_indexes` + `pg_statio_user_indexes` (top 50 by size, with disk-block reads from `pg_statio_user_indexes`).

**Reset baseline:** After deploying, run `SELECT pg_stat_statements_reset()` once. Counters start accumulating from that point. The endpoint never mutates stats.

### Weekly Snapshots (`oper-pg-stat.timer`)

`ops/monitoring/pg-stat-snapshot.sh` runs weekly and appends to:

| Table | Columns | Purpose |
|-------|---------|---------|
| `perf_index_scan_history` | `captured_at`, `schemaname`, `relname`, `indexrelname`, `idx_scan`, `idx_blks_read`, `size_bytes` | Track index scan deltas over time |
| `perf_statement_history` | `captured_at`, `query`, `calls`, `mean_exec_time`, `total_exec_time` | Track slow-query trends |

**Idempotent:** tables are created `IF NOT EXISTS` on every run. Safe to run manually:

```bash
DATABASE_URL_DIRECT=postgres://... ./ops/monitoring/pg-stat-snapshot.sh
```

### The 7-Day Window Rule

Index-drop decisions require a **DELTA across >=2 weekly snapshots** (minimum 7 days). A single reading is never sufficient. `pg_stat_user_indexes` counters reset on Postgres restart, while `pg_stat_statements` counters persist when `pg_stat_statements.save = on` (the default). A post-reboot `idx_scan=0` proves nothing. The DELTA between two snapshots captures scans that actually happened during the measurement window.

---

## 2. Index Drop Log

Track every index ever dropped in this table. Nothing has been dropped yet (T4 deferred pending measurement window).

| Index Name | Table | Drop Date | Size (MB) | Why Dropped | Recreate DDL |
|------------|-------|-----------|-----------|-------------|--------------|
| _(none yet)_ | | | | | |

### Deferred Candidates (awaiting >=7d window)

These indexes showed 0 scans in the post-reboot snapshot (2026-07-24). They are **NOT confirmed unused** until the measurement window proves it.

| Index Name | Table | Size (MB) | Notes |
|------------|-------|-----------|-------|
| `idx_mv_cluster_tiles_zoom_geom` | `mv_cluster_tiles` | 175 | Spatial index on materialized view |
| `listings_addr_type_saletype_uniq` | `listings` | 139 | **UNIQUE -- never drop** |
| `uq_mv_cluster_tiles_zoom_xy` | `mv_cluster_tiles` | 125 | **UNIQUE -- never drop** |
| `idx_listings_beds_baths` | `listings` | 92 | Composite on beds+baths |
| `idx_listings_geom` | `listings` | 85 | Primary spatial index |
| `idx_listings_geom_type` | `listings` | 84 | Spatial + type filter |
| `idx_listings_lat_lon` | `listings` | 74 | Lat/lon coordinates |
| `idx_rent_predictions_audit_listing` | `rent_predictions_audit` | 67 | FK lookup on audit table |
| `idx_listings_price` | `listings` | 58 | Price range queries |
| `idx_listings_type_created` | `listings` | 57 | Type + created_at |
| `idx_rental_location_gist` | `rental_listings` | 53 | Spatial on rentals |
| `idx_rental_unique_listing` | `rental_listings` | 50 | Unique constraint |

**Rule:** NEVER drop a UNIQUE or PK index even if unscanned -- it enforces data integrity.

### Audit Table Status

| Table | Status | Size | Rows |
|-------|--------|------|------|
| `rent_predictions_audit` | **Live table** (active partition) | 887MB | 1.78M |
| `rent_predictions_audit_old` | **NOT FOUND on prod** -- lost in OOM rebuild | -- | -- |

The `_old` table was cruft (pre-partition migration remnant). It does not exist on the current prod database. The live `rent_predictions_audit` table is managed by `oper-audit-rotate` which drops partitions >90d.

---

## 3. PgBouncer Runbook

### Configuration

PgBouncer runs in **transaction mode** on `:6432`. Config at `ops/pgbouncer/pgbouncer.ini`:

```ini
[databases]
* = host=127.0.0.1 port=5432

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
auth_file = /opt/onepercent/ops/pgbouncer/userlist.txt
pool_mode = transaction
default_pool_size = 20
max_client_conn = 200
server_idle_timeout = 300
```

**Key parameters:**
- `pool_mode = transaction` -- connections released after each transaction; no session state across calls
- `default_pool_size = 20` -- server-side connections per pool (fits within `max_connections=100` headroom)
- `max_client_conn = 200` -- client-side connections accepted (multiplexed onto 20 server conns)

### Connection Routing

| Env Var | Target | Used By |
|---------|--------|---------|
| `DATABASE_URL` | `localhost:6432` (PgBouncer) | App, worker (default) |
| `DATABASE_URL_DIRECT` | `localhost:5432` (direct Postgres) | Migrations, session consumers |

Set by `ops/systemd/gen-env.sh` (lines 36-37).

### Checking Pool Status

```bash
# Connect to PgBouncer admin console
psql -h 127.0.0.1 -p 6432 -U postgres pgbouncer

# Show active pools
SHOW POOLS;

# Show all server connections
SHOW SERVERS;

# Show all client connections
SHOW CLIENTS;

# Show config
SHOW CONFIG;
```

`SHOW POOLS` columns: `database`, `user`, `cl_active`, `cl_waiting`, `sv_active`, `sv_idle`, `sv_used`, `sv_tested`, `sv_login`, `maxwait`.

Healthy state: `cl_active` > 0, `sv_active` low (multiplexing working), `cl_waiting` = 0.

### Password Rotation

Passwords are derived from `/etc/oper.env` `POSTGRES_PASSWORD`. When that changes:

```bash
# 1. Update the password (done by gen-env.sh automatically)
bash ops/systemd/gen-env.sh

# 2. Regenerate PgBouncer userlist
bash ops/pgbouncer/gen-pgbouncer-userlist.sh
# Writes ops/pgbouncer/userlist.txt with md5 hash

# 3. Reload PgBouncer (no restart needed for userlist)
kill -HUP $(pidof pgbouncer)
# Or: systemctl reload oper-pgbouncer
```

### Rollback (PgBouncer to Direct)

One-line revert -- change `DATABASE_URL` in `/etc/oper.env`:

```bash
# Find the current DATABASE_URL (via PgBouncer :6432)
grep '^DATABASE_URL=' /etc/oper.env

# Revert to direct connection (:5432) -- only DATABASE_URL, not DATABASE_URL_DIRECT
sed -i 's|^DATABASE_URL=.*localhost:6432|DATABASE_URL=postgresql://postgres:'"$(grep '^POSTGRES_PASSWORD=' /etc/oper.env | cut -d= -f2-)"'@localhost:5432/postgres|' /etc/oper.env

# Restart ALL services that consume DATABASE_URL
systemctl restart oper-app oper-two oper-worker oper-worker-rent oper-worker-refresh \
  oper-worker-watchlist oper-worker-media oper-worker-ml-scheduler oper-worker-digest
```

This bypasses PgBouncer entirely. Use when PgBouncer is misbehaving or causing connection errors.

### MemoryMax Cap

PgBouncer systemd unit includes `MemoryMax=256M` to stay within the OOM-hardening budget. PgBouncer is lightweight (~10MB idle) so this is generous headroom for connection spikes.

---

## 4. Before Baseline (2026-07-24)

Captured on prod after the memory-hardening and PgBouncer deployment.

### Database Size

| Table | Size |
|-------|------|
| `listings` | 11GB |
| `rental_listings` | 1.8GB |
| `parcels` | 1GB |
| `census_tracts` | 894MB |
| `rent_predictions_audit` | 887MB (1.78M rows) |
| `rent_predictions_audit_p2026_07` | 824MB (live partition) |
| **Total DB** | **~19GB** |

### Connections

| Setting | Value |
|---------|-------|
| `max_connections` | 100 (set by harden-memory) |
| PgBouncer `default_pool_size` | 20 |
| PgBouncer `max_client_conn` | 200 |
| Observed active conns (at baseline) | 14 total (1 active / 8 idle) |

### pg_stat_statements

Reset on 2026-07-24. Counters start fresh from this date. Use the admin endpoint to read top queries:

```bash
curl -s -H "x-admin-key: $ADMIN_API_KEY" http://localhost:3001/api/admin/db-stats | jq '.topByTotalTime[:5]'
```

### Top Slow Queries

To be captured after the measurement window accumulates data. The endpoint returns queries ordered by `total_exec_time` and `mean_exec_time`. After 7+ days, the weekly snapshot trend tables will show which queries are consistently slow vs. one-time spikes.

### Index Scan Snapshot (post-reboot, 2026-07-24)

Zero-scan indexes at the time of measurement (NOT proof of unused -- see Section 1, "7-Day Window Rule"):

| Index | Table | Size (MB) |
|-------|-------|-----------|
| `idx_mv_cluster_tiles_zoom_geom` | `mv_cluster_tiles` | 175 |
| `listings_addr_type_saletype_uniq` | `listings` | 139 (UNIQUE) |
| `uq_mv_cluster_tiles_zoom_xy` | `mv_cluster_tiles` | 125 (UNIQUE) |
| `idx_listings_beds_baths` | `listings` | 92 |
| `idx_listings_geom` | `listings` | 85 |
| `idx_listings_geom_type` | `listings` | 84 |
| `idx_listings_lat_lon` | `listings` | 74 |
| `idx_rent_predictions_audit_listing` | `rent_predictions_audit` | 67 |
| `idx_listings_price` | `listings` | 58 |
| `idx_listings_type_created` | `listings` | 57 |
| `idx_rental_location_gist` | `rental_listings` | 53 |
| `idx_rental_unique_listing` | `rental_listings` | 50 |

---

## 5. Index Audit Protocol

Execute when the >=7-day measurement window (Section 1) is complete.

### Step 1: Query DELTA across snapshots

```sql
-- Find indexes with zero scan DELTA across the window
SELECT
  old.indexrelname,
  old.relname,
  pg_size_pretty(old.size_bytes) AS size,
  old.idx_scan AS scans_start,
  new.idx_scan AS scans_end,
  new.idx_scan - old.idx_scan AS scan_delta
FROM perf_index_scan_history old
JOIN perf_index_scan_history new
  ON old.indexrelname = new.indexrelname
  AND old.relname = new.relname
  AND old.schemaname = new.schemaname
  AND new.captured_at = (SELECT MAX(captured_at) FROM perf_index_scan_history)
WHERE old.captured_at = (SELECT MIN(captured_at) FROM perf_index_scan_history)
  AND new.idx_scan - old.idx_scan = 0
  AND old.size_bytes > 50 * 1024 * 1024  -- > 50MB
ORDER BY old.size_bytes DESC;
```

### Step 2: Cross-check against active queries

For each candidate from Step 1, verify it is not used by any hot query:

```sql
-- Check if the index appears in any query plan
EXPLAIN (COSTS OFF)
<copy the top query from pg_stat_statements here>;
```

If the planner mentions the index name in the plan (as Index Scan, Bitmap Scan, etc.), do NOT drop it.

### Step 3: Drop confirmed-unused indexes

Only drop if ALL conditions are met:
- Zero scan delta across the >=7-day window
- Not a UNIQUE or PK index
- Not referenced by any known hot query planner

```sql
-- Always use CONCURRENTLY to avoid locking writes
DROP INDEX CONCURRENTLY <index_name>;
```

**Recreate DDL** must be included as a comment header in the migration file before execution. Example:

```sql
-- RECREATE DDL (if needed):
-- CREATE INDEX CONCURRENTLY <index_name> ON <table> (<columns>);

DROP INDEX CONCURRENTLY <index_name>;
```

### Step 4: Add missing indexes for slow queries

For any top-slow query doing sequential scans:

```sql
-- Identify seq scans on hot queries
EXPLAIN (ANALYZE, BUFFERS)
<top slow query>;
```

If a seq scan appears on a large table, create the missing index:

```sql
CREATE INDEX CONCURRENTLY <new_index_name> ON <table> (<columns>);
```

Verify improvement with `EXPLAIN (ANALYZE)` before and after.

### Step 5: Record in Drop Log

After any drop or add, update the table in Section 2 of this document with the index name, date, size, reason, and recreate DDL.
