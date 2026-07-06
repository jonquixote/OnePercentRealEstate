-- Wave 2: quantile confidence band for the v1 rent model. Nullable adds —
-- metadata-only on the ~946K-row listings table.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rent_low  NUMERIC,
  ADD COLUMN IF NOT EXISTS rent_high NUMERIC;
