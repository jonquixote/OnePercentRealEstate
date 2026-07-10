CREATE TABLE IF NOT EXISTS bls_county_laus (
  fips TEXT NOT NULL,
  period DATE NOT NULL,
  unemployment_rate REAL,
  PRIMARY KEY (fips, period)
);
