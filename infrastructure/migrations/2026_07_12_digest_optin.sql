-- Tasks 2.1 & 2.2: saved-search daily digest + weekly ZIP market brief.
--
-- Adds the opt-in flag + last-sent stamp to saved_searches, a global
-- one-click opt-out flag on user_alert_prefs (reused from Wave 6 so the
-- worker can reach the recipient address), and a small scheduler-dedup
-- table so the digest worker can't double-send after a restart / clock skew.

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS email_digest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;

-- Global one-click opt-out. The unsubscribe route flips this for the user
-- in addition to clearing the per-search email_digest flag.
ALTER TABLE user_alert_prefs
  ADD COLUMN IF NOT EXISTS email_optout BOOLEAN NOT NULL DEFAULT false;

-- Scheduler dedup. One row per job kind records the last successful run
-- (UTC date). The worker gates the daily (14:00 UTC) and weekly
-- (Mon 14:00 UTC) jobs on these so a crash/restart can't re-send the same
-- day's email.
CREATE TABLE IF NOT EXISTS digest_runs (
  kind     TEXT PRIMARY KEY,                 -- 'daily' | 'weekly'
  last_run TIMESTAMPTZ NOT NULL DEFAULT now()
);
