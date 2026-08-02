-- OUT-OF-BAND: rent_price_ratio must not be computed from a placeholder price.
--
-- WHY
-- ---
-- rent_price_ratio is the product's core metric: rent / price, the 1% rule. Its
-- generated expression guarded only `price > 0`, which correctly NULLs the 580
-- listings priced at exactly 0 — and lets every listing priced at $1 through.
--
-- Measured on prod 2026-08-01:
--   * 908 active for_sale listings priced <= $1
--   * 2,099 priced $1–$9,999
--   * 671 of those CLEAR the 1% rule purely because the denominator is junk
--   * the top TEN deals in the entire database, ranked by the product's own
--     metric, were all $1 listings with ratios up to 6,216 (621,672%)
--
-- These are auction/placeholder rows: none has a real list price hidden
-- elsewhere in raw_data (`has_real_list_price = 0`), and roughly half are
-- sale_type='auction'. The rent estimate is fine; the PRICE is not real, so the
-- ratio built on it is not a number we can stand behind.
--
-- WHY $10,000 AND NOT A RATIO CAP
-- -------------------------------
-- Genuinely cheap, genuinely high-yield inventory exists and must be preserved:
-- the $10k–$25k band averages a 9.5% ratio and $25k–$50k averages 4.4% — a
-- $16,900 house in Springfield IL renting at $1,546 is a real 9.2% deal, not an
-- error. Capping the RATIO would discard those. The defect is the denominator,
-- so the guard belongs on price.
--
-- $10,000 is deliberately well below the $30,000 floor the product already
-- applies on its featured surface (idx_listings_spotlight), so this is strictly
-- more permissive than a bar the product already shipped.
--
-- COST / LOCKING
-- --------------
-- Postgres cannot ALTER a generation expression in place; the column must be
-- dropped and re-added, which REWRITES the table (9.5 GB, 1.46M rows) under an
-- ACCESS EXCLUSIVE lock. The app and crawl block for the duration. Run it
-- deliberately, off-peak, not as part of an automatic deploy — hence
-- out-of-band.
--
-- Dropping the column also drops idx_listings_spotlight (its only dependent —
-- verified: no views or materialized views reference the column, so
-- mv_cluster_tiles / mv_market_grid are unaffected). It is recreated below with
-- its predicate unchanged.
--
-- Run:
--   psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f 2026_08_02_rent_price_ratio_credible_price.sql

BEGIN;

ALTER TABLE listings DROP COLUMN IF EXISTS rent_price_ratio;

ALTER TABLE listings
  ADD COLUMN rent_price_ratio NUMERIC GENERATED ALWAYS AS (
    CASE
      -- A price below $10,000 is a placeholder, not an asking price. Emit NULL
      -- rather than a ratio we would have to caveat: an absent number is honest,
      -- a wrong one is not.
      WHEN price >= 10000 AND estimated_rent IS NOT NULL
      THEN estimated_rent / price
      ELSE NULL
    END
  ) STORED;

-- Recreated verbatim from the pre-migration definition.
CREATE INDEX idx_listings_spotlight
  ON public.listings USING btree (rent_price_ratio DESC, created_at DESC)
  WHERE listing_type = 'for_sale'
    AND price >= 30000::numeric
    AND estimated_rent > 0::numeric
    AND rent_price_ratio >= 0.01
    AND rent_price_ratio <= 0.02
    AND geom IS NOT NULL
    AND COALESCE(primary_photo, images ->> 0) IS NOT NULL;

COMMIT;

-- Verification (run after):
--   SELECT count(*) FILTER (WHERE rent_price_ratio > 0.20) AS implausible,
--          count(*) FILTER (WHERE rent_price_ratio >= 0.01) AS clearing_1pct,
--          max(rent_price_ratio) AS max_ratio
--     FROM listings WHERE listing_status='active' AND listing_type='for_sale';
-- Expect: implausible drops to ~0, max_ratio well under 1.0, and clearing_1pct
-- falls by roughly 671 (the spurious clearers).
