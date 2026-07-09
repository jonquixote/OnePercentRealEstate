# Rent Model v2 — Hyperlocal Location, Property History, Temporal Demographics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rent model accurate *within* ZIP codes — resolve micro-location (tract/block scale), exploit each property's own sale/rent history, and anchor to how local incomes and rents have moved over time.

**Architecture:** Keep the LightGBM p10/p50/p90 quantile trio and the metadata-driven feature builder (`ml_rent_estimator/dataset.py` is the single feature truth for train + serve). Add three independent signal families in gated phases: (1) hierarchical location target-encodings (tract + H3 hexes) plus a precomputed local price surface, (2) per-property history (last sale, prior observed rent), (3) temporal anchors (multi-year HUD SAFMR, multi-vintage ACS). Each phase retrains, must pass the eval gate (now including a split-ZIP benchmark), and promotes via the existing atomic artifact swap.

**Tech Stack:** LightGBM (existing), `h3` (new Python dep, pure-wheel), PostGIS (existing), Census ACS API (key already in server `.env`), HUD SAFMR public files, pandas.

## Global Constraints

- **No paid APIs.** Census, HUD, TIGER, FRED only (locked project decision).
- **Self-hosted:** 2-core / 15 GB VPS; ML container capped at **4 G** (see `docs/DEPLOYMENT_STATE_2026-07-08.md` §3) — training must stay under ~10 min wall / 3 GB RSS.
- **`dataset.py` stays the one feature truth.** Serving builds vectors only via it; no feature logic in `model_store.py`.
- **Feature registry is append-only.** Never rename or repurpose a feature name; new features append to `FEATURE_NAMES`.
- **Serve-side compatibility invariant (incident 2026-07-08):** new code must be able to serve an *older* model artifact. Vectors are emitted in the *artifact's* `metadata.feature_names` order, and a feature-count preflight guards every predict.
- **Leakage discipline:** every history/aggregate feature must use only data strictly *before* the training row's `listing_date`; TE/encoders fit on the train fold only (existing pattern); the address-hash 90/10 split stays.
- **Large-table discipline:** backfills use keyset batches, never touch `updated_at` on `listings`, never run wholesale UPDATEs inside the txn migration runner (out-of-band dir for those).
- Deploy per `docs/DEPLOYMENT_STATE_2026-07-08.md` §4 (rsync → `deploy.sh build <svc>` → `up -d --no-deps <svc>`; verify app image CMD trap §8).

---

## 0. Why (evidence)

ZIP **90004** (user ground truth): Hancock Park west of Van Ness, Koreatown east — same ZIP, ~10× price spread; within Hancock Park, Rossmore vs Gower differ ~5×. Our own data agrees: 90004 spans **16 census tracts** whose tract-median asking prices run **$1.5 M → $5.0 M** and tract-median estimated rents **$3.1 K → $9.2 K**. The v1 model's only location signals are `zip_te` (one smoothed mean per ZIP — identical for Hancock Park and Koreatown) and raw lat/lng tree splits (a national tree budget spends almost nothing per LA neighborhood). HUD SAFMR is also ZIP-level. So within split ZIPs both the model and HUD flatline at the ZIP mean: west side underestimated, east side overestimated.

What we already hold (measured 2026-07-08):

| Asset | State | Use |
|---|---|---|
| `rental_listings` | 385,578 rows, **2026-06-02 → now** (5 weeks), 13,382 ZIPs, `location` geometry, amenity flags | training set (v1 trains on this); history accrues from here |
| repeat addresses | 118,669 addresses with ≥2 observations | prior-rent features (thin today, compounding) |
| `listings.census_tract` | 99.4% backfilled | tract features for serving |
| `rental_listings.census_tract` | **does not exist** | Phase 1 backfill |
| `last_sold_price/date` in raw_data | **520,629** for-sale (53%), **178,892** rentals (46%) | Phase 2 sale-history features |
| `listings_history` | 959,844 rows (price/status trajectory) | future price-side work (not this spec) |
| `hud_safmr` | **fy2026 only**, 193,005 rows | Phase 3 loads fy2021-2025 → trajectory + period-correct anchors |
| `zcta_demographics` | acs_year **2023 + 2024**, 33.7 K ZCTAs each | Phase 3 adds 2019 → 5-yr growth |
| `census_tracts` | 84,415 polygons (geom + NRI) | tract joins, rentals backfill |
| `sold_listings` | 14.8 K with geom, accruing | local sold-$/sqft surface |
| `h3` python lib | **not installed** in ML image | Phase 1 dep |

