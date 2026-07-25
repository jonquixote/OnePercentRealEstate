-- Precomputed homepage hero stats.
--
-- The /api/stats aggregate seq-scans ~1.3M listings rows and measured 18.5s
-- cold on prod. With a 120s cache TTL and no request coalescing, a real user
-- paid that cost every couple of minutes while everyone else queued behind
-- them. This table holds the computed result so the request path is a single
-- primary-key lookup.
--
-- DERIVED DATA: safe to TRUNCATE/DROP and rebuild at any time. Holds no source
-- of truth. One row per strategy (buy_hold | brrrr | flip | str).

CREATE TABLE IF NOT EXISTS stats_summary (
    strategy    text        PRIMARY KEY,
    payload     jsonb       NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stats_summary IS
  'Precomputed homepage hero stats, one row per strategy. Derived/disposable; refreshed out of the request path.';

-- The app role reads it; the refresh path writes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oper_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON stats_summary TO oper_app';
  END IF;
END $$;
