# Backend Query Triage — 2026-07-12 (PRELIMINARY)

Source: `pg_stat_statements`, reset **2026-07-12 05:05 UTC**. At time of authoring
only ~1.5h of accumulation existed (Postgres restart for the O1 tuning reload reset
stats). The plan calls for ≥3 days of data before S-tasks; this is a first-pass
snapshot to drive the S1 index changes. **Re-run this triage after ≥3 days of steady
traffic and confirm the S1 drops are still safe.**

Scope: top statements by `total_exec_time`, `pg_stat_statements` excluded.

## Top consumers (observed window)

| Rank | Normalized query | total_ms | calls | mean_ms | Notes |
|---|---|---:|---:|---:|---|
| 1 | `SELECT id, primary_photo FROM listings WHERE media_url_status = $1 OR (media_url_status >= $2 AND media_last_c…)` | 144,707 | 464 | 312 | media-health worker — full/partial scan of `listings` |
| 2 | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_tiles` | 84,194 | 2 | 42,097 | refresh cost, not an index fix |
| 3 | `SELECT media_url_status FROM listings` | 71,601 | — | — | status histogram — inherently a full scan of 1M rows |
| 4 | `SELECT rent_calc_status, count(*) FROM listings GROUP BY rent_calc_status` | 79,062 | 240 | ~329 | rent worker status poll, ~1/90s |
| 5 | `… resolve_rule …` (rule-eval CTE) | 18,383 | — | — | small rule table, called per-row in big queries |
| 6 | `SELECT count(*) FROM listings` | 12,116 | many | ~50 | MVCC full count |
| 7 | rental last-24h feed | 9,579 | — | — | uses `idx_rental_created` (3,281 scans) — OK |
| 8 | `mv_cluster_tiles` duplicate-key check | 2,461 | 1 | — | refresh validation — OK |
| 9 | `address_rent_history` INSERT | 2,103 | — | — | write — OK |
| 10 | `hud_safmr` lookups | 3,694 | — | — | uses `idx_hud_safmr_lookup` (13M scans) — OK |

## Fix hypotheses

1. **media_url_status scans (ranks 1, 3) — biggest CPU sink (~216s / window).**
   The media-health worker targets pending/errored rows (`status = 0 OR status >= 500`).
   The supporting partial index `idx_listings_media_recheck` exists but is keyed on
   `media_last_checked` and has `idx_scan = 0` — the planner cannot use it to satisfy
   the `media_url_status` filter, so it seq-scans. Rank 3 (full histogram) is
   inherently unindexable.
   - Action (S1): replace `idx_listings_media_recheck` with
     `idx_listings_media_pending (media_url_status, media_last_checked) WHERE media_url_status = 0 OR media_url_status >= 500`. Leading column = the filter column, so the worker's OR becomes a bitmap scan of ~%rows that actually need work.
   - Action (follow-up, app-side, out of this DB task): (a) have the worker also require
     `primary_photo IS NOT NULL` so it reuses the existing `idx_listings_media_health`;
     (b) cache the rank-3 histogram instead of recomputing it every cycle.

2. **`mv_cluster_tiles` refresh (rank 2).** Structural, not index-related. Already
   CONCURRENTLY (pre-solved) + autovacuum tuned in S3. 2 refreshes / window is fine.
   No DB change; monitor refresh cadence (`oper-worker-refresh`) for overlap.

3. **`rent_calc_status` GROUP BY count (rank 4).** `idx_listings_rent_calc_pending`
   (partial, `status='pending'`) is heavily used (26,727 scans) but a count over *all*
   statuses still full-scans. Candidate covering index `(rent_calc_status)` to allow an
   index-only scan — deferred pending 3-day re-triage (write amplification on a hot
   table; current cost is acceptable). Listed here for the next pass.

4. **`resolve_rule` per-row calls (rank 5).** `property_type_rules` shows ~50M seq
   scans at 1 row avg — negligible per-call cost, but indicates `resolve_rule` is
   evaluated per row inside large queries (e.g. the stats query). Low priority; could
   be cached in-app or inlined. No DB change now.

## Index audit (S1) — see `infrastructure/migrations/out-of-band/2026_07_12_indexes.sql`

Added:
- `idx_listings_media_pending` (replaces unused `idx_listings_media_recheck`)
- `idx_listings_type_sale_price_geom` (listing_type, sale_type, price) WHERE geom IS NOT NULL
- `idx_listings_zip_created` (zip_code, created_at DESC)
- `idx_rental_source_date` (source, listing_date DESC)

Dropped (non-unique, `idx_scan = 0` over observed window):
- `idx_listings_broker_name`, `idx_listings_census_tract`, `idx_listings_mls_id`,
  `idx_listings_mls_status`, `idx_listings_media_recheck`, `idx_mv_cluster_tiles_zoom`

Flagged but **kept** pending ≥3-day re-triage (low-but-nonzero or map-related):
- `idx_listings_lat_lon` (9 scans), `idx_rental_geo` (0), `idx_rental_location_gist` (0).
