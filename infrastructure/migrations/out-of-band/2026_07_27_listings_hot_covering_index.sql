-- Hot-set covering index for the homepage stats aggregate.
--
-- MEASURED PROBLEM (2026-07-27): the aggregate read 565,530 buffers (~4.4 GB)
-- and discarded 850,339 rows (64% of the table) via the lifecycle filter, to
-- produce a single row. 59% of `listings` is `stale` and no user-facing query
-- ever wants it.
--
-- This is the LOW-RISK half of the hot/cold plan. Partitioning by
-- listing_status was ruled out on evidence: it would require adding the status
-- to listings_addr_type_saletype_uniq, which would let the SAME address exist
-- as both active and stale and break the crawler's ON CONFLICT upsert. See
-- docs/perf/2026-07-hot-cold-decision.md.
--
-- RESULT (prod, same query):
--   Parallel Seq Scan  11,847 ms, 565,530 buffers
--   Index Only Scan       764 ms, 100,300 buffers   (15x faster, 5.6x fewer buffers)
--   Index size: 25 MB. Build: ~20 s CONCURRENTLY.
--
-- The predicate MUST stay byte-identical to the WHERE clause in
-- apps/one/src/lib/stats-compute.ts or the planner cannot prove implication and
-- will silently fall back to a seq scan.
--
-- CONCURRENTLY cannot run inside a transaction — run by hand:
--   psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f <this file>

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_stats_hot
    ON listings (price)
    INCLUDE (estimated_rent, state, property_type, rent_calc_status)
    WHERE listing_type = 'for_sale'
      AND sale_type = 'standard'
      AND price > 10000
      AND listing_status NOT IN ('sold','stale','rental_misfiled');

-- Refresh planner stats so the new index is used immediately.
ANALYZE listings;
