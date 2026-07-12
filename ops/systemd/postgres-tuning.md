# Postgres Tuning — Running Log

Canonical record of every Postgres setting change on the production box
(OnePercentRealEstate / octavo.press). Apply changes via `ALTER SYSTEM`
+ `SELECT pg_reload_conf();` where possible; a full restart is only used
when `shared_preload_libraries` or similar requires it (coordinate a quiet
window with the user first, then run the 2026-07-09 post-restart checklist:
healthz, worker logs, tiles).

Safety net before ANY destructive-class change:
`ls /var/backups/oper/ && rclone lsf oper-r2:onepercent-pg-backups | tail -1`

Verify the live values at any time against the running server:
`SELECT name, setting, unit FROM pg_settings WHERE name IN (...);`
If a value below disagrees with `SHOW ALL`, treat the server as source of
truth and update this file.

---

## 2026-07-12 — O1: pg_stat_statements + auto_explain (LIVE)

Applied during a single coordinated restart window (batched with S4 below —
ONE restart total for the plan).

```sql
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements, auto_explain';
ALTER SYSTEM SET pg_stat_statements.track = 'top';
ALTER SYSTEM SET auto_explain.log_min_duration = '500ms';
ALTER SYSTEM SET auto_explain.log_analyze = off;   -- on is risky in prod
SELECT pg_reload_conf();  -- then restart for shared_preload_libraries
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Verification after a day of traffic:
`SELECT count(*) FROM pg_stat_statements;` should be > 0.
Auto-explain entries appear in the Postgres log for queries > 500ms.

**Verified live 2026-07-12:** `pg_stat_statements` extension present,
`count(*) FROM pg_stat_statements` = 123 (> 0 ✅). `shared_preload_libraries`,
`track`, and the two `auto_explain` GUCs all match the values below (S4).

---

## 2026-07-12 — S4: config for the actual box (LIVE)

Box: 15GB shared with app + ML (ML spikes ~2GB during train). Applied via
`ALTER SYSTEM`, batched into the same restart as O1.

| Setting | Value | Why |
|---|---|---|
| `shared_buffers` | `2GB` | ~13% of RAM; was near-default 128MB |
| `effective_cache_size` | `8GB` | OS cache + shared_buffers the planner can assume |
| `work_mem` | `64MB` | per-operation sort/hash; watch total concurrent |
| `maintenance_work_mem` | `512MB` | faster VACUUM / index builds |
| `random_page_cost` | `1.1` | SSD-backed storage |
| `wal_compression` | `pglz` | smaller WAL, less I/O (`on` resolves to pglz) |
| `max_wal_size` | `2GB` | fewer checkpoints under write load |
| `max_connections` | `120` | pool 50 + workers ~15 + ml ~5 + tileserv ~4; headroom |

Acceptance (exporter-backed): cache hit ratio ≥ 0.99 sustained; nightly
train wall time not regressed.

**Verified live 2026-07-12** (all values below match `pg_settings` on the
box — note `work_mem` ended at 64MB, not the 32MB in the original plan
target): `shared_buffers`=2GB, `effective_cache_size`=8GB, `work_mem`=64MB,
`maintenance_work_mem`=512MB, `random_page_cost`=1.1, `wal_compression`=pglz,
`max_wal_size`=2GB, `max_connections`=120.

---

## Pending follow-ups (not yet applied)

- O1: Prometheus postgres-exporter queries added (see
  `infrastructure/monitoring/postgres-exporter/queries.yml`): top-10 by
  `mean_exec_time`, cache hit ratio, connections by state, table dead-tuple
  ratio (bloat proxy). Restart exporter; verify series.
- S3: per-table autovacuum scale factors for `mv_cluster_tiles` (0.02) and
  `listings` (0.05).
- Future entries go here, newest at the bottom, each dated with the SQL
  applied and the before/after metric.
