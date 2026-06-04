-- 2026_06_03_crawl_jobs_notify.sql
-- Wave 2: replace n8n's 30s polling loop with PG NOTIFY → Node worker LISTEN.
-- Average job pickup latency drops from ~15s to <1s.
--
-- The trigger fires AFTER INSERT on rows that arrive as 'pending'. The
-- channel is `crawl_job_enqueued` and the payload is the row id as text
-- (PG NOTIFY payloads are limited to 8KB; we keep it tiny on purpose).
-- The worker re-reads the row via SELECT/UPDATE so we never trust the
-- payload as authoritative state.
--
-- This trigger COEXISTS with the existing `recycle_stuck_jobs()` safety
-- net (defined in 000_base_schema.sql) and the
-- `trigger_recycle_crawl_jobs` recycle-on-completion trigger (defined in
-- infrastructure/job_recycle_trigger.sql) — neither is replaced here.

CREATE OR REPLACE FUNCTION notify_crawl_job_enqueued()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('crawl_job_enqueued', NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crawl_job_notify ON crawl_jobs;

CREATE TRIGGER trg_crawl_job_notify
  AFTER INSERT ON crawl_jobs
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION notify_crawl_job_enqueued();
