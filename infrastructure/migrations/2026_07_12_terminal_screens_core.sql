CREATE TABLE IF NOT EXISTS terminal_screens (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expression TEXT NOT NULL DEFAULT '',      -- query-lang source (re-compiled server-side on exec)
  columns JSONB NOT NULL DEFAULT '[]',      -- ordered column ids (W2 applies ordering)
  sort JSONB,                                -- {col, dir}
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_terminal_screens_user ON terminal_screens (user_id, position);
