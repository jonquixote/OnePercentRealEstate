# Wave Progress

## Wave 0 — Bleed-Stop (Shipped: 2026-07-06)
- ML circuit breaker + error taxonomy (TDD, 10 tests)
- 171K stranded rent rows re-pended (fire-drill: 60x throughput, 0 mass-fails)
- Postgres tuned for 15GB/2-core host + pg_stat_statements
- n8n audit + tested freeze switch (scoped-window policy)
- Secrets rotation runbook (FRED gates Wave 3)
- pg_dump nightly backup with rotation + tested restore (943K rows, 233s RTO)
- Git history purged of leaked secrets

## Wave 1 — Free Data Harvest (Shipped: 2026-07-06)
- 13 enrichment columns added to `listings` (county, fips_code, neighborhoods, last_sold_price, last_sold_date, assessed_value, estimated_value, description, style, new_construction, list_date, price_per_sqft) + parking_garage + lot_sqft
- `vw_field_coverage` observability view
- `extract_enrichment()` pure-function mapping (TDD, 5 tests)
- Backfilled 945K existing rows from `raw_data` (resumable, rent-queue-safe)
- `extra_property_data` decision: keep OFF (tax unavailable at scrape time; Wave 3 uses assessed_value × county millage)
- `listings_history` trigger + t0 seed (price/status/DOM changes)
- Dead `status` column dropped
- Default `_num()` to reject negative values (last_sold_price, assessed_value, estimated_value, price_per_sqft, hoa_fee, tax_annual_amount)
- WHERE clause expanded: enrichment-only re-scrapes now update the row

**Coverage (end of Wave 1):**
| Field | Coverage |
|---|---|
| property_url | 100.0% |
| county | 99.9% |
| description | 98.9% |
| estimated_value | 81.4% |
| hoa_fee | 66.2% |
| last_sold_price | 53.3% |
| tax_annual_amount | 0.0% (source limitation) |
| parking_garage | 0.0% (source limitation, mostly rentals) |
| lot_sqft | 4.0% |

## Wave 1b — External Sources (Deferred)
- Census ACS demographics
- FEMA flood zones
- FRED mortgage rate (owned by Wave 3)

## Wave 2 — Rent Engine (Shipped: 2026-07-06)
- v1 LightGBM model (3 quantile heads, 11 features from 306K comps)
- HUD SAFMR ingest: 193K rows / 38K ZIPs (FY2026)
- ML service: `/predict` + `/predict_batch` (vectorized, cap 1000)
- Async rent worker: batch drain (~200 rows/s, 6 concurrent, circuit breaker)
- ml-scheduler: nightly retrain (01:00), drift (02:00), eval (Sun 03:00)
- Promotion gate: v1 MAE ≤85% of HUD baseline + ≥10/15 state wins
- `rent_models` registry, `rent_predictions_audit` audit trail
- `rent_low`/`rent_high` confidence bands (p10–p90, coverage 0.77)
- Backlog cleared from 613K to <32K (target <10K, still draining)
- `estimated_rent=0` → NULL migration applied
- Drift monitoring live (5 features, PSI)
- Bugs fixed: `feature_set_hash` determinism, `promoted_at`, HUD SAFMR FY filter, drift/eval module paths

**Performance:**
- v1 MAE $484 (37% better than HUD $768)
- 15/15 states beat HUD baseline
- Batch throughput ~200 rows/s (4× target)
- Band coverage 76.8% (within acceptable range)

## Future Waves
- Wave 3: Real tax via assessed_value × county millage
- Wave 4: Investor surfaces (price-cut UI)
- Wave 5: Track P
- Wave 6: Filters
- Wave 7: raw_data retention
