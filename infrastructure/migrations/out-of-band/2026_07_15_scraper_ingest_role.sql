-- Least-privilege ingest role for the scraper fleet. Scrapers run on the most-
-- exposed nodes (public egress to Realtor.com), so oper_scraper gets ONLY the
-- ingest surface it actually writes: the three listings tables (INSERT + ON
-- CONFLICT UPDATE + SELECT for dupe checks) and their id sequences. It is
-- deliberately NOT a member of oper_rw (which has CRUD on the whole app schema)
-- and has NO default privileges, so a new table never auto-becomes writable by a
-- compromised scraper node. Password is set separately on the server
-- (ALTER ROLE oper_scraper PASSWORD ...), never committed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oper_scraper') THEN
    CREATE ROLE oper_scraper LOGIN;
  END IF;
END $$;

GRANT INSERT, UPDATE, SELECT ON listings, rental_listings, sold_listings TO oper_scraper;

-- Grant USAGE on each table's id sequence (works whether serial or identity).
DO $$
DECLARE seq text;
BEGIN
  FOR seq IN
    SELECT pg_get_serial_sequence(t, 'id')
      FROM unnest(ARRAY['listings', 'rental_listings', 'sold_listings']) AS t
     WHERE pg_get_serial_sequence(t, 'id') IS NOT NULL
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO oper_scraper', seq);
  END LOOP;
END $$;
