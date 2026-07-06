-- OUT-OF-BAND: one-time fix-up for rows already backfilled where formatted
-- numeric values (e.g., "$210,000", "1,234.56") were silently set to NULL
-- by the strict regex in the original backfill_enrichment procedure.
--
-- The strict regex '^[0-9]+(\.[0-9]+)?$' rejects values with currency
-- symbols or thousands separators. The Python _num() helper handles these
-- correctly (strips non-numeric chars), so the live scraper path works but
-- the historical backfill missed these rows.
--
-- Only touches rows WHERE enrichment_backfilled_at IS NOT NULL (already
-- backfilled) AND at least one numeric field was probably missed (raw_data
-- contains $ or ,).
--
-- Idempotent: COALESCE preserves existing non-NULL values. Safe to re-run.

WITH candidates AS (
    SELECT id FROM public.listings
    WHERE enrichment_backfilled_at IS NOT NULL
      AND (
        (last_sold_price  IS NULL AND raw_data->>'last_sold_price' ~ '[\$,]')
        OR (assessed_value  IS NULL AND raw_data->>'assessed_value'  ~ '[\$,]')
        OR (estimated_value IS NULL AND raw_data->>'estimated_value' ~ '[\$,]')
        OR (price_per_sqft  IS NULL AND raw_data->>'price_per_sqft'  ~ '[\$,]')
        OR (hoa_fee         IS NULL AND raw_data->>'hoa_fee'         ~ '[\$,]')
        OR (tax_annual_amount IS NULL AND raw_data->>'tax'           ~ '[\$,]')
        OR (lot_sqft        IS NULL AND raw_data->>'lot_sqft'        ~ '[\$,]')
      )
),
cleaned AS (
    SELECT
        c.id,
        regexp_replace(l.raw_data->>'last_sold_price', '[^0-9.]', '', 'g') AS c_last_sold_price,
        regexp_replace(l.raw_data->>'assessed_value',  '[^0-9.]', '', 'g') AS c_assessed_value,
        regexp_replace(l.raw_data->>'estimated_value', '[^0-9.]', '', 'g') AS c_estimated_value,
        regexp_replace(l.raw_data->>'price_per_sqft',  '[^0-9.]', '', 'g') AS c_price_per_sqft,
        regexp_replace(l.raw_data->>'hoa_fee',         '[^0-9.]', '', 'g') AS c_hoa_fee,
        regexp_replace(l.raw_data->>'tax',             '[^0-9.]', '', 'g') AS c_tax,
        regexp_replace(l.raw_data->>'lot_sqft',        '[^0-9.]', '', 'g') AS c_lot_sqft
    FROM candidates c
    JOIN public.listings l ON l.id = c.id
)
UPDATE public.listings l
SET
    last_sold_price    = COALESCE(l.last_sold_price,
        CASE WHEN cl.c_last_sold_price ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_last_sold_price::numeric END),
    assessed_value     = COALESCE(l.assessed_value,
        CASE WHEN cl.c_assessed_value ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_assessed_value::numeric END),
    estimated_value    = COALESCE(l.estimated_value,
        CASE WHEN cl.c_estimated_value ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_estimated_value::numeric END),
    price_per_sqft     = COALESCE(l.price_per_sqft,
        CASE WHEN cl.c_price_per_sqft ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_price_per_sqft::numeric END),
    hoa_fee            = COALESCE(l.hoa_fee,
        CASE WHEN cl.c_hoa_fee ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_hoa_fee::numeric END),
    tax_annual_amount  = COALESCE(l.tax_annual_amount,
        CASE WHEN cl.c_tax ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_tax::numeric END),
    lot_sqft           = COALESCE(l.lot_sqft,
        CASE WHEN cl.c_lot_sqft ~ '^[0-9]+(\.[0-9]+)?$'
             THEN cl.c_lot_sqft::numeric END)
FROM cleaned cl
WHERE l.id = cl.id;
