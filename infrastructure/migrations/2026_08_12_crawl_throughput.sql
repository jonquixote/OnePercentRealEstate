-- Per-job crawl throughput, denominated in CONFIRMATIONS.
--
-- The freshness SLO counts listings whose last_seen_at is recent. A listing is
-- confirmed when a scrape returns it and the upsert advances last_seen_at —
-- which happens on insert, or on update when the row changed or has not been
-- refreshed for a day (services/scraper_service/main.py bounds that to once per
-- day to cap write amplification, so `skipped` means "already fresh today").
--
-- So: confirmations = inserted + updated.
--
-- crawl_jobs.listings_found has only ever stored `inserted`, which is the small
-- minority. Updates — the bulk of confirmation work — were recorded nowhere, so
-- "did that change help?" could only be answered by hand-querying listings.
-- Two such hand reconstructions were wrong this session.

ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS rows_returned  integer;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS rows_confirmed integer;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS duration_ms    integer;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS blocked        boolean NOT NULL DEFAULT false;
-- What was actually asked for, so a throughput number can be attributed to a
-- shape and its parameters rather than guessed at later.
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS shape          text;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS past_days      integer;

-- The only read pattern: "throughput over a trailing window", newest first.
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_finished
  ON crawl_jobs (finished_at DESC) WHERE finished_at IS NOT NULL;
