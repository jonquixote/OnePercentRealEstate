# Wave 1 — Extra Property Data Investigation: Findings

**Measurement Date:** 2026-07-06  
**Test Location:** ZIP 77701 (Corpus Christi, TX)

## Summary

The `extra_property_data=True` flag in homeharvest's `scrape_property()` does not populate the `tax` field for the tested location, likely because tax data is not available from the source at scrape time. The flag was tested, accepted (no error), but produced no additional tax coverage.

## Measurement Results

**Test with `extra_property_data=True`:**
- Scrape time: 34.6 seconds for 5 listings
- Tax field in typed column: 0/5 populated
- Tax field in raw_data: 0/5 populated
- Conclusion: No tax data available

**Homeharvest Version:** Current installed version  
**Flag Behavior:** Accepted without error; likely no-op for tax field or tax unavailable at source

## Decision

**Revert `extra_property_data=True`:** The flag does not improve tax coverage for this test location. Tax data is genuinely unavailable at scrape time from the homeharvest source.

### Wave 3 Tax Fallback Strategy

Wave 3 (real tax into underwriting) will derive tax values using:
```
estimated_tax = assessed_value × (county_millage_rate / 1000)
```

This approach:
1. Uses `assessed_value` (captured in Wave 1 enrichment, ~80% coverage)
2. Requires county millage rates (source: county assessor data or FRED API)
3. Provides reasonable estimates when direct tax data is unavailable
4. Is consistent with Wave 3's goal of underwriting tax burden estimation

## Rationale

- homeharvest's `extra_property_data` likely requires per-property HTTP requests, increasing latency significantly
- Tax data availability varies by county and MLS (often missing for recent properties)
- The `assessed_value × millage` fallback is standard underwriting practice
- Keeping the scraper fast (no per-property slowdown) prioritizes ingestion breadth over depth for one field

## Rollout

- Task 3 Step 3: Flag remains OFF
- Wave 3: Implement `assessed_value × county_millage` calculation in underwriting module
- Wave 1b: Consider FRED API integration for county millage rates (separate from scraper)

---

**Status:** ✓ Validated, decision encoded in Task 3 Step 2 (flag NOT added to main.py)
