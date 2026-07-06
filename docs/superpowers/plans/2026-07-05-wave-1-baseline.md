# Wave 1 — Free Data Harvest: Baseline & Acceptance Checks

## Task 0: Coverage Baseline (Before Enrichment)

**Date:** 2026-07-05  
**Baseline snapshot at start of implementation:**

```
 total  | hoa_col | hoa_raw | tax_col | tax_raw | url_col | url_raw 
--------+---------+---------+---------+---------+---------+---------
 944328 |       0 |  625577 |       0 |       0 |       0 |  944328
```

**Interpretation:**
- **hoa_col / hoa_raw:** 0 typed → 625,577 in raw_data (≈66% coverage)
- **tax_col / tax_raw:** 0 typed → 0 in raw_data (0% — tax unavailable at scrape time)
- **url_col / url_raw:** 0 typed → 944,328 in raw_data (≈100%)

This is the "before" state used to measure the success of Tasks 1–6.

---

## Task 1: Migration & Trigger Safety Check

### Task 1 Step 1 — Rent Trigger Verification

**SQL Query Results:**
(To be filled in when Task 1 Step 1 is run)

**Observation:**
(To be recorded — confirm fire condition, note if column-scoped or unqualified UPDATE)

---

## Task 1 Step 3 — Coverage View After Migration (Before Backfill)

**Command:**
```sql
SELECT * FROM vw_field_coverage;
```

**Results:**
(To be filled in when Task 1 Step 3 is run)

**Expected:** All `pct_*` near 0, `unenriched_rows = 944328`

---

## Task 4: Out-of-Band Backfill Results

### Task 4 Step 3 — Coverage After Backfill

**Command:**
```sql
SELECT * FROM vw_field_coverage;
```

**Results:**
(To be filled in when Task 4 Step 3 is run)

**Expected:**
- `unenriched_rows` → 0
- `pct_url` ≈ 100
- `pct_hoa` ≈ 60–66 (matches hoa_raw from baseline)
- `pct_est_value` ≈ 80
- `pct_last_sold` / `pct_county` per source availability

---

## Task 3: `extra_property_data` Findings

**File:** `docs/superpowers/plans/2026-07-05-wave-1-extra-data-findings.md`

(To be created with measured cost/payoff decision)

---

## Task 6: Final Acceptance Battery

(To be filled in when Task 6 Step 4 is run)

**Coverage final:**
```sql
SELECT * FROM vw_field_coverage;
```

**Fresh scrapes (last 30m):**
```sql
SELECT count(*) FILTER (WHERE property_url IS NOT NULL) url, 
       count(*) FILTER (WHERE hoa_fee IS NOT NULL) hoa 
FROM listings WHERE updated_at > now() - interval '30 min';
```

**History accruing:**
```sql
SELECT count(*) rows, count(DISTINCT listing_id) listings FROM listings_history;
```

**Scraper health:**
```bash
docker logs infrastructure-scraper-1 --since 10m 2>&1 | grep -ciE "error|status.*does not exist"
```

**App health:**
```bash
curl -s -o /dev/null -w "app:%{http_code}\n" http://localhost:3001/api/healthz
```

---

## Completion Summary

(To be filled in at end of all tasks)

- [ ] Task 0: Baseline captured
- [ ] Task 1: Migration applied
- [ ] Task 2: Scraper extraction wired
- [ ] Task 3: extra_property_data decision
- [ ] Task 4: Backfill complete
- [ ] Task 5: Trigger deployed
- [ ] Task 6: Final acceptance passed

**Final commit SHAs:** (to be added)
