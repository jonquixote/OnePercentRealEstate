-- Wave 2: HUD Small Area FMR table. The v0 estimator's federal floor read
-- market_benchmarks, which has exactly 1 row — the HUD component of the
-- triangulation has been effectively dead. This table holds the real
-- ZIP x bedroom SAFMR matrix from huduser.gov (free, published per FY).
-- Loaded by services/ml_rent_estimator/load_hud_safmr.py.

CREATE TABLE IF NOT EXISTS hud_safmr (
  zip_code  TEXT    NOT NULL,
  bedrooms  INT     NOT NULL CHECK (bedrooms BETWEEN 0 AND 4),
  safmr     NUMERIC NOT NULL CHECK (safmr > 0),
  fy        INT     NOT NULL,
  PRIMARY KEY (zip_code, bedrooms, fy)
);

-- Lookup path is (zip, beds) -> newest fy.
CREATE INDEX IF NOT EXISTS idx_hud_safmr_lookup ON hud_safmr (zip_code, bedrooms, fy DESC);
