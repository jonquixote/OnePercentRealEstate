-- 2026_06_21_listings_swap_unique_constraint.sql
-- Change the dedupe key (address, listing_type) -> (address, listing_type, sale_type)
-- so a distress row can coexist with the standard row at the same address instead
-- of overwriting it via ON CONFLICT.
--
-- The backing unique index MUST be built CONCURRENTLY out-of-band BEFORE this runs:
--   infrastructure/migrations/out-of-band/2026_06_21_create_unique_index_concurrently.sql
-- Swapping via USING INDEX makes the constraint add metadata-only (brief lock),
-- avoiding a full index build under ACCESS EXCLUSIVE on the 3.5 GB table.

BEGIN;

DO $$
DECLARE
    v_idx_exists   BOOLEAN;
    v_old_name     TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = 'listings_addr_type_saletype_uniq' AND relkind = 'i'
    ) INTO v_idx_exists;

    IF NOT v_idx_exists THEN
        RAISE EXCEPTION
            'Missing unique index listings_addr_type_saletype_uniq. Build it out-of-band first (CREATE UNIQUE INDEX CONCURRENTLY) — see infrastructure/migrations/out-of-band/2026_06_21_create_unique_index_concurrently.sql';
    END IF;

    -- Idempotency: if the new constraint already exists, nothing to do.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.listings'::regclass
          AND conname = 'listings_addr_type_saletype_uniq'
    ) THEN
        RAISE NOTICE 'listings_addr_type_saletype_uniq already present; skipping swap';
        RETURN;
    END IF;

    -- Find the existing unique constraint on exactly (address, listing_type), by
    -- column set rather than a hardcoded name.
    SELECT c.conname INTO v_old_name
    FROM pg_constraint c
    WHERE c.conrelid = 'public.listings'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      ) = ARRAY['address','listing_type']::name[]
    LIMIT 1;

    IF v_old_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.listings DROP CONSTRAINT %I', v_old_name);
    END IF;

    EXECUTE 'ALTER TABLE public.listings ADD CONSTRAINT listings_addr_type_saletype_uniq UNIQUE USING INDEX listings_addr_type_saletype_uniq';
END $$;

COMMIT;
