-- Task AL1: screen alerts — the Pro-terminal retention hook.
--
-- One alert row per terminal screen. `enabled` is the "Alert me" toggle; the
-- digest worker compiles the screen's query-lang expression server-side,
-- bounds it to listings newer than `last_run_at`, and emails new matches
-- inside the user's existing one-email-per-day digest (capped at 6 listings).
-- A malformed expression flips `enabled` back to false on the worker side.
--
-- `screen_id` is the FK to terminal_screens (cascade delete) and the primary
-- key, so a screen has at most one alert (toggle = insert/update/disable).
-- The (user_id, enabled) index serves the worker's "enabled alerts per user"
-- scan and the `claim_anon_identity` re-key.

CREATE TABLE IF NOT EXISTS screen_alerts (
  screen_id   BIGINT PRIMARY KEY REFERENCES terminal_screens(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  cadence     TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('instant', 'daily')),
  last_run_at TIMESTAMPTZ,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screen_alerts_user_enabled
  ON screen_alerts (user_id, enabled);
