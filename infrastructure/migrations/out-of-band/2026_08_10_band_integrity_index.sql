-- Make the band-integrity assertion index-backed instead of a table scan.
--
-- ops/monitoring/rent-coverage.sh asserts four invariants about rent bands. The
-- query was a Parallel Seq Scan over the whole 11 GB table — 9.65 s, twice an
-- hour — to return a count that has been ZERO on every run since it was written.
-- A probe that costs more than what it protects is the exact failure mode the
-- monitoring work exists to prevent, and this one was mine.
--
-- The index predicate IS the violation, so it indexes only already-broken rows:
-- normally zero. It costs almost nothing to maintain, stays that size as the
-- table grows, and turns the check into an index probe.
--
-- OUT OF BAND: CREATE INDEX CONCURRENTLY cannot run inside a transaction and the
-- migration runner wraps every file in one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_band_violations
  ON listings (id)
  WHERE (rent_low IS NOT NULL) <> (rent_high IS NOT NULL)
     OR (rent_low IS NOT NULL AND rent_high <= rent_low)
     OR (rent_low IS NOT NULL AND estimated_rent NOT BETWEEN rent_low AND rent_high);
