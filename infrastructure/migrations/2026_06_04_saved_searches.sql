-- Wave 5 deferred: minimal saved searches table
CREATE TABLE IF NOT EXISTS saved_searches (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  params JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON saved_searches (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_searches_user_name
  ON saved_searches (user_id, name);

COMMENT ON TABLE saved_searches IS 'Wave 5: minimal saved search functionality. Hardening will follow in Wave 8 (proper auth).';
