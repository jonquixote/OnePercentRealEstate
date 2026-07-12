-- X4: Partner API keys.
-- `profiles.id` is TEXT (see 000_base_schema.sql), so `user_id` is TEXT to keep
-- the FK valid. Keys are stored only as a sha256 hash of the bearer token; the
-- raw key is shown to the user exactly once at creation time and never persisted.
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);
