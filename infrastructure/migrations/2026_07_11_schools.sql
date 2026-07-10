-- NCES EDGE public school locations.
-- Source: https://nces.ed.gov/programs/edge/geographic/schoollocations
CREATE TABLE IF NOT EXISTS schools (
  ncessch TEXT PRIMARY KEY,
  name TEXT,
  level TEXT,
  geom GEOMETRY(Point, 4326)
);
CREATE INDEX IF NOT EXISTS idx_schools_geom ON schools USING GIST (geom);
