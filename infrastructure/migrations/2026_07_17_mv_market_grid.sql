-- infrastructure/migrations/2026_07_17_mv_market_grid.sql
-- Precomputed homepage markets grid. The live aggregation scans ~1M listings
-- with two percentile_conts per ZIP (~22s) — far too slow for a request path.
-- Refreshed CONCURRENTLY by the worker refresh loop (~30 min cadence).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_market_grid AS
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
  ) h ON true;

-- CONCURRENTLY needs a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS mv_market_grid_zip ON mv_market_grid (zip_code);

-- The worker refresh loop connects as oper_worker (see oper-worker-refresh.service
-- env). REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership, so hand it over.
-- Without this, the 30-min refresh fails with "must be owner" — and a future
-- migration that recreates this view as postgres would silently revert it.
ALTER MATERIALIZED VIEW mv_market_grid OWNER TO oper_worker;
