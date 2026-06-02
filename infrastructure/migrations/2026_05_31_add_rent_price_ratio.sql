-- 2026_05_31: Add generated column rent_price_ratio (1% rule indicator)
-- This requires no extension (pgcrypto NOT needed; this is pure NUMERIC).
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rent_price_ratio NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN price > 0 AND estimated_rent IS NOT NULL
      THEN estimated_rent / price
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS listings_rent_price_ratio_idx
  ON listings (rent_price_ratio DESC)
  WHERE rent_price_ratio IS NOT NULL;
