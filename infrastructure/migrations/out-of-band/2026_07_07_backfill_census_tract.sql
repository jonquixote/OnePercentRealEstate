-- OUT-OF-BAND: keyset-batched backfill of census_tract on listings.
--
-- Marker: census_tract IS NULL AND latitude IS NOT NULL. Idempotent, resumable.
-- Does NOT touch rent columns or updated_at, and does not fire trg_listings_history.
--
-- Usage after census_tracts table is populated + index is created:
--   CALL public.backfill_census_tract();           -- 5000/batch, 0.1s sleep
--
-- Measured per-row cost of ST_Contains on one ZIP first (spec B3 §3); if
-- the query is too slow at scrape-time, this OOB batch is the primary path
-- for tract assignment.

CREATE OR REPLACE PROCEDURE public.backfill_census_tract(
    p_batch INT DEFAULT 5000,
    p_sleep DOUBLE PRECISION DEFAULT 0.1
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rows  INT;
    v_total BIGINT := 0;
BEGIN
    LOOP
        WITH batch AS (
            SELECT l.id, l.latitude, l.longitude
            FROM public.listings l
            WHERE l.census_tract IS NULL
              AND l.latitude IS NOT NULL
              AND l.longitude IS NOT NULL
            ORDER BY l.id
            LIMIT p_batch
            FOR UPDATE OF l SKIP LOCKED
        ),
        assigned AS (
            SELECT b.id, t.geoid
            FROM batch b
            JOIN public.census_tracts t
                ON ST_Contains(t.geom, ST_SetSRID(ST_MakePoint(b.longitude::float, b.latitude::float), 4326))
        )
        UPDATE public.listings l
           SET census_tract = a.geoid
          FROM assigned a
         WHERE l.id = a.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_census_tract: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_census_tract complete: % rows', v_total;
END $$;
