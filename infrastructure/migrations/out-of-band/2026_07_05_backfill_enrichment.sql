-- OUT-OF-BAND: resumable, idempotent backfill of enrichment columns from the
-- raw_data JSONB we already store. Run AFTER 2026_07_05_listings_enrichment_columns.sql.
--
-- Safety (mirrors 2026_06_20_backfill_sale_type): marker = enrichment_backfilled_at
-- IS NULL; FOR UPDATE SKIP LOCKED; per-batch COMMIT; pg_sleep between batches.
-- NEVER writes estimated_rent / rent_calc_status / updated_at / price / listing_status
-- -> does not disturb the rent NOTIFY trigger or the listings_history trigger.
--
-- Usage:  CALL public.backfill_enrichment();            -- 5000/batch, 0.2s
--         CALL public.backfill_enrichment(10000, 0.1);

CREATE OR REPLACE PROCEDURE public.backfill_enrichment(
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
            SELECT id FROM public.listings
            WHERE enrichment_backfilled_at IS NULL
            ORDER BY id LIMIT p_batch
            FOR UPDATE SKIP LOCKED
        )
        UPDATE public.listings l
        SET county          = nullif(l.raw_data->>'county','')::text,
            fips_code       = nullif(l.raw_data->>'fips_code','')::text,
            neighborhoods   = nullif(l.raw_data->>'neighborhoods','')::text,
            last_sold_price = CASE WHEN l.raw_data->>'last_sold_price' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                   THEN (l.raw_data->>'last_sold_price')::numeric ELSE NULL END,
            last_sold_date  = CASE WHEN l.raw_data->>'last_sold_date' ~ '^\d{4}-\d{2}-\d{2}' THEN (l.raw_data->>'last_sold_date')::date ELSE NULL END,
            assessed_value  = CASE WHEN l.raw_data->>'assessed_value' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                   THEN (l.raw_data->>'assessed_value')::numeric ELSE NULL END,
            estimated_value = CASE WHEN l.raw_data->>'estimated_value' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                   THEN (l.raw_data->>'estimated_value')::numeric ELSE NULL END,
            description     = nullif(l.raw_data->>'text','')::text,
            style           = nullif(l.raw_data->>'style','')::text,
            new_construction= CASE WHEN l.raw_data->>'new_construction' IN ('true','false','t','f','yes','no','1','0') THEN (l.raw_data->>'new_construction')::boolean ELSE NULL END,
            list_date       = CASE WHEN l.raw_data->>'list_date' ~ '^\d{4}-\d{2}-\d{2}' THEN (l.raw_data->>'list_date')::date ELSE NULL END,
            price_per_sqft  = CASE WHEN l.raw_data->>'price_per_sqft' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                   THEN (l.raw_data->>'price_per_sqft')::numeric ELSE NULL END,
            hoa_fee         = CASE WHEN l.raw_data->>'hoa_fee' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                   THEN (l.raw_data->>'hoa_fee')::numeric ELSE NULL END,
            tax_annual_amount = CASE WHEN l.raw_data->>'tax' ~ '^\-?[0-9]+(\.[0-9]+)?$'
                                     THEN (l.raw_data->>'tax')::numeric ELSE NULL END,
            property_url    = nullif(l.raw_data->>'property_url','')::text,
            enrichment_backfilled_at = NOW()
        FROM batch WHERE l.id = batch.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_enrichment: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_enrichment complete: % rows', v_total;
END $$;
