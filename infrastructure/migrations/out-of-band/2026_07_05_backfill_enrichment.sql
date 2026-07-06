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
        ),
        cleaned AS (
            SELECT
                l.id,
                regexp_replace(l.raw_data->>'last_sold_price', '[^0-9.]', '', 'g') AS c_last_sold_price,
                regexp_replace(l.raw_data->>'assessed_value',  '[^0-9.]', '', 'g') AS c_assessed_value,
                regexp_replace(l.raw_data->>'estimated_value', '[^0-9.]', '', 'g') AS c_estimated_value,
                regexp_replace(l.raw_data->>'price_per_sqft',  '[^0-9.]', '', 'g') AS c_price_per_sqft,
                regexp_replace(l.raw_data->>'hoa_fee',         '[^0-9.]', '', 'g') AS c_hoa_fee,
                regexp_replace(l.raw_data->>'tax',             '[^0-9.]', '', 'g') AS c_tax,
                regexp_replace(l.raw_data->>'lot_sqft',        '[^0-9.]', '', 'g') AS c_lot_sqft
            FROM public.listings l
            JOIN batch b ON l.id = b.id
        )
        UPDATE public.listings l
        SET county          = nullif(l.raw_data->>'county','')::text,
            fips_code       = nullif(l.raw_data->>'fips_code','')::text,
            neighborhoods   = nullif(l.raw_data->>'neighborhoods','')::text,
            last_sold_price = CASE WHEN c.c_last_sold_price ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_last_sold_price::numeric ELSE NULL END,
            last_sold_date  = CASE WHEN l.raw_data->>'last_sold_date' ~ '^\d{4}-\d{2}-\d{2}$'
                                   THEN (l.raw_data->>'last_sold_date')::date ELSE NULL END,
            assessed_value  = CASE WHEN c.c_assessed_value ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_assessed_value::numeric ELSE NULL END,
            estimated_value = CASE WHEN c.c_estimated_value ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_estimated_value::numeric ELSE NULL END,
            description     = nullif(l.raw_data->>'text','')::text,
            style           = nullif(l.raw_data->>'style','')::text,
            new_construction= CASE WHEN l.raw_data->>'new_construction' IN ('true','false','t','f','yes','no','1','0')
                                   THEN (l.raw_data->>'new_construction')::boolean ELSE NULL END,
            list_date       = CASE WHEN l.raw_data->>'list_date' ~ '^\d{4}-\d{2}-\d{2}$'
                                   THEN (l.raw_data->>'list_date')::date ELSE NULL END,
            price_per_sqft  = CASE WHEN c.c_price_per_sqft ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_price_per_sqft::numeric ELSE NULL END,
            hoa_fee         = CASE WHEN c.c_hoa_fee ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_hoa_fee::numeric ELSE NULL END,
            tax_annual_amount = CASE WHEN c.c_tax ~ '^[0-9]+(\.[0-9]+)?$'
                                     THEN c.c_tax::numeric ELSE NULL END,
            property_url    = nullif(l.raw_data->>'property_url','')::text,
            parking_garage  = CASE WHEN l.raw_data->>'parking_garage' IN ('true','false','t','f','yes','no','1','0')
                                   THEN (l.raw_data->>'parking_garage')::boolean ELSE NULL END,
            lot_sqft        = CASE WHEN c.c_lot_sqft ~ '^[0-9]+(\.[0-9]+)?$'
                                   THEN c.c_lot_sqft::numeric ELSE NULL END,
            enrichment_backfilled_at = NOW()
        FROM cleaned c
        WHERE l.id = c.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_enrichment: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_enrichment complete: % rows', v_total;
END $$;
