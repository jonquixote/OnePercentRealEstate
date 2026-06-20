-- 2026_06_20_listings_sale_type_column.sql
-- First-class distress sale types on the (3.5 GB) listings table, with provenance
-- and address-identity columns. Large-table discipline:
--   * sale_type: NOT NULL DEFAULT 'standard' — a CONSTANT default is catalog-only
--     in PG16 (no table rewrite, instant).
--   * provenance + address columns: nullable, NO default — backfilled out-of-band.
--   * CHECK added NOT VALID (metadata-only, instant); VALIDATE runs out-of-band
--     under a weaker lock (see out-of-band/2026_06_20_validate_sale_type_check.sql).
--   * NO indexes here — all index builds are CONCURRENTLY + out-of-band.

BEGIN;

ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS sale_type TEXT NOT NULL DEFAULT 'standard';

-- provenance: why a row carries its sale_type
ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS sale_type_source     TEXT,        -- text_classifier | homeharvest_flag | manual_override
    ADD COLUMN IF NOT EXISTS sale_type_confidence NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS sale_type_signal     TEXT;        -- matched phrase / reason

-- address identity hygiene (canonical display + dedupe across sale types)
ALTER TABLE public.listings
    ADD COLUMN IF NOT EXISTS address_norm TEXT,
    ADD COLUMN IF NOT EXISTS address_hash TEXT;

-- Allowed sale_type values. NOT VALID so the add is instant; existing rows are
-- all 'standard' (the column default) so a later VALIDATE is a formality.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.listings'::regclass
          AND conname = 'listings_sale_type_chk'
    ) THEN
        ALTER TABLE public.listings
            ADD CONSTRAINT listings_sale_type_chk
            CHECK (sale_type IN ('standard','foreclosure','pre_foreclosure','reo','auction','short_sale'))
            NOT VALID;
    END IF;
END $$;

COMMIT;
