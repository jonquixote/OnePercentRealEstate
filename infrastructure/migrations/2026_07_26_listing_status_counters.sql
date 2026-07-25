-- Cheap counters for monitoring.
--
-- WHY: the Prometheus postgres-exporter ran
--   SELECT rent_calc_status, COUNT(*) FROM listings GROUP BY rent_calc_status
-- on every scrape. On 1.3M rows that is a full seq scan taking ~8.2s, and it
-- ran 3,034 times in ~25h: 25,012 seconds = **79% of ALL database execution
-- time in the window**, for a gauge nobody watches in real time.
--
-- The exporter now reads this 3-row table instead. It is refreshed on a timer
-- (oper-status-counters.timer), so the expensive GROUP BY runs a few times an
-- hour rather than a few times a minute.
--
-- DERIVED DATA: disposable, rebuildable, holds no source of truth.

CREATE TABLE IF NOT EXISTS listing_status_counters (
    metric      text        NOT NULL,
    label       text        NOT NULL,
    count       bigint      NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (metric, label)
);

COMMENT ON TABLE listing_status_counters IS
  'Precomputed monitoring counters. Replaces per-scrape full scans of listings (was 79% of DB time).';

-- Single pass over listings; refreshes every counter we expose.
CREATE OR REPLACE FUNCTION refresh_listing_status_counters()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO listing_status_counters (metric, label, count, updated_at)
    SELECT 'rent_calc_status', COALESCE(rent_calc_status, 'unknown'), count(*), now()
    FROM listings
    GROUP BY COALESCE(rent_calc_status, 'unknown')
    ON CONFLICT (metric, label)
    DO UPDATE SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at;

    INSERT INTO listing_status_counters (metric, label, count, updated_at)
    SELECT 'listing_status', COALESCE(listing_status, 'unknown'), count(*), now()
    FROM listings
    GROUP BY COALESCE(listing_status, 'unknown')
    ON CONFLICT (metric, label)
    DO UPDATE SET count = EXCLUDED.count, updated_at = EXCLUDED.updated_at;

    -- Drop labels that no longer exist so stale series don't linger.
    DELETE FROM listing_status_counters WHERE updated_at < now() - interval '1 hour';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oper_exporter') THEN
    EXECUTE 'GRANT SELECT ON listing_status_counters TO oper_exporter';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oper_app') THEN
    EXECUTE 'GRANT SELECT ON listing_status_counters TO oper_app';
  END IF;
END $$;

SELECT refresh_listing_status_counters();