Current v1 baseline (2026-07-08 retrain): holdout MAE **$487.90**, MAPE 15.3%, vs HUD baseline $780.54; band coverage 76.3%.

## 1. Design at a glance

13 existing features + 14 new = **27**, added in three gated phases:

| Phase | New features | New data plumbing |
|---|---|---|
| **P0 hardening + benchmark** | — | meta-order vector emission, feature-count preflight, `/healthz` surface, split-ZIP benchmark in eval |
| **P1 hyperlocal location** | `tract_te`, `h3_te`, `local_rent_psf_log`, `local_sold_psf_log`, `local_obs_log`, `tract_med_income_log` | `rental_listings.census_tract` backfill; `h3_market_stats` table + nightly refresh; `tract_demographics` ACS load; TE stats sidecar file |
| **P2 property history** | `years_since_last_sale`, `last_sold_ppsf_log`, `last_sold_vs_local`, `prior_rent_log`, `months_since_prior_rent` | `address_rent_history` table + nightly upsert; worker payload fields |
| **P3 temporal** | `fmr_cagr_3yr`, `zcta_income_growth_5yr`, `zcta_rent_growth_5yr` (+ fy-correct HUD anchor in training; recency half-life 180 d → 365 d) | HUD SAFMR fy2021-2025 load; ACS 2019 vintage load |

Every phase ends with: retrain → gate (must beat the *promoted* model, not just HUD) → atomic promote → live verify. Rollback at any point: `docker exec infrastructure-ml-1 sh -c 'rm -rf /models/rent_v1 && cp -r /models/rent_v1_backup /models/rent_v1'` (the retrain runner already snapshots `rent_v1_backup` before each promote — verify that behavior in `services/ml/main.py:/ops/run-train` while implementing P0, and add it if absent).

**Deliberately out of scope** (documented so nobody "helpfully" adds them): amenity flags (`parking_garage`, `has_ac`, …) — present on rentals but unverified/absent for for-sale serve-side; would train-serve skew. Rental `days_on_market`/`price_reduced` — no serve-side equivalent for a for-sale subject (pure skew). Neural/embedding models — LightGBM stays (2-core budget). Paid data (Zillow/ATTOM/CoreLogic) — locked out. Ratio-target normalization (predict rent/FMR instead of rent) — revisit only when `rental_listings` history exceeds 12 months; recorded in §P3 as a follow-up flag, not built now.

---

## Phase 0 — Serving hardening + the benchmark that measures this work

Ship first, before any feature work: it kills the 2026-07-08 outage class and freezes the baseline the later gates compare against.

### Task 0.1: Meta-order vector emission + feature-count preflight

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml/model_store.py`
- Create: `services/ml_rent_estimator/test_dataset.py`

**Interfaces:**
- Produces: `compute_features(row: dict, meta: dict) -> dict[str, float]` (named features, superset OK) and `vector_from_features(feats: dict, meta: dict) -> list[float]` (emits in `meta["feature_names"]` order). `build_feature_row(row, meta)` becomes `vector_from_features(compute_features(row, meta), meta)` — existing callers keep working.

- [ ] **Step 1: Write the failing tests**

```python
# services/ml_rent_estimator/test_dataset.py
import math
import pytest
from ml_rent_estimator.dataset import (
    FEATURE_NAMES, compute_features, vector_from_features,
)

BASE_META = {
    "feature_names": list(FEATURE_NAMES),
    "global_mean_log": 7.5,
    "zip_te": {"90004": 8.1},
    "ptype_map": {"SINGLE_FAMILY": 3},
    "hud_beds_median": {"3": 2200.0},
    "sqft_median_by_beds": {"3": 1400.0},
    "zcta_income_global_median": 60000.0,
    "zcta_rent_global_median": 1000.0,
}
ROW = {"beds": 3, "baths": 2, "sqft": 1500, "year_built": 1950,
       "lot_sqft": 6000, "hoa_fee": 0, "lat": 34.07, "lng": -118.31,
       "ptype": "SINGLE_FAMILY", "zip": "90004", "hud_safmr": 2400,
       "zcta_med_income": 70000, "zcta_med_rent": 1800}

