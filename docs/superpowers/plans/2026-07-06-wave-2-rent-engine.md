# Wave 2 — Rent Engine v1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** Replace the effectively-comps-only v0 rent estimate with a trained LightGBM model (confidence bands included), served batch-first so the full backlog re-scores in hours, promoted only if it beats the HUD-anchored baseline by ≥15% MAE, retrained nightly with auto-rollback.

**Architecture:** New training + eval scripts inside `services/ml_rent_estimator/` (psycopg2 against the prod DB — the existing `train_model.py` is dead Supabase-era code and is replaced). Model artifact ships via a bind-mounted `models/` dir (not baked into the image) so retrains don't need image rebuilds. `services/ml/main.py` gains `/predict_batch` + model-aware prediction with v2-triangulation fallback. `apps/worker/src/rent-estimator.ts` drain loop gains a batch path (one HTTP call + one bulk UPDATE per batch). HUD SAFMR ingested from the free HUD CSV to fix the dead federal floor (`market_benchmarks` has 1 row).

**Tech Stack:** Python 3.11, LightGBM (3 quantile heads: p10/p50/p90), psycopg2, pandas; FastAPI; TypeScript worker; Postgres.

**Spec:** Wave 2 section of `docs/superpowers/specs/2026-07-05-full-upgrade-v2-design.md`. **Depends on:** Wave 0 (merged), Wave 1 (enrichment cols — not strictly required but `hoa_fee`/`lot_sqft` features benefit).

## Global Constraints

- All Wave 0 rules (server, deploy.sh, no `docker compose down`, backup before risky ops).
- Training runs ON the server inside the ml container (2-core/15G box): cap `n_estimators≈400`, `num_leaves≈63`, single-thread-friendly; wall-clock budget ≤20 min for ~300K rows — measure, don't assume.
- The rent NOTIFY trigger + drain loop stay live throughout; batch path must not double-process LISTEN rows (same in-flight guard as Wave 0).
- `estimated_rent = 0` → NULL migration only AFTER the batch path is proven (zeros are load-bearing for "done" rows until re-scored).
- Branch `wave/2-rent-engine` off main (after Wave 1 merges). Commit per task.

---

### Task 0: Branch + dataset audit

- [x] Branch off updated main.
- [x] Audit rental training data on prod; record in `docs/superpowers/plans/2026-07-06-wave-2-baseline.md`:

```sql
SELECT count(*) FILTER (WHERE price BETWEEN 300 AND 20000) usable,
       count(DISTINCT zip_code) zips,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY price) med,
       count(*) FILTER (WHERE sqft IS NOT NULL) has_sqft,
       count(*) FILTER (WHERE bedrooms IS NOT NULL) has_beds,
       max(created_at) freshest
FROM rental_listings WHERE price > 0;
-- per-state top 15 counts too (eval strata)
SELECT state, count(*) FROM rental_listings WHERE price BETWEEN 300 AND 20000 GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
```

Expected ≈300K usable. If usable < 100K, STOP — reassess with owner before training.

### Task 1: HUD SAFMR ingest (fixes the dead federal floor)

**Files:** Create `services/ml_rent_estimator/load_hud_safmr.py`; migration `infrastructure/migrations/2026_07_06_hud_safmr.sql`.

- [x] Migration: `CREATE TABLE IF NOT EXISTS hud_safmr (zip_code TEXT NOT NULL, bedrooms INT NOT NULL, safmr NUMERIC NOT NULL, fy INT NOT NULL, PRIMARY KEY (zip_code, bedrooms, fy));` plus an index on (zip_code, bedrooms).
- [x] Loader: download the current-FY HUD SAFMR file (huduser.gov "Small Area FMRs" XLSX/CSV, free, no key; verify the actual URL at execution time via WebFetch — it changes per FY), parse ZIP × {0..4}BR columns, upsert. Idempotent (`ON CONFLICT DO UPDATE`).
- [x] Point `rent_estimator_v2.get_hud_safmr()` at `hud_safmr` (currently queries the 1-row `market_benchmarks`): `SELECT safmr FROM hud_safmr WHERE zip_code=%s AND bedrooms=LEAST(%s,4) ORDER BY fy DESC LIMIT 1`.
- [x] Acceptance: `SELECT count(*) FROM hud_safmr;` ≈ 20K+ ZIPs × 5 BR sizes; spot-check 3 known ZIPs against the HUD site; v2 `/predict` responses shift where comps are thin.

### Task 2: Training pipeline `train_v1.py` (replaces dead Supabase-era script)

**Files:** Create `services/ml_rent_estimator/train_v1.py`, `services/ml_rent_estimator/dataset.py`; modify `services/ml/requirements.txt` (+`lightgbm==4.x`, `scikit-learn` for metrics only); modify `services/ml/Dockerfile` (models volume path env `MODEL_DIR=/models`); compose: bind `ml` service volume `- ml_models:/models` (+ named volume).

- [x] `dataset.py`: SQL pull (`price BETWEEN 300 AND 20000`, dedup on (address, listing_date) keep latest, time-decay weight `exp(-age_days/180)`), feature frame: beds, baths, sqft (log, imputed by beds-median), property_type (categorical), lat, lng, year_built, lot_sqft, hoa_fee, zip smoothed-target-encoding (fit on train folds only), `hud_anchor = safmr(zip,beds)` + `price/hud_anchor` target transform guard. Target: `log(price)`.
- [x] `train_v1.py`: time-based split (train = older than 30d, holdout = last 30d). Three LGBMRegressor heads (objective='quantile', alpha 0.1/0.5/0.9). Save `/models/rent_v1/{p10,p50,p90}.txt` (LightGBM native, no pickle) + `metadata.json` (features, encoders, train stats, feature_set_hash).
- [x] Runs inside the ml container: `docker exec infrastructure-ml-1 python -m ml_rent_estimator.train_v1`. Measure wall-clock; if >20 min, halve n_estimators and note it.
- [x] Acceptance: artifacts exist in the volume; metadata sane; training log shows holdout row count.

