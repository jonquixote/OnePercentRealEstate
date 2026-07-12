-- backend-db-hardening review follow-up fixes. Run as postgres.
-- Idempotent; safe to re-run. Addresses review findings:
--   * BLOCKER: rent_predictions_audit_id_seq ended up OWNED BY the _old table
--     after the shadow-swap; dropping _old later would cascade-drop the
--     sequence and break live INSERTs. Re-point ownership to the live table.
--   * NIT: stale shadow-swap object names (rent_predictions_audit_new_pkey /
--     _new_listing_id_fkey) are a trap for a future DROP INDEX — rename to
--     canonical, pushing the old table's copies to _old_*.
--   * NIT: mv_cluster_tiles autovacuum scale_factor was 0.05; plan S3 asks 0.02.

-- 1) sequence ownership (BLOCKER)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    JOIN pg_class s ON s.oid = d.objid
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE s.relname = 'rent_predictions_audit_id_seq'
      AND d.deptype = 'a'
      AND t.relname = 'rent_predictions_audit_old'
  ) THEN
    ALTER SEQUENCE rent_predictions_audit_id_seq OWNED BY rent_predictions_audit.id;
    RAISE NOTICE 'sequence ownership re-pointed to live table';
  ELSE
    RAISE NOTICE 'sequence already owned by live table; nothing to do';
  END IF;
END $$;

-- 2) canonicalize shadow-swap index names
DO $$
DECLARE
  v_tbl text;
BEGIN
  SELECT t.relname INTO v_tbl
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_class t ON t.oid = i.indrelid
  WHERE c.relname = 'rent_predictions_audit_pkey';
  IF v_tbl = 'rent_predictions_audit_old' THEN
    EXECUTE 'ALTER INDEX rent_predictions_audit_pkey RENAME TO rent_predictions_audit_old_pkey';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'rent_predictions_audit_new_pkey') THEN
    EXECUTE 'ALTER INDEX rent_predictions_audit_new_pkey RENAME TO rent_predictions_audit_pkey';
  END IF;

  SELECT t.relname INTO v_tbl
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_class t ON t.oid = i.indrelid
  WHERE c.relname = 'rent_predictions_audit_listing_id_fkey';
  IF v_tbl = 'rent_predictions_audit_old' THEN
    EXECUTE 'ALTER INDEX rent_predictions_audit_listing_id_fkey RENAME TO rent_predictions_audit_old_listing_id_fkey';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'rent_predictions_audit_new_listing_id_fkey') THEN
    EXECUTE 'ALTER INDEX rent_predictions_audit_new_listing_id_fkey RENAME TO rent_predictions_audit_listing_id_fkey';
  END IF;
END $$;

-- 2b) The FK constraint itself also kept the _new_ name on the parent + every
--     partition (ALTER TABLE parent RENAME CONSTRAINT does not cascade to
--     partitions in this PG version). Rename on the parent and each partition.
DO $$
DECLARE
  p text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'rent_predictions_audit_new_listing_id_fkey'
               AND conrelid = 'rent_predictions_audit'::regclass) THEN
    EXECUTE 'ALTER TABLE rent_predictions_audit RENAME CONSTRAINT rent_predictions_audit_new_listing_id_fkey TO rent_predictions_audit_listing_id_fkey';
  END IF;
  FOR p IN SELECT inhrelid::regclass::text FROM pg_inherits
           WHERE inhparent = 'rent_predictions_audit'::regclass LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'rent_predictions_audit_new_listing_id_fkey'
                 AND conrelid = p::regclass) THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT rent_predictions_audit_new_listing_id_fkey TO rent_predictions_audit_listing_id_fkey', p);
    END IF;
  END LOOP;
  RAISE NOTICE 'FK constraint rename done (wherever it still carried _new_)';
END $$;

-- 3) mv_cluster_tiles autovacuum -> plan S3 value (0.02)
ALTER TABLE mv_cluster_tiles SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

-- 4) Least-privilege tighten (review finding): oper_ml must NOT hold CREATE
--    on schema public. The ML service only INSERT/UPDATEs pre-existing tables
--    (rent_predictions, rent_models); one-off seed/migration scripts run as
--    postgres. The roles migration originally granted CREATE by mistake.
REVOKE CREATE ON SCHEMA public FROM oper_ml;

