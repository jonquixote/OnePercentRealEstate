-- OUT-OF-BAND (read-only): post-backfill audit. Run after the backfill +
-- constraint swap to confirm the data is coherent.

\echo '== sale_type distribution =='
SELECT sale_type, sale_type_source, count(*) AS listings
FROM public.listings
GROUP BY sale_type, sale_type_source
ORDER BY listings DESC;

\echo '== rows reclassified off standard =='
SELECT count(*) AS non_standard
FROM public.listings
WHERE sale_type <> 'standard';

\echo '== rows still unprocessed (address_hash IS NULL) =='
SELECT count(*) AS unprocessed
FROM public.listings
WHERE address_hash IS NULL;

\echo '== address_hash collisions across >1 distinct address (review for dedupe) =='
SELECT address_hash, count(*) AS rows, count(DISTINCT address) AS distinct_addresses
FROM public.listings
WHERE address_hash IS NOT NULL
GROUP BY address_hash
HAVING count(*) > 1 AND count(DISTINCT address) > 1
ORDER BY rows DESC
LIMIT 50;

\echo '== same address_hash carrying multiple sale_types (expected coexistence) =='
SELECT address_hash, count(*) AS rows, array_agg(DISTINCT sale_type) AS sale_types
FROM public.listings
WHERE address_hash IS NOT NULL
GROUP BY address_hash
HAVING count(DISTINCT sale_type) > 1
ORDER BY rows DESC
LIMIT 50;
