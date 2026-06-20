-- OUT-OF-BAND: build the new dedupe unique index without blocking writes.
-- CONCURRENTLY cannot run inside a transaction, so this cannot be a normal
-- migration. Run AFTER the sale_type backfill and BEFORE the constraint-swap
-- migration 2026_06_21_listings_swap_unique_constraint.sql.
--
-- If a previous attempt failed it can leave an INVALID index; drop it first:
--   DROP INDEX CONCURRENTLY IF EXISTS listings_addr_type_saletype_uniq;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS listings_addr_type_saletype_uniq
    ON public.listings (address, listing_type, sale_type);
