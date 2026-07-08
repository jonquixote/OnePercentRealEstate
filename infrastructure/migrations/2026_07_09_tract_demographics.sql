-- tract-level ACS demographics — the fine-grained income anchor for rent
-- model v2 P1 (tract_med_income_log) and the 5-yr growth features (P3).
-- geoid = state(2)+county(3)+tract(6) = 11 digits, matching census_tracts.geoid.
CREATE TABLE IF NOT EXISTS tract_demographics (
  geoid             TEXT NOT NULL,
  acs_year          INT  NOT NULL,
  median_hh_income  NUMERIC,
  median_gross_rent NUMERIC,
  median_home_value NUMERIC,
  population        NUMERIC,
  PRIMARY KEY (geoid, acs_year)
);
