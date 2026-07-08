-- OUT-OF-BAND: keyset-batched backfill of census_tract on rental_listings.
--
-- Mirror of 2026_07_07_backfill_census_tract.sql but for rental_listings,
-- which carries a `location` geometry (SRID 4326) so we join on that rather
-- than rebuilding a point from lat/lng. Marker: census_tract IS NULL AND
-- location IS NOT NULL. Idempotent, resumable, SKIP LOCKED so it never
-- deadlocks the live rental scrape upserts. Does NOT touch updated_at.
--
-- Run after 2026_07_09_rental_census_tract.sql (column + index) is applied:
--   docker exec infrastructure-postgres-1 psql -U postgres -d postgres \
--     -f /opt/onepercent/infrastructure/migrations/out-of-band/2026_07_09_backfill_rental_census_tract.sql
--   docker exec infrastructure-postgres-1 psql -U postgres -d postgres \
--     -c "CALL public.backfill_rental_census_tract();"

CREATE OR REPLACE PROCEDURE public.backfill_rental_census_tract(
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
            SELECT r.id, r.location
            FROM public.rental_listings r
            WHERE r.census_tract IS NULL
              AND r.location IS NOT NULL
            ORDER BY r.id
            LIMIT p_batch
            FOR UPDATE OF r SKIP LOCKED
        ),
        assigned AS (
            SELECT b.id, t.geoid
            FROM batch b
            JOIN public.census_tracts t
                ON ST_Contains(t.geom, b.location::geometry)
        )
        UPDATE public.rental_listings r
           SET census_tract = a.geoid
          FROM assigned a
         WHERE r.id = a.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_rental_census_tract: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN (SELECT COUNT(*) FROM public.rental_listings WHERE census_tract IS NULL AND location IS NOT NULL) = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_rental_census_tract complete: % rows', v_total;
END $$;
