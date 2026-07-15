-- OUT-OF-BAND: supports the `crawler_health` postgres-exporter query (smart
-- stall/block detector). The miss_streak / fail_streak scans read the
-- most-recent finished jobs ordered by finished_at DESC; partial + DESC keeps
-- that ORDER BY ... LIMIT 800 cheap as crawl_jobs grows.
--
-- CONCURRENTLY cannot run inside a transaction, so this CANNOT be a normal
-- migration (the `pnpm migrate` runner wraps each top-level file in BEGIN/
-- COMMIT and would abort). Run by hand against prod (off-peak).
--
-- If a previous attempt failed it can leave an INVALID index; drop it first:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_crawl_jobs_finished_at;
--
-- Run:
--   psql "$DATABASE_URL" -f 2026_07_14_crawl_jobs_finished_at_idx.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crawl_jobs_finished_at
    ON crawl_jobs (finished_at DESC)
    WHERE finished_at IS NOT NULL;