### Task 3: Eval harness + promotion gate

**Files:** Create `services/ml_rent_estimator/eval_v1.py`.

- [x] Metrics on the 30d holdout: MAE/MAPE/RMSE overall + per-state (top 15) for: (a) v1 p50, (b) HUD-anchor baseline (`safmr(zip,beds)`), (c) v0 triangulation on a 2K random holdout sample (it does per-row DB comps — full holdout too slow; sample is fine for a gate).
- [x] Coverage metric: fraction of holdout inside [p10,p90] (target ≈0.8; if <0.6 or >0.95 the quantiles are mis-calibrated — retune alpha or add `min_data_in_leaf`).
- [x] **Promotion gate: v1 p50 MAE ≤ 0.85 × HUD-baseline MAE overall AND v1 beats HUD in ≥10 of top-15 states.** Writes `rent_models` row `v1` (metrics jsonb, artifact_path, `active=false`).
- [x] If the gate FAILS: do not proceed to Task 5 activation; record metrics, iterate features once (add `days_on_market`, drop hoa), re-eval. If still failing, STOP and surface to owner — do not ship a worse model.

### Task 4: Serving — model-aware `/predict` + `/predict_batch`

**Files:** Modify `services/ml/main.py`; modify `services/ml_rent_estimator/predict.py` (LightGBM native load, quantile heads).

- [x] Model loader: on startup + on `rent_models.active` version change (checked with the existing 60s cache), load `/models/rent_v1/*` if the active row's version says v1. If load fails → log + stay on v2 fallback (never crash the service).
- [x] `/predict`: if v1 active → LightGBM p50 (+ p10/p90 in response as `rent_low`/`rent_high`); else existing v2 path. Response gains optional `rent_low`, `rent_high` (nullable; worker tolerates absence).
- [x] `/predict_batch`: `{items: [PredictRequest,…]}` → vectorized single DataFrame pass → `[{listing_id, predicted_rent, rent_low, rent_high, model_version, features_hash}]`. Cap batch ≤1000. p95 target ≤2s for 500 rows (measure).
- [x] Wire contract documented in the response models; worker (Task 5) consumes it.

### Task 5: Worker batch path

**Files:** Modify `apps/worker/src/rent-estimator.ts`, `apps/worker/src/env.ts` (+`RENT_BATCH_MODE=true`, `RENT_BATCH_SIZE=500`); compose worker-rent env.

- [x] `drainForever` batch branch: pull `RENT_BATCH_SIZE` pending rows WITH their features in ONE SELECT (the per-row `loadListing` round-trip dies), skip non-rentables in SQL (`is_rentable(property_type)`), POST `/predict_batch`, then one transaction: `UPDATE listings SET estimated_rent=v.rent, rent_low=v.lo, rent_high=v.hi, rent_calc_status='done', rent_model_version=v.mv FROM (SELECT * FROM unnest(...)) v WHERE listings.id=v.id` + bulk `INSERT INTO rent_predictions_audit SELECT * FROM unnest(...)`.
- [x] LISTEN path stays single-row (realtime inserts). Breaker semantics unchanged (batch failure = one transient event, rows stay pending).
- [x] Schema first: migration `2026_07_06_rent_bands.sql` — `ALTER TABLE listings ADD COLUMN IF NOT EXISTS rent_low NUMERIC, ADD COLUMN IF NOT EXISTS rent_high NUMERIC;` (nullable, instant).
- [x] Acceptance: with v1 active on a test basis (Task 6 flips it), batch drain throughput ≥50 rows/s measured (vs 1.27/s); zero rows stuck `processing`-equivalent; vitest still green.

### Task 6: Activate + full re-score + 0→NULL

- [x] Flip `rent_models` v1 `active=true` (single UPDATE; the 60s cache picks it up).
- [x] Re-pend everything not yet scored by v1: `UPDATE listings SET rent_calc_status='pending' WHERE rent_model_version IS DISTINCT FROM 'v1' AND rent_calc_status IN ('done','failed');` — run AFTER batch path deployed; at ≥50/s the ~940K re-score completes in ≤6h.
- [x] After drain: `UPDATE listings SET estimated_rent=NULL WHERE estimated_rent=0;` (legacy zeros + non-rentables; UI already null-guards per Wave 5 note; verify `/api/stats` + home render before/after on prod).
- [x] Acceptance battery: coverage ≥95% listings with `rent_model_version='v1'`; backlog <10K; `rent_low/high` populated; home/featured/stats endpoints 200 with sane numbers; spot-check 5 listings against Zillow-ish sanity by eye.

### Task 7: Nightly retrain + drift + rollback

- [x] ml-scheduler: add `/ops/run-train` (train_v1 + eval_v1 + gate) scheduled nightly 01:00 UTC (before the 02:00 drift job). On gate pass → insert new `rent_models` row + flip active. On fail → keep current active, alert line in logs (Wave 8 wires alerting).
- [x] Auto-rollback = the gate itself (new model never activates if worse). Manual rollback documented: `UPDATE rent_models SET active = (version='<prev>');`.
- [x] Acceptance: one observed scheduled run end-to-end (or manually triggered `/ops/run-train`) producing a new inactive-or-promoted row.

## Exit criteria (spec)
≥95% coverage with v1 + confidence bands; backlog <10K; ≥15% MAE win vs HUD baseline recorded in `rent_models.metrics`; nightly retrain observed; throughput ≥50 rows/s batch.
