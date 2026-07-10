-- EPA Smart Location Database v3 — National Walkability Index per block group.
-- Source: https://edap-ecf.s3.us-west-2.amazonaws.com/docsets/smartlocation/SmartLocationDBv3.csv
CREATE TABLE IF NOT EXISTS epa_walkability (
  geoid_bg TEXT PRIMARY KEY,
  natwalkind REAL,
  d2a_ephhm REAL,
  d3b REAL,
  d4a REAL
);

CREATE OR REPLACE VIEW tract_walkability AS
SELECT left(geoid_bg, 11) AS geoid, avg(natwalkind) AS natwalkind
FROM epa_walkability
GROUP BY 1;
