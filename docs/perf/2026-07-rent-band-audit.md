# Rent Confidence Bands — Audit

**Date:** 2026-07-25 · **Plan:** `docs/superpowers/plans/2026-07-30-rent-confidence-and-triage.md` Task 2 Step 1

## The plan's premise was wrong. Twice.

Task 2 Step 1 asked *why* 40% of estimated active listings carry no band, and
offered two hypotheses: either the unbanded rows cluster in a `rent_model_version`
that never emitted quantiles (a re-scoring job), or they are spread evenly and
the band is being dropped in the write path (a bug). It said not to proceed
until we knew which.

**It is neither.**

### Step 1: not a model-version problem

```
   model_version   |   n    | banded
-------------------+--------+--------
 v1                | 403922 | 260200
 non_rentable_skip |  28720 |      0
 v0                |     19 |      0
```

The gap lives entirely *inside* `v1` — 143,722 of its rows are unbanded. So it
is not a stale model.

### Step 2: not a write-path bug either

The ML returns a band for these listings on demand. Taking listing 4654861,
which is stored with no band:

```
POST /predict       -> {"predicted_rent":3576.92,"rent_low":2818.44,"rent_high":4664.4,...}
POST /predict_batch -> {"results":[{"listing_id":4654861,"rent_low":2818.44,"rent_high":4664.4,...}]}
```

Both endpoints — including the batch endpoint the backlog drain actually uses —
return quantiles. Nothing is dropping them.

### The actual cause: the backfill simply has not reached them

`ops/db/backfill-rent-bands.sh` selects work with `ORDER BY id LIMIT`. So:

```
 banded |   n    | min_id  | max_id
--------+--------+---------+---------
 f      | 143799 | 3998196 | 5136534
 t      | 260200 |      13 | 5110067
```

Banded rows start at id 13. **Unbanded rows start at id 3,998,196.** The
backfill has walked the table in ascending id order and got as far as ~4M. The
120,000-row run on 2026-07-25 moved the unbanded population from 261,764 to
137,310 — the mechanism works exactly as designed and is simply unfinished.

The `census_tract` correlation that looked meaningful (99.999% of unbanded rows
lack one, versus 47% of banded) is an artifact of the same ordering: tract
enrichment also ran id-ascending, so both jobs share a watermark. It is not
causal — plenty of banded rows have no tract.

**There is no fix to write. There is a backfill to finish.**

## `bandFor` is not needed — the invariants already hold

Task 2 Steps 2–6 proposed a `bandFor()` guard rejecting degenerate, inverted,
half-populated and unsupported bands. Before building it, the question worth
asking is whether any of those failures actually occur. Across all 1,011,800
banded rows:

| Defect the guard would catch | Occurrences |
|---|---|
| `rent_high <= rent_low` (degenerate or inverted) | **0** |
| `rent_low` set but `rent_high` null | **0** |
| `rent_high` set but `rent_low` null | **0** |
| `estimated_rent` outside its own band | **0** |

Zero, on a million rows. The ML already guarantees these properties, and the
estimator stores whatever it returns without transforming it.

So `bandFor` would be an abstraction that prevents no failure that has ever
happened, added to a write path that is currently correct — and it would have to
be threaded through both the single-row and bulk paths to earn its keep. **Not
built.** YAGNI applies with force here.

What *is* worth having is the assertion itself, cheaply, so that if the model or
the write path ever changes we find out. That belongs in the coverage probe as a
band-integrity check, not in a new module.

## What Task 2 actually reduces to

1. Keep running `ops/db/backfill-rent-bands.sh` until the unbanded population
   reaches the irreducible floor.
2. State what that floor is and why, once reached.
3. Assert the four invariants above on a timer, so their zero stays zero.
