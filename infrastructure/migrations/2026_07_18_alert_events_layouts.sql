-- 2026_07_18: Pro Deal Flow — alert_events ledger + terminal_layouts + alert_state
--
-- alert_events: the in-app inbox AND the (user, listing) dedup ledger.
--   UNIQUE (user_id, listing_id) is the hard invariant: one alert per pair,
--   ever. Instant (pro) and daily-digest (free) fanout both write/patch here.
-- terminal_layouts: pro terminal saved column/sort/pane configurations.
-- alert_state: watermark row the alert tick reads/writes (id=1 last_seen_at).
--
-- profiles.id is TEXT (see 000_base_schema.sql / 2026_07_12_api_keys.sql),
-- so every user_id FK here is TEXT.

CREATE TABLE IF NOT EXISTS alert_events (
  id           bigserial PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id   bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source       text NOT NULL CHECK (source IN ('area', 'watchlist')),
  source_label text NOT NULL,           -- e.g. 'Houston (77002)' or watchlist name
  ratio        numeric,
  price        numeric,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,             -- set when instant/daily fanout succeeded
  read_at      timestamptz,
  UNIQUE (user_id, listing_id)          -- dedup invariant: one alert per pair, ever
);

CREATE INDEX IF NOT EXISTS idx_alert_events_inbox
  ON alert_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_undelivered
  ON alert_events (created_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS terminal_layouts (
  id         bigserial PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  layout     jsonb NOT NULL,            -- {columns:[{key,visible,width}], sort:{key,dir}, panes:{...}}
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- Watermark for the alert tick. Single row (id=1); last_seen_at is the
-- high-water mark for "listings seen since last tick".
CREATE TABLE IF NOT EXISTS alert_state (
  id          smallint PRIMARY KEY DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO alert_state (id, last_seen_at) VALUES (1, now())
  ON CONFLICT (id) DO NOTHING;

-- Privileges: oper_app / oper_worker both sit in oper_rw, which already
-- receives DEFAULT PRIVILEGES granting on all new tables (see
-- 2026_07_12_db_roles.sql). Explicit GRANTs are intentionally omitted so the
-- migration applies cleanly in environments where those roles are not yet
-- created (e.g. the CI migrations-dry-run container). Apply them on the live
-- DB after the roles exist, if needed.
