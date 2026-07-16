-- The 1% Rule Index: one immutable row per (metro, month).
CREATE TABLE IF NOT EXISTS index_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  metro_slug    TEXT NOT NULL,
  metro_label   TEXT NOT NULL,
  month         DATE NOT NULL,                 -- first day of the snapshot month (UTC)
  live_count    INT  NOT NULL DEFAULT 0,       -- live rentable priced listings in the metro
  clearing_count INT NOT NULL DEFAULT 0,      -- of those, how many clear >= 1%
  pct_clearing  NUMERIC(6,5) NOT NULL DEFAULT 0, -- fraction 0..1
  median_ratio  NUMERIC(7,6),                  -- median rent/price (fraction), nullable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_index_snapshots_metro_month
  ON index_snapshots (metro_slug, month);
CREATE INDEX IF NOT EXISTS idx_index_snapshots_month ON index_snapshots (month DESC);

-- Separate opt-in for the monthly "State of the 1% Rule" authority email,
-- decoupled from search-alert consent (email_optout / email_digest).
ALTER TABLE user_alert_prefs
  ADD COLUMN IF NOT EXISTS index_email_optin BOOLEAN NOT NULL DEFAULT false;
