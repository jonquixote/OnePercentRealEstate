# Rent Coverage Audit (2026-07-28)

Task 1 of `docs/superpowers/plans/2026-07-28-rent-coverage.md`. **Audit only** —
the plan deliberately measured before fixing, and the measurement changed the fix.

## Headline: the "10% unscored" number was mostly correct behaviour

Of **44,564 active listings with no rent estimate**:

| Cause | Count | Verdict |
|---|---|---|
| **Not a rentable property type** (land, lots, farms) | **41,700 (94%)** | ✅ **Correct** — these must not have a rent |
| `rent_calc_status='failed'` | 2,599 | ⚠️ real gap |
| `done` but `estimated_rent` null | 256 | 🐛 the status contradiction |
| Missing `sqft` | 24 | ⚠️ input gap |
| Missing `bedrooms` | 2 | ⚠️ input gap |

**The real coverage gap is ~2,881 listings (0.6% of active), not 10%.** The
plan's premise was wrong, and it would have driven a large pointless backfill.

Sampled failures are dominated by **`missing lat/lon`** — listings that arrive
un-geocoded. That is an ingestion/geocoding issue, not a model issue.

## The real problem: confidence bands

Among **active, rentable, scored** listings:

| | Count | Share |
|---|---|---|
| Has `rent_low`/`rent_high` | 141,303 | 35% |
| **No band** | **261,764** | **65%** |

### Root cause: legacy rows, not a broken path

- Both groups span the same dates, geography and rent levels — not staleness.
- Both are `rent_model_version='v1'` — not a version split.
- Every current write path emits a band: `/predict` and `/predict_batch` both
  return `rent_low`/`rent_high`, and the SQL fallbacks only null-out
  non-rentables or mark no-geo rows failed.
- **Verified against the live ML service** with a listing that currently has no
  band stored:

```json
{"predicted_rent":2021.57,"model_version":"v1","rent_low":1625.08,"rent_high":2321.36}
```

So these rows were estimated **before bands were wired into the write path** and
were never recomputed. Re-enqueuing them through the existing estimator queue
fixes it — no code change, no model change.

### Why it matters

`apps/one/src/lib/rent-trust.ts` grades every estimate `trusted | wide |
implausible` and the deal page renders a p10–p90 band. Without one, the product
shows a single confident-looking number it cannot qualify — the opposite of what
the trust work set out to do.

## Action taken

`ops/db/backfill-rent-bands.sh` — batched, paced, idempotent and resumable,
routed through the existing queue so crawl ingestion is never starved.

**First tranche verified on prod:** 5,000 enqueued → drained in <4 min → banded
count rose 141,303 → 146,303 (exactly +5,000), crawl unaffected (17 jobs
completed in the same window).

## Still open

- **2,599 failed** — dominated by missing lat/lon. Needs a geocoding backfill or
  a terminal "cannot geocode" status; retrying into the same wall is pointless.
- **256 `done`-but-null** — `done` does not imply `estimated`, so the status
  column is not a trustworthy coverage signal. Worth a dedicated fix
  (plan Task 2) before anyone builds on that column.
