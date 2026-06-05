-- Wave 6: watchlists + alerts infrastructure

CREATE TABLE IF NOT EXISTS watchlists (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query_json JSONB NOT NULL,           -- structured filter (price band, geo, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_evaluated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists (user_id);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  watchlist_id BIGINT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('new_match', 'price_drop')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  sent_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, listing_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_alerts_unsent ON alerts (created_at DESC) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS user_alert_prefs (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  webhook_url TEXT,
  digest_only BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