def test_vector_order_follows_meta_not_module():
    # An OLD artifact that only knows the first 11 features must still be
    # servable by NEW code: vector length == len(meta.feature_names).
    meta = dict(BASE_META, feature_names=list(FEATURE_NAMES[:11]))
    v = vector_from_features(compute_features(ROW, meta), meta)
    assert len(v) == 11

def test_vector_matches_build_feature_row_for_current_meta():
    v = vector_from_features(compute_features(ROW, BASE_META), BASE_META)
    assert len(v) == len(FEATURE_NAMES)
    assert v[0] == 3.0 and v[1] == 2.0            # beds, baths
    assert v[2] == pytest.approx(math.log(1500))  # sqft_log

def test_unknown_feature_name_in_meta_raises():
    meta = dict(BASE_META, feature_names=["beds", "not_a_feature"])
    with pytest.raises(KeyError):
        vector_from_features(compute_features(ROW, meta), meta)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd services && python -m pytest ml_rent_estimator/test_dataset.py -v` (create a venv with `pandas numpy pytest` if none; the scraper's `test_enrichment.py` pattern applies).
Expected: FAIL — `ImportError: cannot import name 'compute_features'`.

- [ ] **Step 3: Refactor dataset.py**

Split the existing `build_feature_row` body: everything that computes values goes into `compute_features` returning a dict keyed by feature name (keys exactly matching `FEATURE_NAMES` entries); ordering moves to `vector_from_features`:

```python
def vector_from_features(feats: dict[str, float], meta: dict) -> list[float]:
    # Emit in the ARTIFACT's order. New code computes a superset of any
    # older artifact's names (append-only registry), so old models stay
    # servable through deploys. Unknown name => programmer error, raise.
    return [feats[name] for name in meta["feature_names"]]

def build_feature_row(row: dict[str, Any], meta: dict) -> list[float]:
    return vector_from_features(compute_features(row, meta), meta)
```

- [ ] **Step 4: Add the preflight in model_store.predict_rows** (before `.predict`):

```python
n_expected = _boosters["p50"].num_feature()
if X.shape[1] != n_expected:
    log.critical(
        "feature count mismatch: built %d, model expects %d — check "
        "FEATURE_NAMES vs artifact; serving fallback", X.shape[1], n_expected)
    return None
```

Also export the state for `/healthz` (in `services/ml/main.py`, add `"model_feature_match": model_store.feature_match_ok()` — a module-level bool set by the preflight, default True).

- [ ] **Step 5: Run tests → PASS; run the full ML smoke** (`POST /predict` against a local or prod container returns `model_version: v1`), **commit** `feat(ml): meta-order vectors + feature-count preflight (serve old models safely)`.

### Task 0.2: Split-ZIP benchmark in the eval gate

**Files:**
- Modify: `services/ml_rent_estimator/eval_v1.py`
- Modify: `services/ml_rent_estimator/train_v1.py` (report block)

**Interfaces:**
- Produces: eval report gains `highvar_zip_mae`, `highvar_zip_count`, `within_zip_spearman`; gate config gains `highvar_regression_max` (float, default 1.02 = allow ≤2% regression) checked on every promote.

- [ ] **Step 1: Implement the slice** (in eval, after holdout predictions exist):

```python
import numpy as np
from scipy.stats import spearmanr  # scipy already ships with lightgbm stack; if absent, add to services/ml requirements

