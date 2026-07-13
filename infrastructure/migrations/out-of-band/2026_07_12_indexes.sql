-- S1 (backend-db-hardening): index audit — add missing, drop unused.
-- Run as postgres. Every statement uses CONCURRENTLY, which is NOT allowed inside a
-- transaction block, so apply statement-by-statement in autocommit (psql default),
-- NOT through migrate.ts:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f 2026_07_12_indexes.sql
--
-- pg_stat_statements at authoring: reset 2026-07-12 05:05 UTC (~1.5h window).
-- Drops target only non-unique indexes with idx_scan = 0 over that window.
-- Re-verify after >=3 days; if any prove needed, recreate (see docs/perf/2026-07-query-triage.md).

-- 1) media-health worker (the #1 CPU sink in the triage doc). Its query is
--      SELECT id, primary_photo FROM listings
--      WHERE media_url_status = 0
--         OR (media_url_status >= 500 AND media_last_checked < now() - interval '1 day')
--      ORDER BY media_last_checked NULLS FIRST LIMIT 1000;
--    Keying the partial index on media_last_checked with NULLS FIRST lets Postgres
--    satisfy both the filter (partial predicate) and the ORDER BY+LIMIT as a plain
--    Index Scan — no seq scan, no sort. Proven by EXPLAIN (ANALYZE, BUFFERS):
--      before: Parallel Seq Scan, 186,113 buffers, ~499 ms
--      after:  Index Scan,           182 buffers,   ~1.1 ms
--    Replaces the unused idx_listings_media_recheck (was keyed on media_last_checked
--    but without NULLS FIRST, so it could never satisfy the ORDER BY).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_media_pending
  ON listings (media_last_checked NULLS FIRST)
  WHERE (media_url_status = 0 OR media_url_status >= 500);

-- 2) viewport/search price + sale-type filtering within geom (plan S1 candidate).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_type_sale_price_geom
  ON listings (listing_type, sale_type, price)
  WHERE geom IS NOT NULL;

-- 3) saved-search freshness / zip listing ordering (plan S1 candidate).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_zip_created
  ON listings (zip_code, created_at DESC);

-- 4) rental feed by source + listing_date (plan S1 candidate).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_source_date
  ON rental_listings (source, listing_date DESC);

-- --- DROPS: non-unique, idx_scan = 0 over the observed window ---
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_broker_name;
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_census_tract;
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_mls_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_mls_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_media_recheck;
DROP INDEX CONCURRENTLY IF EXISTS idx_mv_cluster_tiles_zoom;
