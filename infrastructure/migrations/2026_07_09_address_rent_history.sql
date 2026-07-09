-- address_rent_history: durable rent memory for P2 prior-rent features.
-- One row per normalized address; upserted nightly by market_stats.refresh_address_rent_history().
-- The address normalization expression MUST match ADDRESS_NORM_SQL in market_stats.py
-- and the LAG partition in dataset.py TRAINING_SQL. Do not refactor.

CREATE TABLE IF NOT EXISTS address_rent_history (
    address_norm   TEXT PRIMARY KEY,
    zip_code       TEXT,
    last_rent      NUMERIC(10,2) NOT NULL,
    last_rent_date DATE NOT NULL,
    obs_count      INTEGER NOT NULL DEFAULT 1,
    updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arh_zip ON address_rent_history (zip_code);
