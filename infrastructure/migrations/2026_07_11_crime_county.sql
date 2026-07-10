CREATE TABLE IF NOT EXISTS crime_county (
  fips TEXT NOT NULL,
  year INT NOT NULL,
  violent_per_100k REAL,
  property_per_100k REAL,
  agencies_reporting INT,
  PRIMARY KEY (fips, year)
);
