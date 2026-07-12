-- S2 (backend-db-hardening): partition rent_predictions_audit by month.
--
-- Run as postgres. Safety gate (confirmed before applying):
--   ls /var/backups/oper/ && rclone lsf oper-r2:onepercent-pg-backups | tail -1
-- Both the local nightly dump and its R2 copy exist.
--
-- Why: 1.79M rows, 859MB, 0 index scans ever — a write-only audit log that
-- grows without bound. Native monthly partitioning lets a systemd timer archive
-- and drop months older than the 90-day retention window (see oper-audit-rotate).
--
-- Method (shadow-table swap, atomic rename with catch-up so no live write is
-- lost): build rent_predictions_audit_new (partitioned, PK now (id, created_at)
-- because a partitioned PK must contain the partition key), backfill, then in one
-- transaction lock the source, copy any rows written during backfill, and
-- rename-swap. The original stays as rent_predictions_audit_old for a week.

DO $$
DECLARE
  v_kind char;
  v_month date;
  v_from text;
  v_to   text;
BEGIN
  SELECT c.relkind INTO v_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'rent_predictions_audit' AND n.nspname = 'public';

  IF v_kind = 'p' THEN
    RAISE NOTICE 'rent_predictions_audit already partitioned; nothing to do.';
    RETURN;
  END IF;

  -- 1) new partitioned table. Reuse the existing id sequence so values stay
  --    monotonic with live inserts; PK must include the partition key.
  CREATE TABLE rent_predictions_audit_new (
    id BIGINT NOT NULL DEFAULT nextval('rent_predictions_audit_id_seq'),
    listing_id BIGINT REFERENCES listings(id) ON DELETE CASCADE,
    model_version TEXT NOT NULL,
    predicted_rent NUMERIC(10,2) NOT NULL,
    features JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    shadow_version TEXT,
    shadow_predicted_rent NUMERIC(10,2),
    PRIMARY KEY (id, created_at)
  ) PARTITION BY RANGE (created_at);

  -- 2) monthly partitions (covers 2026-05 .. 2027-06) + a DEFAULT backstop.
  FOR v_month IN
    SELECT generate_series('2026-05-01'::date, '2027-06-01'::date, '1 month')
  LOOP
    v_from := to_char(v_month, 'YYYY-MM-01');
    v_to   := to_char(v_month + interval '1 month', 'YYYY-MM-01');
    EXECUTE format(
      'CREATE TABLE rent_predictions_audit_p%s PARTITION OF rent_predictions_audit_new
         FOR VALUES FROM (%L) TO (%L)',
      to_char(v_month, 'YYYY_MM'), v_from, v_to);
  END LOOP;
  EXECUTE 'CREATE TABLE rent_predictions_audit_p_default PARTITION OF rent_predictions_audit_new DEFAULT';

  -- 3) local indexes (one per partition) — replace the two old global indexes.
  CREATE INDEX idx_rpa_listing ON rent_predictions_audit_new (listing_id, created_at DESC);
  CREATE INDEX idx_rpa_version ON rent_predictions_audit_new (model_version, created_at DESC);

  -- 4) one-time backfill. Source stays writable (ACCESS SHARE only); rows
  --    written during this window are caught up at the swap below.
  INSERT INTO rent_predictions_audit_new
    (id, listing_id, model_version, predicted_rent, features, created_at,
     shadow_version, shadow_predicted_rent)
  SELECT id, listing_id, model_version, predicted_rent, features, created_at,
         shadow_version, shadow_predicted_rent
  FROM rent_predictions_audit;

  -- 5) atomic swap: block writers briefly, catch up, rename.
  LOCK TABLE rent_predictions_audit IN ACCESS EXCLUSIVE MODE;
  INSERT INTO rent_predictions_audit_new
    (id, listing_id, model_version, predicted_rent, features, created_at,
     shadow_version, shadow_predicted_rent)
  SELECT o.id, o.listing_id, o.model_version, o.predicted_rent, o.features,
         o.created_at, o.shadow_version, o.shadow_predicted_rent
  FROM rent_predictions_audit o
  LEFT JOIN rent_predictions_audit_new n ON n.id = o.id
  WHERE n.id IS NULL;

  ALTER TABLE rent_predictions_audit RENAME TO rent_predictions_audit_old;
  ALTER TABLE rent_predictions_audit_new RENAME TO rent_predictions_audit;

  RAISE NOTICE 'swap complete; old table kept as rent_predictions_audit_old.';
END $$;

-- Sanity: new live table count should equal the old count.
SELECT
  (SELECT count(*) FROM rent_predictions_audit)        AS live_rows,
  (SELECT count(*) FROM rent_predictions_audit_old)    AS old_rows,
  (SELECT count(*) FROM rent_predictions_audit
     WHERE created_at < now() - interval '90 days')    AS rows_older_than_90d;
