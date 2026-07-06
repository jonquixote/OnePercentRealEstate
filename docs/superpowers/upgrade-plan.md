# Upgrade Plan — Status

## Design Spec
`docs/superpowers/specs/2026-07-05-full-upgrade-v2-design.md`

## Waves

| Wave | Status | Plan | Notes |
|------|--------|------|-------|
| 0 | **Shipped** | `docs/superpowers/plans/2026-07-05-wave-0-bleed-stop.md` | Bleed-stop: ML breaker, backups, PG tuning, n8n freeze |
| 1 | **Shipped** | `docs/superpowers/plans/2026-07-05-wave-1-data-harvest.md` | Free data harvest: enrichment columns, backfill, history trigger, drop dead status |
| 1b | Deferred | — | External sources (Census ACS, FEMA floods, FRED rates) |
| 2 | Planned | — | estimated_rent=0 → NULL |
| 3 | Planned | — | Real tax via assessed_value × county millage (gated on FRED key) |
| 4 | Planned | — | Investor surfaces (price-cut UI) |
| 5 | Planned | — | Track P |
| 6 | Planned | — | Filters |
| 7 | Planned | — | raw_data retention gate |

## Key Decisions Log
- **extra_property_data=False** (2026-07-06): Flag does NOT populate `tax` at scrape time. 4× crawl slowdown, zero benefit. Wave 3 uses assessed_value × county millage.
- **External sources deferred to Wave 1b** (2026-07-05): Census/FEMA/FRED are independent subsystems with their own rate-limit/failure modes. Not bundled with core harvest.
- **hoa_fee widened to NUMERIC(15,2)** (2026-07-06): Original NUMERIC(10,2) overflowed on ~195K rows during backfill.
- **parking_garage + lot_sqft added** (2026-07-06): Missing from initial Wave 1 migration; added via follow-up.
- **_num() rejects negative values** (2026-07-06): Backfill regex and `_num()` helper now reject negative values for monetary fields (price/sqf/HOA/tax).
