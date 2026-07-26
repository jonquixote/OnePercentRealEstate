-- Cold storage for listings nobody queries.
--
-- 772,904 of 1,340,486 rows (58.5%) are `stale`, in an 11 GB table (4,418 MB
-- heap + 1,428 MB indexes + TOAST). Every user-facing query filters them out;
-- every sequential scan still reads them.
--
-- THIS MIGRATION MOVES NO ROWS. It creates the destination and the indexes the
-- read-through needs, so the fallback can be deployed and exercised in
-- production against an EMPTY archive — where being wrong is free. Rows move
-- only after that, and only after a rehearsal on a restored snapshot.
--
-- Partitioning was ruled out in docs/perf/2026-07-hot-cold-decision.md: LIST
-- partitioning requires the partition key in every unique constraint, and
-- adding listing_status to listings_addr_type_saletype_uniq would permit the
-- same address to exist twice (once active, once stale) — breaking the
-- crawler's idempotent upsert. That remains ruled out.

-- Structural clone. A row must move between the tables without transformation,
-- so getProperty returns the same shape from either source.
CREATE TABLE IF NOT EXISTS listings_archive (LIKE listings INCLUDING DEFAULTS INCLUDING STORAGE);

-- Exactly two access patterns, and no others:
--   1. fetch one by id            — the property page read-through
--   2. find one by conflict key   — the crawler resurrecting a returning listing
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_archive_pkey
  ON listings_archive (id);
CREATE INDEX IF NOT EXISTS idx_listings_archive_conflict
  ON listings_archive (address, listing_type, sale_type);

-- Deliberately ABSENT: the geometry index, the lifecycle partial indexes, the
-- rent-status indexes. Archived rows are never searched, mapped, or ranked.
-- Recreating those indexes here would rebuild the exact cost this table exists
-- to remove.