def highvar_slice(holdout_df, pred, actual):
    df = holdout_df.assign(pred=pred, actual=actual)
    g = df.groupby("zip")["actual"].agg(n="count", v=lambda s: float(np.var(np.log(s))))
    eligible = g[g.n >= 30]
    hv = set(eligible.nlargest(max(1, len(eligible) // 10), "v").index)
    m = df[df["zip"].isin(hv)]
    rhos = [spearmanr(x["pred"], x["actual"]).statistic
            for _, x in m.groupby("zip") if len(x) >= 5]
    return {
        "highvar_zip_count": len(hv),
        "highvar_zip_mae": float(np.mean(np.abs(m["pred"] - m["actual"]))),
        "within_zip_spearman": float(np.nanmean(rhos)) if rhos else None,
    }
```

- [ ] **Step 2: Wire into the gate.** Promotion now requires (a) the existing overall ratio pass AND (b) `candidate.highvar_zip_mae <= promoted.highvar_zip_mae * highvar_regression_max`. The promoted model's report must be persisted alongside the artifact (`/models/rent_v1/eval_report.json`) so the comparison has a denominator; write it at promote time.
- [ ] **Step 3: Retrain once now** (no new features) to freeze the v2-baseline report: overall MAE ≈ $488 and the first measured `highvar_zip_mae` / `within_zip_spearman`. Record the numbers in the PR description. **Commit** `feat(ml): split-ZIP benchmark + gate; baseline frozen`.

---

## Phase 1 — Hyperlocal location

The 90004 fix. Three complementary channels: census-tract TE (aligned with ACS joins), H3 hex TE (pure data-driven, street-scale where dense), and a precomputed local price surface (the "how does this compare with prices nearby" feature, from both rentals and solds).

### Task 1.1: `rental_listings.census_tract` backfill + nightly increment

**Files:**
- Create: `infrastructure/migrations/2026_07_09_rental_census_tract.sql` (column + index only — txn-safe)
- Create: `infrastructure/migrations/out-of-band/2026_07_09_backfill_rental_census_tract.sql`
- Modify: `apps/worker/src/ml-scheduler.ts` (nightly increment job)

```sql
-- runner migration: 2026_07_09_rental_census_tract.sql
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS census_tract TEXT;
CREATE INDEX IF NOT EXISTS idx_rental_census_tract
  ON rental_listings(census_tract) WHERE census_tract IS NOT NULL;
```

```sql
-- out-of-band backfill (keyset batches, same pattern as
-- 2026_07_07_backfill_census_tract.sql — copy its loop structure):
UPDATE rental_listings r
   SET census_tract = t.geoid
  FROM census_tracts t
 WHERE r.id BETWEEN $start AND $end
   AND r.census_tract IS NULL
   AND r.location IS NOT NULL
   AND ST_Contains(t.geom, r.location::geometry);
```

Nightly increment: add a `tract-tag` job to `ml-scheduler.ts` at 00:40 UTC running the same UPDATE for `WHERE census_tract IS NULL` rows created in the last 2 days (bounded, indexed — single statement is fine at that volume).

- [ ] Apply migration + run backfill; acceptance: `SELECT count(*) FILTER (WHERE census_tract IS NOT NULL)::float / count(*) FROM rental_listings WHERE location IS NOT NULL` ≥ **0.97**. Commit.

### Task 1.2: `h3` dependency + `h3_market_stats` table + nightly refresh

**Files:**
- Modify: `services/ml/requirements.txt` (add `h3>=4`)
- Create: `infrastructure/migrations/2026_07_09_h3_market_stats.sql`
- Create: `services/ml_rent_estimator/market_stats.py`
- Modify: `services/ml/main.py` (new `POST /ops/refresh-market-stats`)
- Modify: `apps/worker/src/ml-scheduler.ts` (00:30 UTC job calling it)

**Interfaces:**
- Produces: table `h3_market_stats(h3_8 TEXT, stat_month DATE, med_rent_psf REAL, n_rent INT, med_sold_psf REAL, n_sold INT, PRIMARY KEY (h3_8, stat_month))`; `market_stats.refresh(conn) -> dict` (rows written); serving/training read rule below.

```sql
-- 2026_07_09_h3_market_stats.sql
CREATE TABLE IF NOT EXISTS h3_market_stats (
  h3_8        TEXT NOT NULL,
  stat_month  DATE NOT NULL,   -- month the stats DESCRIBE (data from that month)
  med_rent_psf REAL,  n_rent  INT NOT NULL DEFAULT 0,
  med_sold_psf REAL,  n_sold  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (h3_8, stat_month)
);
```

`market_stats.refresh()` (Python, because prod Postgres has no h3 extension and we will not install one for this): load the last 4 months of `rental_listings (lat, lng, price, sqft, listing_date)` with `price BETWEEN 300 AND 20000 AND sqft > 100` and `sold_listings (latitude, longitude, sold_price, sqft, sold_date)` with `sold_date <= now()`; compute `h3_8 = h3.latlng_to_cell(lat, lng, 8)` vectorized; group by `(h3_8, month)`; median psf + counts; upsert. ~200 K rows/run — pandas, seconds.

**One consistency rule (leakage + drift):** *training* rows join stats of the month **before** their `listing_date`'s month; *serving* uses the latest complete month. Same table, same semantics, no leak.

- [ ] Endpoint + scheduler job (mirror the existing `train`/`drift` job pattern including the alert-suppression log). Run once manually; acceptance: `SELECT count(DISTINCT h3_8) FROM h3_market_stats` > 50,000. Commit.

### Task 1.3: Tract-level ACS income

**Files:**
- Modify: `services/ml_rent_estimator/load_acs_zcta.py` → add `--geo tract` mode writing to new table
- Create: `infrastructure/migrations/2026_07_09_tract_demographics.sql`

```sql
CREATE TABLE IF NOT EXISTS tract_demographics (
  geoid TEXT NOT NULL, acs_year INT NOT NULL,
  median_hh_income NUMERIC, median_gross_rent NUMERIC,
  median_home_value NUMERIC, population NUMERIC,
  PRIMARY KEY (geoid, acs_year)
);
```

Tract mode: per-state loop over `https://api.census.gov/data/{yr}/acs/acs5?get=B19013_001E,B25064_001E,B25077_001E,B01003_001E&for=tract:*&in=state:{fips}&key=...` (the ZCTA loader's request/parse/upsert scaffolding is reusable; geoid = state+county+tract concatenation). Load acs_year **2023**. Acceptance: `SELECT count(*) FROM tract_demographics` ≥ 80,000. Commit.

### Task 1.4: The new features — TE cascade + local surface in `dataset.py`

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py` (TRAINING_SQL, FEATURE_NAMES, encoders, compute_features)
- Modify: `services/ml_rent_estimator/train_v1.py` (persist TE stats sidecar)
- Modify: `services/ml/model_store.py` (load sidecar + new caches)
- Modify: `services/ml_rent_estimator/test_dataset.py`

**Interfaces:**
- `FEATURE_NAMES` appends (exact names, this order): `"tract_te", "h3_te", "local_rent_psf_log", "local_sold_psf_log", "local_obs_log", "tract_med_income_log"`.
- Artifact gains sidecar `te_stats.json` `{ "tract": {geoid: [n, logsum]}, "h3_8": {...}, "h3_9": {...} }` (kept out of `metadata.json` so that file stays small/readable; `model_store.refresh()` loads it with the boosters).
- `compute_features` row inputs gain: `census_tract`, and lookups resolve `h3` from lat/lng internally.

**Hierarchical shrinkage cascade** (the load-bearing math — per-row, using raw `[n, logsum]` at each level so parents are the *row's own* coarser keys):

```python
def _shrink(n: float, logsum: float, parent: float, prior: float) -> float:
    return (logsum + prior * parent) / (n + prior)

def location_te(feats_zip_te: float, tract_key: str, h3_9: str, h3_8: str,
                stats: dict, global_mean_log: float) -> tuple[float, float, float]:
    """Returns (tract_te, h3_te, local_obs_n). Cascade:
    global -> zip_te (existing) -> tract -> h3_8 -> h3_9; each level shrinks
    toward the previous with priors 20/15/10. Missing level == parent."""
    t_n, t_ls = stats["tract"].get(tract_key, (0.0, 0.0))
    tract_te = _shrink(t_n, t_ls, feats_zip_te, 20.0) if t_n else feats_zip_te
    e_n, e_ls = stats["h3_8"].get(h3_8, (0.0, 0.0))
    h8 = _shrink(e_n, e_ls, tract_te, 15.0) if e_n else tract_te
    f_n, f_ls = stats["h3_9"].get(h3_9, (0.0, 0.0))
    h9 = _shrink(f_n, f_ls, h8, 10.0) if f_n else h8
    return tract_te, h9, (f_n or e_n or t_n or 0.0)
```

`fit_encoders` gains the raw stats (train fold only): `{key: [count, sum(log rent)]}` for `census_tract`, `h3_8`, `h3_9` (h3 computed in `frame_to_matrix`-side prep, vectorized). `local_obs_log = log1p(local_obs_n)`.

**Local surface features:** `local_rent_psf_log = log(med_rent_psf)` from `h3_market_stats` (training: prior-month row; serving: latest month via the model_store cache); fallback cascade hex → ring-1 neighbor mean (`h3.grid_disk(h3_8, 1)`) → ZIP-level `zcta_med_rent / sqft_median` → global median (persist that global in metadata). Same for `local_sold_psf_log`. `tract_med_income_log` from `tract_demographics` (latest acs_year; fallback to existing `zcta_med_income`).

**TRAINING_SQL additions:** select `r.census_tract`, and left-join `tract_demographics` (latest year per geoid, `DISTINCT ON` pattern identical to the existing zcta join). The h3/market-stats merges happen in pandas (`train_v1.py`) — SQL stays extension-free.

**model_store additions:** `_tract_income` cache (24 h TTL, same shape as `_zcta`), `_market_stats` cache (latest complete `stat_month` only, dict `h3_8 -> (rent_psf, sold_psf)`), sidecar `te_stats.json` loaded in `refresh()`. `_row_from_request` passes through `census_tract` (new optional `PredictRequest` field) — the worker supplies it (Task 1.5).

- [ ] Tests to add (same file, same style): cascade returns `zip_te` when all levels empty; tract level with n=80 dominates its prior; a constructed two-tract frame yields different `tract_te` per tract; `vector_from_features` length = 19 with the new meta. Run → PASS. Commit `feat(ml): hyperlocal features — tract/H3 TE cascade + local price surface`.

### Task 1.5: Worker payload + PredictRequest plumbing

**Files:**
- Modify: `apps/worker/src/rent-estimator.ts` (add `census_tract, address` to the job SELECT and to both single + batch ML payloads)
- Modify: `services/ml/main.py` (`PredictRequest` gains `census_tract: Optional[str] = None`, `address: Optional[str] = None` — address is consumed in Phase 2 but plumb it now to avoid touching the worker twice)

- [ ] `pnpm --filter @oper/worker build` + existing vitest suite green. Commit.

### Task 1.6: Retrain, gate, promote, verify

- [ ] `POST /ops/run-train` (pause `worker-rent` first if host memory is tight — see incident notes; 4 G cap holds either way).
- [ ] **Gate (hard, this phase):** overall ratio pass AND `highvar_zip_mae` improves **≥ 10%** vs the P0 baseline report AND `within_zip_spearman` improves. If the gate fails: inspect the train report's top-20 gain importances (add that dump to `train_v1.py` in this task — `booster.feature_importance('gain')` zipped with names, logged + persisted in eval_report.json) — the expected failure mode is the TE priors (tune 20/15/10 within ±2× only).
- [ ] Live verify: `POST /predict` for two real 90004 listings — one west of Van Ness (Hancock Park tract 06037211500), one east (Koreatown tract 06037192300) — predictions must no longer be within a few % of each other for comparable beds/sqft; sanity-check against their tract-median rents ($5,676 vs $4,380 in current data).
- [ ] Update `docs/DEPLOYMENT_STATE_2026-07-08.md` §2 feature list (or successor doc). Commit + push.

---

## Phase 2 — Property history

"What did it sell for, what did it rent for, and how does that compare with its neighbors."

### Task 2.1: `address_rent_history` table + nightly upsert

**Files:**
- Create: `infrastructure/migrations/2026_07_09_address_rent_history.sql`
- Modify: `services/ml_rent_estimator/market_stats.py` (the refresh endpoint also upserts this — one nightly job, two maintained tables)

```sql
CREATE TABLE IF NOT EXISTS address_rent_history (
  address_norm   TEXT PRIMARY KEY,
  zip_code       TEXT,
  last_rent      NUMERIC NOT NULL,
  last_rent_date DATE    NOT NULL,
  obs_count      INT     NOT NULL DEFAULT 1
);
```

Normalization (single definition, used verbatim on both write and lookup — put it in `market_stats.py` and mirror in SQL):
`address_norm = lower(regexp_replace(trim(address), '\s+', ' ', 'g'))`.

Upsert (inside `refresh()`):

```sql
INSERT INTO address_rent_history AS h (address_norm, zip_code, last_rent, last_rent_date)
SELECT DISTINCT ON (lower(regexp_replace(trim(address), '\s+', ' ', 'g')))
       lower(regexp_replace(trim(address), '\s+', ' ', 'g')),
       zip_code, price, listing_date
FROM rental_listings
WHERE price BETWEEN 300 AND 20000 AND address IS NOT NULL
ORDER BY 1, listing_date DESC
ON CONFLICT (address_norm) DO UPDATE
   SET last_rent = EXCLUDED.last_rent,
       last_rent_date = EXCLUDED.last_rent_date,
       obs_count = h.obs_count + 1,
       zip_code = EXCLUDED.zip_code
 WHERE EXCLUDED.last_rent_date > h.last_rent_date;
```

This table is the **durable rent memory** — it survives any future pruning of `rental_listings` and compounds monthly. Acceptance: row count ≥ 250 K after first run. Commit.

### Task 2.2: History features in `dataset.py`

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`, `test_dataset.py`, `services/ml/model_store.py`, `apps/worker/src/rent-estimator.ts`

**Interfaces:**
- `FEATURE_NAMES` appends: `"years_since_last_sale", "last_sold_ppsf_log", "last_sold_vs_local", "prior_rent_log", "months_since_prior_rent"`.
- Worker payload gains `last_sold_price`, `last_sold_date` (from `listings.raw_data->>'last_sold_price'/'last_sold_date'` in the job SELECT).

**Training-side sources (leak-free):**
- Sale history: TRAINING_SQL adds `(r.raw_data->>'last_sold_price')::float AS last_sold_price, (r.raw_data->>'last_sold_date')::date AS last_sold_date` with a guard `AND (r.raw_data->>'last_sold_date')::date < r.listing_date` folded into the expression (`CASE WHEN ... ELSE NULL END`) — a "last sale" recorded after the listing date is source noise, treat as missing. 46% coverage measured; LightGBM handles the NaN default path (`compute_features` emits the sentinel described below).
- Prior rent: **window function, not the table** (the table only keeps the latest obs; training needs the obs *prior to each row*):

```sql
LAG(r.price)        OVER (PARTITION BY lower(regexp_replace(trim(r.address), '\s+', ' ', 'g')) ORDER BY r.listing_date) AS prior_rent,
LAG(r.listing_date) OVER (PARTITION BY lower(regexp_replace(trim(r.address), '\s+', ' ', 'g')) ORDER BY r.listing_date) AS prior_rent_date
```

**Serve-side sources:** `last_sold_*` from the request payload; prior rent from a new `_rent_memory` model_store cache of `address_rent_history` (24 h TTL; ~400 K entries ≈ 40 MB — fine at 4 G; log the entry count on load).

**Feature definitions** (`compute_features`):

```python
years_since_last_sale   # (asof - last_sold_date).days/365.25; missing -> -1.0
last_sold_ppsf_log      # log(last_sold_price / sqft); missing -> 0.0
last_sold_vs_local      # last_sold_ppsf / exp(local_sold_psf_log); missing either side -> 1.0
prior_rent_log          # log(prior_rent); missing -> 0.0
months_since_prior_rent # (asof - prior_rent_date).days/30.44; missing -> -1.0
```

`asof` = the row's `listing_date` in training, `date.today()` in serving (thread it through `compute_features(row, meta, asof=...)` with a `None`→today default so the serve path needs no change).

Missing-value convention: **explicit sentinels, documented next to FEATURE_NAMES** (−1 for "no such event", 0.0 for absent logs, 1.0 for absent ratios) — LightGBM splits on them cleanly and the convention keeps train/serve identical.

- [ ] Tests: LAG-equivalent fixture — a 3-row single-address frame must yield `prior_rent = [NaN, r1, r2]` semantics through the SQL (test the pandas post-processing contract with a hand-built frame); sentinel paths; `last_sold_date >= listing_date` treated as missing. Commit.

### Task 2.3: Retrain, gate, promote, verify

- [ ] Gate: overall ratio pass, `highvar_zip_mae` non-regression (≤1.02×), and report (no hard gate — history is thin at 5 weeks) a new eval slice `repeat_address_mae`: holdout rows where `prior_rent` is present. Persist it — this is the number that should fall steadily over the coming months as memory accrues.
- [ ] Live verify: pick any listing whose address exists in `address_rent_history`, `POST /predict`, confirm the estimate moved toward the observed prior rent vs the P1 model.

---

## Phase 3 — Temporal anchors & trajectories

"How have incomes and rents moved here" + period-correct training anchors.

### Task 3.1: Historical HUD SAFMR (fy2021-2025)

**Files:**
- Modify: `services/ml_rent_estimator/load_hud_safmr.py` — parametrize `--fy`; source files are the public SAFMR workbooks on huduser.gov (the fy2026 URL already in the loader shows the pattern; the coder locates fy2021-2025 equivalents on the same page — they are free, no key).

Acceptance: `SELECT fy, count(*) FROM hud_safmr GROUP BY fy ORDER BY fy` shows 6 fiscal years, each > 150 K rows. Commit.

### Task 3.2: ACS 2019 vintage (ZCTA + tract)

- [ ] Run the existing ZCTA loader and the Task-1.3 tract loader with `--year 2019` (ACS 5-year). Acceptance: `zcta_demographics` has acs_year 2019 (~33 K rows), `tract_demographics` has 2019 (~80 K rows). Commit.

### Task 3.3: Trajectory features + fy-correct anchor

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`, `test_dataset.py`, `services/ml/model_store.py`

**Interfaces:**
- `FEATURE_NAMES` appends: `"fmr_cagr_3yr", "zcta_income_growth_5yr", "zcta_rent_growth_5yr"`.

**fy-correct anchor (training only — the feature name `hud_anchor_log` is unchanged):** replace the latest-fy `DISTINCT ON` join with a lateral picking the fy in effect at listing time (HUD fiscal years begin Oct 1 — approximate `effective_fy = EXTRACT(year FROM r.listing_date + interval '3 months')::int`):

```sql
LEFT JOIN LATERAL (
  SELECT safmr FROM hud_safmr h
   WHERE h.zip_code = r.zip_code
     AND h.bedrooms = LEAST(GREATEST(coalesce(r.bedrooms, 2)::int, 0), 4)
     AND h.fy <= EXTRACT(year FROM r.listing_date + interval '3 months')::int
   ORDER BY h.fy DESC LIMIT 1
) h ON true
```

Serving keeps the latest fy (correct: we predict today's rent). This is what makes multi-year training data safe as it accrues.

**Trajectory features:**

```python
fmr_cagr_3yr            # (safmr_latest/safmr_{latest-3})**(1/3) - 1 per (zip,beds); missing -> 0.0
zcta_income_growth_5yr  # zcta_med_income[latest]/zcta_med_income[2019] - 1; missing -> 0.0
zcta_rent_growth_5yr    # same for median_gross_rent; missing -> 0.0
```

Computed at fit time into metadata dicts (per-zip), served from the existing `_hud`/`_zcta` caches extended to carry both vintages (or a small new `_growth` cache — implementer's choice, same TTL pattern).

**Recency half-life:** in `frame_to_matrix`, change `np.exp(-age_days / 180.0)` → `np.exp(-age_days / 365.0)` — with period-correct anchors, older observations carry more usable signal. *(Follow-up flag, not built now: when `rental_listings` spans > 12 months, evaluate ratio-target normalization — predict `log(rent/safmr_fy)` — as a v3 candidate.)*

- [ ] Tests: lateral-join contract via fixture (row dated 2026-08-15 → fy2027 if loaded, else fy2026); growth features' missing→0.0 sentinels. Retrain → gate (overall pass + highvar non-regression) → promote → verify. Commit + push.

---

## Acceptance summary (whole spec)

| Metric (holdout) | Baseline (P0 freeze) | Target after P3 |
|---|---|---|
| Overall MAE | $487.90 | ≤ $440 |
| MAE vs HUD baseline | 62.5% of HUD's $780 | ≤ 56% |
| `highvar_zip_mae` | measured at P0 | **−10% minimum (P1 hard gate)**, −15% stretch |
| `within_zip_spearman` | measured at P0 | improved at P1, non-regressing after |
| `repeat_address_mae` | measured at P2 | tracked monthly — the compounding asset |

Operational invariants after every phase: `/healthz` shows `model_feature_match: true`; `worker-rent` drains with `model_version: v1` and non-null bands; nightly retrain (01:00 UTC), market-stats refresh (00:30), tract-tag (00:40) all green in `ml-scheduler` logs; ML RSS < 3 G steady-state.

## Sizing & ops notes

- Training grows 385 K×13 → ~450 K×27: expect 2–5 min wall (was 58 s). Budget is the existing 1800 s subprocess timeout — no change needed. `num_leaves` stays at its current value in P1; raising it is only allowed if the gate improves further (overfit guard: holdout decides, never train MAE).
- `te_stats.json` sidecar ≈ 5–20 MB, `_rent_memory` cache ≈ 40 MB, market-stats cache ≈ 10 MB — all fine at the 4 G cap; log sizes at load.
- All new nightly jobs live in `ml-scheduler.ts` following the existing job pattern (including the OPS_WEBHOOK alert-suppression logging, so failures are at least visible in logs — and get caught by the RentFailuresHigh chain if they starve the pipeline).
- The `h3` wheel adds ~1 MB to the ML image. No Postgres extensions are added by this spec.
