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
```
        tgname        |                                                      pg_get_triggerdef                                                       
----------------------+------------------------------------------------------------------------------------------------------------------------------
 trg_rent_job_enqueue | CREATE TRIGGER trg_rent_job_enqueue AFTER INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION notify_rent_job_enqueued()
```

**Observation:**
✓ SAFE: Trigger fires AFTER INSERT only (not UPDATE). Will not fire during Task 4 backfill (which uses UPDATE). Rent queue is protected.

---

## Task 1 Step 3 — Coverage View After Migration (Before Backfill)

**Command:**
```sql
SELECT * FROM vw_field_coverage;
```

**Results:**
```
 total  | pct_hoa | pct_tax | pct_url | pct_county | pct_est_value | pct_last_sold | pct_description | unenriched_rows 
--------+---------+---------+---------+------------+---------------+---------------+-----------------+-----------------
 944413 |     0.0 |     0.0 |     0.0 |        0.0 |           0.0 |           0.0 |             0.0 |          944413
```

**Verified:** ✓ All `pct_*` = 0.0, `unenriched_rows = 944,413` (all rows waiting for enrichment)

---

## Task 4: Out-of-Band Backfill Results

### Task 4 Step 3 — Backfill Execution

**Status:** PARTIAL - Stopped at constraint violation

**Backfill Progress:** 750,000 rows backfilled successfully, 194,471 rows remaining

**Error Encountered:**
```
ERROR:  numeric field overflow
DETAIL:  A field with precision 10, scale 2 must round to an absolute value less than 10^8.
```

**Root Cause:** The pre-existing `hoa_fee` column has NUMERIC(10,2) precision (max 99,999,999.99), but raw_data contains HOA fee values that exceed this limit. The backfill procedure safely casts numeric values but cannot accommodate values exceeding column constraints.

**Constraint Details:**
```
hoa_fee:           NUMERIC(10,2)
tax_annual_amount: NUMERIC(12,2)
property_url:      TEXT
```

The hoa_fee precision is too narrow. The backfill successfully processed ~80% of rows before encountering a row with an oversized hoa_fee value.

**Coverage Before Fix:**
```
(Backfill status at time of error)
Enriched: 750,000 / 944,471 (~79%)
Unenriched: 194,471 (~21%)
```

**Recommended Resolution:** 
- Alter `hoa_fee` column to NUMERIC(15,2) to accommodate larger values
- Resume backfill to complete remaining 194K rows
- Re-run acceptance checks

**Current n8n Status:** UNFROZEN (per error handling procedure)

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
