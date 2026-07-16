-- OUT-OF-BAND: supports the homepage "First-Deal Magic" spotlight query
-- (apps/one/src/lib/spotlight.ts). The query returns the single best
-- 1%-clearing live listing near a metro, ORDER BY rent_price_ratio DESC,
-- created_at DESC LIMIT 1.
--
-- A prod EXPLAIN (2026-07-16) showed the planner chose a Parallel Seq Scan +
-- top-N Sort (~1.15s over 352k rows) and did NOT use the existing
-- listings_rent_price_ratio_idx, because that index's partial WHERE does not
-- cover the spotlight's extra predicates. This partial index mirrors the
-- spotlight WHERE exactly (for_sale, price floor, rent present, ratio band,
-- geom present, photo present) so the planner can walk rent_price_ratio DESC
-- and apply the remaining (zip_code = $1 OR geom < 0.6) predicate as a cheap
-- residual filter to satisfy LIMIT 1 in milliseconds.
--
-- CONCURRENTLY cannot run inside a transaction, so this CANNOT be a normal
-- migration (the `pnpm migrate` runner wraps each top-level file in BEGIN/COMMIT
-- and would abort). Run by hand against prod, off-peak.
--
-- If a previous attempt failed it can leave an INVALID index; drop it first:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_listings_spotlight;
--
-- Run:
--   psql "$DATABASE_URL" -f 2026_07_16_spotlight_index.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_spotlight
    ON listings (rent_price_ratio DESC, created_at DESC)
    WHERE listing_type = 'for_sale'
      AND price >= 30000
      AND estimated_rent > 0
      AND rent_price_ratio >= 0.01
      AND rent_price_ratio <= 0.05
      AND geom IS NOT NULL
      AND COALESCE(primary_photo, images->>0) IS NOT NULL;
