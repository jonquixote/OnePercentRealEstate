-- Wave 1: hoa_fee NUMERIC(10,2) overflowed during backfill on ~194K rows.
-- Widen to NUMERIC(15,2) to accommodate larger HOA fee values.
-- Metadata-only change (relaxing constraint, no table rewrite).
ALTER TABLE listings ALTER COLUMN hoa_fee TYPE NUMERIC(15,2);
