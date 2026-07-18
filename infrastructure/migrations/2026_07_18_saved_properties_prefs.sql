-- infrastructure/migrations/2026_07_18_saved_properties_prefs.sql
-- The Investor's Shelf — Task 1: saved_properties table + profiles.prefs jsonb.
-- CI migrations-dry-run wraps the whole file in one transaction; keep it
-- transactional-safe.
--
-- NOTE: verify the live app DB role name in /etc/oper.env on deploy. Repo
-- convention is `oper_app`; adjust the GRANT below if the live role differs.

CREATE TABLE IF NOT EXISTS saved_properties (
  id          bigserial PRIMARY KEY,
  -- `profiles.id` is TEXT (matches existing FK in 2026_07_12_api_keys.sql), not uuid.
  user_id     text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id  bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_properties_user ON saved_properties (user_id, created_at DESC);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_properties TO oper_app;
GRANT USAGE, SELECT ON SEQUENCE saved_properties_id_seq TO oper_app;
