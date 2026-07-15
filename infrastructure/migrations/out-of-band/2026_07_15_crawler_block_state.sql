-- OUT-OF-BAND: block-state singleton maintained by the crawl worker's block
-- circuit breaker (apps/worker/src/crawl.ts).
--
-- Why this exists
-- ---------------
-- The breaker RE-PENDS jobs that fail with an upstream Realtor.com block
-- (status back to 'pending') instead of marking them 'failed', so the ZIPs
-- retry automatically once the block lifts. A side effect is that the old
-- `crawler_health.auth_fail_15m` fingerprint (which counts status='failed'
-- rows whose error matches an auth/403/429 pattern) goes DARK during a
-- cool-off — there are no 'failed' rows to see. This table gives the
-- postgres-exporter `crawler_health` query a direct, breaker-authored block
-- signal (block_cooloff_active) so CrawlerBlockCooloff can still page while
-- the worker is paused waiting out a block.
--
-- Run by hand against prod:
--   psql "$DATABASE_URL" -f 2026_07_15_crawler_block_state.sql
CREATE TABLE IF NOT EXISTS crawler_block_state (
  id                 smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  blocked_at         timestamptz,
  cooloff_until      timestamptz,
  consecutive_blocks integer      NOT NULL DEFAULT 0,
  last_error         text,
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- Ensure the singleton row exists so UPDATE ... WHERE id = 1 always hits.
INSERT INTO crawler_block_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Least privilege: the worker maintains the row; the exporter reads it.
GRANT SELECT, INSERT, UPDATE ON crawler_block_state TO oper_worker;
GRANT SELECT ON crawler_block_state TO oper_exporter;
