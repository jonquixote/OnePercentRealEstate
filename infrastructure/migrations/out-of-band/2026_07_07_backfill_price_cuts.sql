-- OUT-OF-BAND: keyset-batched backfill of price-cut facts from
-- listings_history. The single-statement version deadlocked against live
-- scraper upserts (lock-order collision on listings rows); this procedure
-- takes small batches with FOR UPDATE SKIP LOCKED + per-batch COMMIT, the
-- same proven shape as backfill_enrichment.
--
-- Marker: first_list_price IS NULL AND the row has history. Idempotent,
-- resumable. Does NOT touch rent columns or updated_at, and does not fire
-- trg_listings_history (that trigger is scoped to price/status/DOM columns).
--
-- Usage: CALL public.backfill_price_cuts();          -- 5000/batch, 0.1s sleep

CREATE OR REPLACE PROCEDURE public.backfill_price_cuts(
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
            SELECT l.id, l.price
            FROM public.listings l
            WHERE l.first_list_price IS NULL
              AND EXISTS (SELECT 1 FROM public.listings_history h
                           WHERE h.listing_id = l.id AND h.price IS NOT NULL)
            ORDER BY l.id
            LIMIT p_batch
            FOR UPDATE OF l SKIP LOCKED
        ),
        firsts AS (
            SELECT b.id, b.price AS current_price,
                   (SELECT h.price FROM public.listings_history h
                     WHERE h.listing_id = b.id AND h.price IS NOT NULL
                     ORDER BY h.observed_at ASC LIMIT 1) AS first_price,
                   (SELECT count(*) FROM (
                       SELECT h.price < lag(h.price) OVER (ORDER BY h.observed_at) AS step_down
                       FROM public.listings_history h
                       WHERE h.listing_id = b.id AND h.price IS NOT NULL
                   ) s WHERE s.step_down) AS cut_count
            FROM batch b
        )
        UPDATE public.listings l
           SET first_list_price = f.first_price,
               price_cut_count  = COALESCE(f.cut_count, 0)::int,
               price_cut_pct    = CASE
                                    WHEN f.first_price > 0 AND f.current_price < f.first_price
                                    THEN round((f.first_price - f.current_price) / f.first_price, 4)
                                  END
          FROM firsts f
         WHERE l.id = f.id AND f.first_price IS NOT NULL;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_price_cuts: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_price_cuts complete: % rows', v_total;
END $$;
