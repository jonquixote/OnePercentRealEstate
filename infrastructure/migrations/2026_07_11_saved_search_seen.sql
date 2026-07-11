-- Saved-search freshness (frontend overhaul D3): stamp when the user last
-- opened a saved search so the UI can badge "new since you looked".
ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now();
