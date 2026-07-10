CREATE TABLE IF NOT EXISTS transit_stops (
  feed TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  route_types INT[] NOT NULL DEFAULT '{}',
  geom GEOMETRY(Point, 4326) NOT NULL,
  PRIMARY KEY (feed, stop_id)
);
CREATE INDEX IF NOT EXISTS idx_transit_stops_geom ON transit_stops USING GIST (geom);
