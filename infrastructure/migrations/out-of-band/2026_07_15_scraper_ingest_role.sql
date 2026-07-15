-- D1 (scraper-horizontal-scaling): least-privilege ingest role for scrapers
-- reaching the central DB directly over the private mesh (10.8.0.0/22).
-- Run as postgres on main. Password is set separately on the server
-- (ALTER ROLE oper_scraper PASSWORD '...') — never committed.
--
-- oper_rw already grants CRUD on all current+future public tables/sequences
-- (see 2026_07_12_db_roles.sql). Reusing it here keeps grants consistent
-- with the app/worker/ml roles instead of inventing a parallel grant set.
-- If tighter scope is wanted later (e.g. INSERT/UPDATE on listings-only
-- tables), swap this membership for explicit per-table GRANTs.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_scraper') THEN
    CREATE ROLE oper_scraper LOGIN IN ROLE oper_rw;
  END IF;
END $$;
