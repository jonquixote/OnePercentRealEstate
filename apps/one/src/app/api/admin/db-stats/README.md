# /api/admin/db-stats

Read-only admin surface exposing `pg_stat_statements` (top 20 slow queries by
total and mean exec time) plus a join of `pg_stat_user_indexes` +
`pg_statio_user_indexes` (scan count, block reads, and index size, top 50 by
size) for query + index-tuning analysis.

## Auth

Gated on `ADMIN_API_KEY` via the `x-api-key` (or `x-admin-key`) header, same as
the other `/api/admin/*` routes. Returns 401 without a valid key.

## Response shape

```json
{
  "topByTotalTime": [{ "query": "...", "calls": 100, "mean_exec_time": 1.2, "total_exec_time": 120 }],
  "topByMeanTime":  [{ "query": "...", "calls": 100, "mean_exec_time": 1.2, "total_exec_time": 120 }],
  "indexUsage":     [{ "schemaname": "public", "relname": "listings", "indexrelname": "...", "idx_scan": 0, "idx_blks_read": 0, "size_bytes": 1048576 }]
}
```

The route issues only `SELECT`s against `pg_stat_statements` and a join of
`pg_stat_user_indexes` + `pg_statio_user_indexes` — it never mutates stats.

## Establishing a baseline

`pg_stat_statements` counters are cumulative and **persist across server
restarts** when `pg_stat_statements.save = on` (the default). To start a clean
measurement window, deploy the endpoint, then run the reset script **once** from
a host with DB access:

```sh
DATABASE_URL_DIRECT=postgres://user:pass@host:5432/db \
  ./ops/db/reset-stats.sh
```

Record the printed baseline timestamp; index-drop / slow-query audits must be
read against this baseline (or against the weekly snapshots from
`oper-pg-stat.timer` — see the performance docs). Never treat a single
post-restart `idx_scan = 0` reading as proof an index is unused.
