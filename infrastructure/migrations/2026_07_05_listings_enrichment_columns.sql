-- Wave 1: typed columns for homeharvest fields we already fetch but discard.
-- All adds are nullable + default-less => metadata-only, no table rewrite on
-- the ~940K-row listings table (safe inside the runner's single txn).

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS county            TEXT,
  ADD COLUMN IF NOT EXISTS fips_code         TEXT,
  ADD COLUMN IF NOT EXISTS neighborhoods     TEXT,
  ADD COLUMN IF NOT EXISTS last_sold_price   NUMERIC,
  ADD COLUMN IF NOT EXISTS last_sold_date    DATE,
  ADD COLUMN IF NOT EXISTS assessed_value    NUMERIC,
  ADD COLUMN IF NOT EXISTS estimated_value   NUMERIC,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS style             TEXT,
  ADD COLUMN IF NOT EXISTS new_construction  BOOLEAN,
  ADD COLUMN IF NOT EXISTS list_date         DATE,
  ADD COLUMN IF NOT EXISTS price_per_sqft    NUMERIC,
  -- backfill marker: NULL = not yet enriched from raw_data (Task 4 uses it).
  ADD COLUMN IF NOT EXISTS enrichment_backfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parking_garage      BOOLEAN,
  ADD COLUMN IF NOT EXISTS lot_sqft            NUMERIC;
-- hoa_fee, tax_annual_amount, property_url already exist (empty) — populated,
-- not added.

-- Coverage observability. Pinned as a VIEW (spec §Wave1 item6) — it is the
-- input to the Wave 7 raw_data retention gate. Percentages of non-null typed
-- columns vs what raw_data carries, so we can prove extraction completeness
-- before anything is discarded.
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
