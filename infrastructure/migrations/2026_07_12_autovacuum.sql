-- S3 (backend-db-hardening): per-table autovacuum for the churn tables.
--
-- `mv_cluster_tiles` is rewritten by CONCURRENT refresh every few minutes and
-- carried ~180K dead tuples (11%); the default scale_factor=0.2 only triggers
-- at 20% dead. `listings` gets ~13K dead tuples per churn cycle. Tightening the
-- scale factors keeps n_dead_tup low without manual vacuums.
--
-- Placed in the auto-applied migrations dir (not out-of-band) so it is
-- reproducible on a fresh DB and exercised by the CI migrations dry-run.
-- Idempotent; safe to re-apply.
ALTER TABLE mv_cluster_tiles SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
ALTER TABLE listings SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
ALTER TABLE rental_listings SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
