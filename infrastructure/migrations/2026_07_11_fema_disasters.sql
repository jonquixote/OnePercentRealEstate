CREATE TABLE IF NOT EXISTS fema_disasters (
  fips TEXT NOT NULL,
  fy INT NOT NULL,
  incident_type TEXT NOT NULL,
  declarations INT NOT NULL,
  PRIMARY KEY (fips, fy, incident_type)
);
