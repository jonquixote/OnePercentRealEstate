-- OUT-OF-BAND: re-classify existing rows after the classify_sale_type v2 change
-- (2026_06_20_classify_sale_type_v2.sql). Catches the structured
-- flags.is_foreclosure signal + plural/verb forms the v1 regex missed, and
-- populates sale_type_confidence.
--
-- Safety:
--   * keyset by bigint id, COMMIT per batch, pg_sleep between (resumable).
--   * only updates rows whose classification actually CHANGED (minimizes WAL).
--   * SKIPS rows whose source is 'homeharvest_flag' or 'manual_override' (the
--     foreclosure-pass flag and human overrides are ground truth — never
--     downgraded by a text re-scan).
--   * NEVER writes estimated_rent / rent_calc_status / updated_at — the rent
--     queue and rent NOTIFY trigger are untouched.
--
-- Usage:  CALL public.reclassify_sale_type();          -- 10k/batch, 0.1s sleep
--         CALL public.reclassify_sale_type(20000, 0.05);

CREATE OR REPLACE PROCEDURE public.reclassify_sale_type(
    p_batch INT DEFAULT 10000,
    p_sleep DOUBLE PRECISION DEFAULT 0.1
)
LANGUAGE plpgsql AS $$
DECLARE
    v_last BIGINT := 0;
    v_hi   BIGINT;
    v_rows INT;
    v_total BIGINT := 0;
BEGIN
    LOOP
        -- upper bound of the next id window
        SELECT max(id) INTO v_hi
        FROM (SELECT id FROM public.listings WHERE id > v_last ORDER BY id LIMIT p_batch) z;
        EXIT WHEN v_hi IS NULL;

        WITH cls AS (
            SELECT l.id,
                   c.sale_type,
                   c.sale_type_source,
                   c.sale_type_signal,
                   c.sale_type_confidence
            FROM public.listings l
            CROSS JOIN LATERAL public.classify_sale_type(l.raw_data, l.property_type) c
            WHERE l.id > v_last AND l.id <= v_hi
              AND coalesce(l.sale_type_source, '') NOT IN ('homeharvest_flag', 'manual_override')
        )
        UPDATE public.listings l
        SET sale_type            = cls.sale_type,
            sale_type_source     = cls.sale_type_source,
            sale_type_signal     = cls.sale_type_signal,
            sale_type_confidence = cls.sale_type_confidence
        FROM cls
        WHERE l.id = cls.id
          AND (l.sale_type            IS DISTINCT FROM cls.sale_type
            OR l.sale_type_source     IS DISTINCT FROM cls.sale_type_source
            OR l.sale_type_signal     IS DISTINCT FROM cls.sale_type_signal
            OR l.sale_type_confidence IS DISTINCT FROM cls.sale_type_confidence);

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        v_last := v_hi;
        COMMIT;

        RAISE NOTICE 'reclassify_sale_type: % changed up to id % (cumulative %)', v_rows, v_hi, v_total;
        PERFORM pg_sleep(p_sleep);
    END LOOP;

    RAISE NOTICE 'reclassify_sale_type complete: % rows changed', v_total;
END $$;
