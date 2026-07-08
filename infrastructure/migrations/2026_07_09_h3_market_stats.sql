-- h3_market_stats — precomputed local rent/sold $/sqft surface at H3 res-8
-- (~0.7 km² hexes), the "how does this compare with prices nearby" signal
-- for rent model v2 P1. Refreshed nightly by services/ml_rent_estimator/
-- market_stats.py (Python-side H3; NO Postgres h3 extension is installed).
--
-- stat_month = the month the stats DESCRIBE (data drawn from that month).
-- Leakage rule enforced by the reader: training joins the month strictly
-- before a row's listing_date; serving uses the latest complete month.
CREATE TABLE IF NOT EXISTS h3_market_stats (
  h3_8         TEXT NOT NULL,
  stat_month   DATE NOT NULL,
  med_rent_psf REAL,
  n_rent       INT  NOT NULL DEFAULT 0,
  med_sold_psf REAL,
  n_sold       INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (h3_8, stat_month)
);
CREATE INDEX IF NOT EXISTS idx_h3_market_stats_month ON h3_market_stats(stat_month);
