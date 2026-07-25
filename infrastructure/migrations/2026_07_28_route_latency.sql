-- Per-route latency, persisted as periodic aggregates.
--
-- One row per route per flush window (5 min), NEVER one row per request. The
-- app holds a bounded in-memory ring and writes only the summary, so traffic
-- volume does not translate into write volume. This matters here: the
-- postgres-exporter's per-scrape query once consumed 79% of all database time,
-- and monitoring that becomes the load problem is the failure mode this whole
-- effort exists to avoid.

CREATE TABLE IF NOT EXISTS route_latency_samples (
  id          bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  route       text        NOT NULL,
  p50_ms      double precision NOT NULL,
  p95_ms      double precision NOT NULL,
  p99_ms      double precision NOT NULL,
  max_ms      double precision NOT NULL,
  count       integer     NOT NULL
);

-- The only read pattern is "trailing window, newest first, optionally by route".
CREATE INDEX IF NOT EXISTS idx_route_latency_captured
  ON route_latency_samples (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_latency_route_captured
  ON route_latency_samples (route, captured_at DESC);

-- Retention: 30 days. Without this the table grows forever at
-- (routes x 288 flushes/day) and quietly becomes another cold-data problem.
CREATE OR REPLACE FUNCTION prune_route_latency_samples() RETURNS integer AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM route_latency_samples WHERE captured_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;
