-- A3 (backend-db-hardening): least-privilege service roles.
-- Run as postgres. Passwords are set separately on the server
-- (ALTER ROLE ... PASSWORD '...') — never committed.
--
-- Model: two grant tiers, four login roles. Fine-grained per-table lists
-- would rot with every migration; the real win is ending superuser-
-- everywhere (no DROP anything, no ALTER SYSTEM, no COPY FROM PROGRAM,
-- no extension creation from a compromised service).
--
--   oper_rw  (group): CRUD on all current+future public tables/sequences,
--                     EXECUTE on functions.
--   oper_ro  (group): SELECT + EXECUTE only.
--   oper_app      IN oper_rw   — Next.js app
--   oper_worker   IN oper_rw   — all TS workers
--   oper_ml       IN oper_rw   — ML service (CRUD via oper_rw; no CREATE/DDL)
--   oper_tileserv IN oper_ro   — pg_tileserv (tiles are read-only by definition)
--
-- Migrations/backups continue to run as postgres.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_rw') THEN CREATE ROLE oper_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_ro') THEN CREATE ROLE oper_ro NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_app') THEN CREATE ROLE oper_app LOGIN IN ROLE oper_rw; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_worker') THEN CREATE ROLE oper_worker LOGIN IN ROLE oper_rw; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_ml') THEN CREATE ROLE oper_ml LOGIN IN ROLE oper_rw; END IF;
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_tileserv') THEN CREATE ROLE oper_tileserv LOGIN IN ROLE oper_ro; END IF;
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_exporter') THEN CREATE ROLE oper_exporter LOGIN IN ROLE oper_ro; END IF;
END $$;

-- oper_exporter reads cluster-wide stats for postgres-exporter (pg_stat_statements,
-- pg_stat_*, replication). It must NOT write. pg_monitor grants the read privileges
-- it needs; it is also a member of oper_ro for table reads.
GRANT pg_monitor TO oper_exporter;

GRANT USAGE ON SCHEMA public TO oper_rw, oper_ro;

-- Existing objects
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oper_rw;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO oper_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO oper_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oper_ro;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO oper_ro;

-- Future objects created by postgres (migrations, loaders run as postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oper_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO oper_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO oper_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO oper_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO oper_ro;

-- Note: oper_ml gets NO CREATE. It only writes to pre-existing tables
-- (rent_predictions, rent_models) created by migrations run as postgres.
-- One-off seed/migration scripts (seed_counties.py, migrate_phase6.py) run
-- as postgres, never as oper_ml, so least-privilege holds end-to-end.
