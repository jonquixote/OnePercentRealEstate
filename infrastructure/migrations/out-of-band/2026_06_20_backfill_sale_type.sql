-- OUT-OF-BAND: resumable, idempotent, batched backfill of address identity +
-- sale_type classification for existing listings. Run AFTER
-- 2026_06_20_listings_sale_type_column.sql.
--
-- Safety: only touches rows where address_hash IS NULL (the "not yet processed"
-- marker), commits per batch, sleeps between batches, and NEVER writes
-- estimated_rent / rent_calc_status / updated_at — the 606k-row rent queue and
-- the rent NOTIFY trigger are left alone. Re-run freely; it continues where it left off.
--
-- Usage:
--   CALL public.backfill_sale_type();            -- defaults: 5000/batch, 0.2s sleep
--   CALL public.backfill_sale_type(10000, 0.1);

CREATE OR REPLACE PROCEDURE public.backfill_sale_type(
    p_batch INT DEFAULT 5000,
    p_sleep DOUBLE PRECISION DEFAULT 0.2
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rows  INT;
    v_total BIGINT := 0;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id
            FROM public.listings
            WHERE address_hash IS NULL
            ORDER BY id
            LIMIT p_batch
            FOR UPDATE SKIP LOCKED
        ),
        cls AS (
            SELECT b.id,
                   c.sale_type,
                   c.sale_type_source,
                   c.sale_type_signal,
                   NULLIF(
                       regexp_replace(
                           regexp_replace(lower(trim(coalesce(l.address, ''))), '[.,#]', '', 'g'),
                           '\s+', ' ', 'g'
                       ),
                   '') AS anorm,
                   l.city,
                   l.state
            FROM batch b
            JOIN public.listings l ON l.id = b.id
            CROSS JOIN LATERAL public.classify_sale_type(l.raw_data, l.property_type) c
        )
        UPDATE public.listings l
        SET sale_type        = cls.sale_type,
            sale_type_source = cls.sale_type_source,
            sale_type_signal = cls.sale_type_signal,
            address_norm     = cls.anorm,
            address_hash     = md5(
                coalesce(cls.anorm, '') || '|' ||
                coalesce(lower(cls.city), '') || '|' ||
                coalesce(lower(cls.state), '')
            )
        FROM cls
        WHERE l.id = cls.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;

        RAISE NOTICE 'backfill_sale_type: % rows this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;

    RAISE NOTICE 'backfill_sale_type complete: % rows total', v_total;
END $$;
