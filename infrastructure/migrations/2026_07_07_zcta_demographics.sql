CREATE TABLE IF NOT EXISTS zcta_demographics (
  zcta              TEXT NOT NULL,
  acs_year          INT  NOT NULL,
  median_hh_income  NUMERIC,
  median_gross_rent NUMERIC,
  median_home_value NUMERIC,
  population        NUMERIC,
  vacant_units      NUMERIC,
  total_units       NUMERIC,
  PRIMARY KEY (zcta, acs_year)
);
