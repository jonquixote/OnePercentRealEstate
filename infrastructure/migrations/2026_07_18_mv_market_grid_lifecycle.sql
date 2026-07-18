-- infrastructure/migrations/2026_07_18_mv_market_grid_lifecycle.sql
-- Rebuild the homepage markets grid to be lifecycle-aware: the `top` CTE now
-- counts/aggregates only ACTIVE inventory, so sold/stale/rental_misfiled rows
-- no longer inflate a ZIP's listing count or skew its median price/rent.
-- Definition is otherwise copied verbatim from 2026_07_17_mv_market_grid.sql.
-- DROP + recreate (a materialized view's defining query can't be ALTERed in
-- place), then recreate the unique index, REFRESH once, and hand ownership back
-- to oper_worker so the worker's REFRESH CONCURRENTLY loop keeps working.
DROP MATERIALIZED VIEW IF EXISTS mv_market_grid;

CREATE MATERIALIZED VIEW mv_market_grid AS
  WITH top AS (
    SELECT zip_code,
           max(raw_data->>'city') AS city,
           max(raw_data->>'state') AS state,
           count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
             FILTER (WHERE estimated_rent > 0) AS median_rent
    FROM listings
    WHERE listing_type = 'for_sale' AND sale_type = 'standard'
      AND listing_status = 'active'
      AND price > 10000 AND zip_code ~ '^\d{5}$'
    GROUP BY zip_code
    ORDER BY n DESC
    LIMIT 8
  )
  SELECT t.zip_code, t.city, t.state, t.n,
         t.median_price, t.median_rent,
         CASE WHEN t.median_price > 0 THEN round((t.median_rent / t.median_price * 100)::numeric, 2) END AS ratio,
         CASE WHEN h.five_ago > 0 THEN round(((h.latest - h.five_ago) / h.five_ago * 100)::numeric, 1) END AS hpi5y
  FROM top t
  LEFT JOIN LATERAL (
    -- hpi = FHFA index LEVEL (annual_change_pct = yearly %); see 2026-07-17 column-swap fix.
    SELECT max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code)) AS latest,
           max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code) - 5) AS five_ago
    FROM fhfa_zip_hpi WHERE zip5 = t.zip_code
  ) h ON true
WITH NO DATA;

-- CONCURRENTLY needs a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS mv_market_grid_zip ON mv_market_grid (zip_code);

-- Single population pass (CREATE used WITH NO DATA above).
REFRESH MATERIALIZED VIEW mv_market_grid;

-- The worker refresh loop connects as oper_worker (see oper-worker-refresh.service
-- env). REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership, so hand it over.
-- Wrapped in a DO block: the role exists on prod (created by the out-of-band
-- db_roles migration) but NOT in CI/local dry-runs, where a bare ALTER would fail
-- the migration runner (role "oper_worker" does not exist).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'oper_worker') THEN
    ALTER MATERIALIZED VIEW mv_market_grid OWNER TO oper_worker;
  END IF;
END
$$;
