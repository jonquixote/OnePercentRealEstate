-- NOTE: This migration is ENTIRELY REDUNDANT. The columns and view already
-- exist in 2026_07_05_listings_enrichment_columns.sql (added via amendment to
-- that migration after it was created). IF NOT EXISTS + DROP IF EXISTS make it
-- a harmless no-op. Kept for historical continuity — it documents the real
-- sequence of development on the wave/1-data-harvest branch. If the amended
-- 07_05 already ran on a given database, this file can be skipped.
--
-- Wave 1 follow-up: originally intended to add parking_garage and lot_sqft
-- columns and refresh the coverage view to track them.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS parking_garage BOOLEAN,
  ADD COLUMN IF NOT EXISTS lot_sqft       NUMERIC;

DROP VIEW IF EXISTS vw_field_coverage;
CREATE VIEW vw_field_coverage AS
SELECT
  count(*)                                                             AS total,
  round(100.0 * count(hoa_fee)          / nullif(count(*),0), 1)       AS pct_hoa,
  round(100.0 * count(tax_annual_amount)/ nullif(count(*),0), 1)       AS pct_tax,
  round(100.0 * count(property_url)     / nullif(count(*),0), 1)       AS pct_url,
  round(100.0 * count(county)           / nullif(count(*),0), 1)       AS pct_county,
  round(100.0 * count(estimated_value)  / nullif(count(*),0), 1)       AS pct_est_value,
  round(100.0 * count(last_sold_price)  / nullif(count(*),0), 1)       AS pct_last_sold,
  round(100.0 * count(description)      / nullif(count(*),0), 1)       AS pct_description,
  round(100.0 * count(parking_garage)   / nullif(count(*),0), 1)       AS pct_parking_garage,
  round(100.0 * count(lot_sqft)         / nullif(count(*),0), 1)       AS pct_lot_sqft,
  count(*) FILTER (WHERE enrichment_backfilled_at IS NULL)             AS unenriched_rows
FROM listings;
