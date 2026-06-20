-- OUT-OF-BAND: validate the sale_type CHECK added NOT VALID by
-- 2026_06_20_listings_sale_type_column.sql. VALIDATE takes only a
-- SHARE UPDATE EXCLUSIVE lock (does not block reads or writes). Run after the
-- backfill so every row is one of the allowed values.

ALTER TABLE public.listings VALIDATE CONSTRAINT listings_sale_type_chk;
