CREATE TABLE IF NOT EXISTS fhfa_zip_hpi (
  zip5 TEXT NOT NULL,
  year INT NOT NULL,
  hpi REAL,
  annual_change_pct REAL,
  PRIMARY KEY (zip5, year)
);
