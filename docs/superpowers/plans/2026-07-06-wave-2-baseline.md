# Wave 2 — Baseline (rent engine v1)

## Task 0 — dataset audit (2026-07-06, prod)

| Metric | Value |
|---|---|
| Usable comps (price $300–$20K) | **306,357** |
| Distinct ZIPs | 12,612 |
| Median rent | $2,300 |
| sqft coverage (usable) | 274,892 (89.7%) |
| beds coverage (usable) | 305,121 (99.6%) |
| Freshest row | 2026-07-06 (same-day) |

Top-15 states (eval strata): FL 69,223 · TX 49,128 · CA 16,841 · MA 16,168 · NJ 14,252 · NY 13,698 · GA 11,991 · PA 10,869 · NC 10,418 · IL 10,313 · VA 9,631 · MD 6,349 · TN 6,335 · AZ 5,394 · CT 4,988.

Gate: ≥100K usable → **PASS** (3× margin). Proceed to training.

## Rent pipeline state entering Wave 2

- v0 throughput 1.27/s single-row path (Wave 0); backlog draining.
- `market_benchmarks` = 1 row → HUD floor effectively dead in v0 (Task 1 fixes via `hud_safmr`).

## Task 1 — HUD SAFMR ingest

- FY2026 SAFMR file (huduser.gov, 4.4 MB xlsx) → `hud_safmr`: **193,005 rows / 38,601 ZIPs** (deduped multi-metro ZIPs keeping max).
- `rent_estimator_v2.get_hud_safmr()` repointed from the 1-row `market_benchmarks` to `hud_safmr` — the federal floor fires for the first time. Probe: rural TX 76437 3BR → $1,717 (SAFMR $1,420 anchor + comps).

## Task 2 — training

- 306,362 rows loaded; **address-hash 90/10 split** (time split rejected: rental collection started ~2026-06-05, "last 30d" would hold out 93% of data; address hashing also kills relisted-unit leakage).
- train=275,819 / holdout=30,543; 3 LightGBM quantile heads (native API); wall-clock **394 s** on the 2-core box; artifacts on the `ml_models` volume.

## Task 3 — eval results + promotion gate

| Metric | Value |
|---|---|
| Holdout rows | 30,543 |
| **v1 p50 MAE** | **$483.75** |
| v1 MAPE | 15.2% |
| HUD-anchor baseline MAE | $768.46 |
| **Gate ratio (≤0.85 required)** | **0.63 — 37% better than HUD** |
| State wins vs HUD (≥10/15 required) | **15/15** |
| Band coverage (p10–p90, target ≈0.8) | 0.766 |
| v0 sample comparison | null (in-process v2 calls returned no estimates; informative-only, not gating) |

**PROMOTION GATE: PASS.** `rent_models` v1 row written with full metrics jsonb, `active=false` (activation is Task 6).

## Task 6 — re-score acceptance

**Verification (2026-07-06, prod after deploy):**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Listings with `rent_model_version='v1'` | 70.1% | ≥95% | Still draining (worker at ~200 rows/s) |
| v1 rows with `rent_low`/`rent_high` populated (% of v1 rows) | 88.8% | ≥95% | |
| Backlog (versioned pending) | 31,995 | <10K | Falling fast |
| `estimated_rent = 0` rows | 0 | 0 | ✅ migration applied |
| MAE win vs HUD (gate ratio) | 0.63 (37% better) | ≥15% | ✅ |
| Throughput (batch) | ~200 rows/s | ≥50/s | ✅ 4× target |
| `/ops/run-drift` | working | — | ✅ (region PSI 2.99 — alert) |
| `/ops/run-eval` | working | — | ✅ |
| Train timeout fix | 120s → 1800s | — | ✅ `main.py:379` |
| Stuck rows reset (IDs < 10000) | 2,746 | 0 | Worker restart cleared cursor |
| `/ops/run-train` end-to-end confirmed | 1800s timeout | — | ✅ |
| Stuck oldest rows (IDs < 10000) | 2,746 reset | 0 | Re-pended, worker processing |
| Failed rows | 588 | — | To be investigated |
| Nightly retrain scheduled | 01:00 UTC daily | — | First run pending |

**Per-state MAE (top 15):**

| State | Rows | v1 MAE | HUD MAE | Δ |
|-------|------|--------|---------|---|
| FL | 7,008 | $592 | $957 | −38% |
| TX | 5,106 | $341 | $669 | −49% |
| CA | 1,553 | $908 | $1,400 | −35% |
| MA | 1,616 | $464 | $750 | −38% |
| NJ | 1,465 | $512 | $698 | −27% |
| NY | 1,301 | $919 | $1,491 | −38% |
| GA | 1,187 | $382 | $543 | −30% |
| PA | 1,098 | $313 | $412 | −24% |
| NC | 1,055 | $281 | $435 | −35% |
| IL | 1,003 | $310 | $520 | −40% |
| VA | 988 | $326 | $528 | −38% |
| MD | 601 | $346 | $568 | −39% |
| TN | 567 | $340 | $538 | −37% |
| AZ | 546 | $424 | $647 | −34% |
| CT | 517 | $613 | $974 | −37% |

v1 beats HUD in **15/15** top states. MAE ranges from $281 (NC, high confidence) to $919 (NY, high-rent variance). All states show ≥24% improvement over HUD baseline.

**Band coverage:** 0.766 (slightly under 0.80 target, within acceptable 0.60–0.95 range). Future retrain iterations could widen bands by tuning `min_data_in_leaf`.

## Task 7 — Nightly retrain

- `ml-scheduler` service: train daily 01:00 UTC, drift 02:00 UTC, eval Sun 03:00 UTC
- `/ops/run-train` end-to-end (train→eval→gate→promote) confirmed working with 1800s timeout
- `/ops/run-drift`: working, monitors 5 features (price, sqft, beds, dom, region) via PSI
- `/ops/run-eval`: working, evaluates v2 triangulation
- First auto-train expected at next 01:00 UTC

## Bugs fixed during deployment

| Bug | File | Fix |
|-----|------|-----|
| `feature_set_hash` uses `hash()` (non-deterministic) | `eval_v1.py:149` | `hashlib.sha256()` |
| `promoted_at` never set | `main.py:413` | `CASE WHEN version='v1' THEN NOW()...` |
| DB activation failure silently swallowed | `main.py:408-419` | Returns `ok=False` on failure |
| `/ops/run-drift` and `/ops/run-eval` broken module path | `main.py:342,353` | `python -m services.ml.drift` |
| HUD SAFMR join picks arbitrary FY | `dataset.py:49-53` | `DISTINCT ON ... ORDER BY fy DESC` subquery |
| `estimated_rent=0` never cleaned up | New migration | `2026_07_06_rent_zero_to_null.sql` |
