# Wave 2 — Remaining Work

**Date**: 2026-07-06
**Based on**: Server audit + code review + 3 subagent gap analyses

---

## What the reviews corrected from the initial plan

| Item | Initial claim | Corrected | Reason |
|------|--------------|-----------|--------|
| Fix `lot_size_acres` → `lot_sqft` in rent-estimator.ts | Bug | **No bug** | DB has `lot_size_acres` column; `* 43560` is mathematically correct |
| Apply `2026_06_03_rent_calc_async_part2.sql` (drop sync trigger) | Pending | **Already done** | Trigger dropped 2026-06-04 |
| Cache busting missing from `drainBatch()` | Missing | **Already done** | Busts frontend caches every 25 completions in batch path |
| `/ops/run-drift` and `/ops/run-eval` broken | Not in plan | **New gap** | `python -m drift` should be `python -m services.ml.drift` |
| `/ops/run-train` times out | Not in plan | **New gap** | 120s timeout, training takes ~394s |
| ~3K oldest pending rows stuck | Not in plan | **New gap** | IDs < 10000 never processed by drainBatch cursor |
| DB activation failure silently swallowed | Not in plan | **New gap** | Dir swap succeeds → DB fails → returns `ok=True` |
| Retrain overwrites same v1 row | Not in plan | **New gap** | Should insert `v1.YYYYMMDD` not mutate same row |

---

## Phase 1: Code Fixes

### 1.1 Fix `feature_set_hash` — eval_v1.py:149

**File**: `services/ml_rent_estimator/eval_v1.py`
**Line**: 149
**What**: `str(hash(tuple(meta["feature_names"])))`
**Bug**: Python's built-in `hash()` is randomized across interpreter restarts (`PYTHONHASHSEED`). Same features → different hash every retrain.
**Fix**: `hashlib.sha256(json.dumps(meta["feature_names"], sort_keys=True).encode()).hexdigest()`
**Add import**: `import hashlib`

### 1.2 Fix `promoted_at` — main.py:413

**File**: `services/ml/main.py`
**Line**: 413
**What**: `cur.execute("UPDATE rent_models SET active = (version = 'v1')")`
**Bug**: `promoted_at` column never written; always NULL for all model rows.
**Fix**:
```sql
UPDATE rent_models SET active = (version = 'v1');
UPDATE rent_models SET active = true, promoted_at = NOW() WHERE version = 'v1';
```
Or single-query:
```sql
UPDATE rent_models SET
    active = (version = 'v1'),
    promoted_at = CASE WHEN version = 'v1' THEN NOW() ELSE promoted_at END
```

### 1.3 Fix DB activation failure handling — main.py:396-420

**File**: `services/ml/main.py`
**What**: After successful directory swap (staging → production), DB activation runs in a try/except that swallows all errors and returns `ok=True`.
**Fix**:
- If directory swap succeeds but DB activation fails, log a CRITICAL, **don't** return `ok=True`
- Return `ok=False` with `"activation_failed"` in the message
- Consider whether to roll back the directory swap (reversible? `backup_dir` exists)

### 1.4 Fix drift/eval module paths — main.py:340-347

**File**: `services/ml/main.py`
**What**: `subprocess.run(["python", "-m", "drift"], ...)` and `python -m eval`
**Bug**: The drift module lives at `/app/services/ml/drift.py`. `python -m drift` fails with "No module named drift". Need `python -m services.ml.drift`.
**Fix**: Change both subprocess calls to use `services.ml.drift` and `services.ml.eval`.

### 1.5 Fix train timeout — main.py:361-421

**File**: `services/ml/main.py`
**What**: The `/ops/run-train` endpoint uses a blocking subprocess with `await` that times out at the HTTP handler's default 120s.
**Bug**: Training takes ~394s on the 2-core box. Times out every time.
**Fix**: Increase the timeout. Options:
- Set `timeout=600` on the subprocess call
- Or make the endpoint async: launch the train job in a background thread, return immediately with `{"started": true}`, and have a `/ops/train-status` endpoint

### 1.6 Fix HUD SAFMR latest-FY join — dataset.py:49-53

**File**: `services/ml_rent_estimator/dataset.py`
**What**: Training SQL joins `hud_safmr` on (zip_code, bedrooms) without filtering to latest FY.
**Bug**: Multiple FY rows per (zip, beds); arbitrary FY is picked by `DISTINCT ON` outer query. Serving path (`model_store.py`) correctly uses `DISTINCT ON ... ORDER BY fy DESC`.
**Fix**: Replace inline join with a subquery:
```sql
LEFT JOIN (
    SELECT DISTINCT ON (zip_code, bedrooms) zip_code, bedrooms, safmr
    FROM hud_safmr ORDER BY zip_code, bedrooms, fy DESC
) h ON h.zip_code = r.zip_code
   AND h.bedrooms = LEAST(GREATEST(coalesce(r.bedrooms, 2)::int, 0), 4)
```

### 1.7 Create 0→NULL migration

**File**: `infrastructure/migrations/2026_07_06_rent_zero_to_null.sql`
**Content**:
```sql
-- Convert legacy estimated_rent=0 rows to NULL.
-- Wave 2 encodes non-rentable properties as estimated_rent=NULL,
-- rent_model_version='non_rentable_skip' instead of estimated_rent=0.
-- All rent estimators (v0 triangulation, v1 LightGBM) return positive
-- values for rentable properties, so 0 is always an indicator of
-- "no estimate computed" or pre-Wave-2 convention.
UPDATE listings SET estimated_rent = NULL
WHERE estimated_rent = 0;
```

### 1.8 (Optional) Fix `lot_sqft` COALESCE — rent-estimator.ts:530

**File**: `apps/worker/src/rent-estimator.ts`
**Line**: 530
**What**: `drainBatch` SELECTs `lot_size_acres` and converts to sqft via `* 43560`.
**Fix**: Prefer the new `lot_sqft` column when available, fall back to converted acres:
```sql
COALESCE(lot_sqft, lot_size_acres * 43560) AS lot_sqft
```
Update `BatchRow` interface to add `lot_sqft: string | null`. Update feature mapping line 558 to use `lot_sqft` directly (already in sqft).

---

## Phase 2: Build + Deploy

### 2.1 Build
```bash
# ML service (Python — no build needed, but Docker images need rebuild)
./infrastructure/deploy.sh ml worker-rent worker-ml-scheduler
```

### 2.2 Apply migration
```bash
docker exec -i infrastructure-postgres-1 psql -U postgres \
  < infrastructure/migrations/2026_07_06_rent_zero_to_null.sql
```

---

## Phase 3: Server-Side Activation

### 3.1 Reset stuck oldest pending rows

The drainBatch cursor advanced past low-ID rows (~2,958 rows with `id < 10000`) without processing them. On server restart with the new image, `drainBatch` re-SELECTs from the beginning. No explicit SQL needed — restarting the worker container is sufficient. Verify with:

```sql
SELECT id, property_type, rent_calc_status FROM listings
WHERE id < 10000 AND rent_calc_status = 'pending'
  AND rent_model_version IS NULL AND is_rentable(property_type)
ORDER BY id LIMIT 10;
```

### 3.2 Trigger retrain
```bash
curl -X POST http://localhost:8000/ops/run-train
```
If async: poll `/ops/train-status` until complete.
Expected: train→eval→gate→promote cycle with new model row.

### 3.3 Activate + re-pend
```sql
-- Activate new model
UPDATE rent_models SET active = false;
UPDATE rent_models SET active = true, promoted_at = NOW() WHERE version = '<new_version>';

-- Re-pend for re-scoring
UPDATE listings SET rent_calc_status = 'pending'
WHERE rent_model_version IS DISTINCT FROM '<new_version>'
  AND rent_calc_status IN ('done', 'failed');
```

### 3.4 Verify drift/eval endpoints
```bash
curl -X POST http://localhost:8000/ops/run-drift
curl -X POST http://localhost:8000/ops/run-eval
```
Both should return `{"ok": true, ...}`.

---

## Phase 4: Verification & Exit Criteria

### 4.1 Coverage ≥95% with v1 + bands
```sql
SELECT
  round(100.0 * count(*) FILTER (WHERE rent_model_version = 'v1') / GREATEST(count(*), 1), 1) AS pct_v1,
  round(100.0 * count(*) FILTER (WHERE rent_model_version = 'v1' AND rent_low IS NOT NULL AND rent_high IS NOT NULL) / GREATEST(count(*), 1), 1) AS pct_with_bands
FROM listings;
```
**Assert**: both ≥95%.

### 4.2 Backlog <10K
```sql
SELECT count(*) FROM listings
WHERE rent_calc_status = 'pending'
  AND rent_model_version IS NOT NULL;
```
**Assert**: <10K.

### 4.3 MAE win recorded
```sql
SELECT
  metrics->'overall'->>'v1_mae' AS v1_mae,
  metrics->'overall'->>'hud_mae' AS hud_mae,
  (metrics->'overall'->>'v1_mae')::numeric / NULLIF((metrics->'overall'->>'hud_mae')::numeric, 0) AS gate_ratio
FROM rent_models WHERE active = true;
```
**Assert**: gate_ratio ≤ 0.85 (≥15% improvement).

### 4.4 Throughput ≥50 rows/s
From worker logs:
```bash
docker logs infrastructure-worker-rent-1 2>&1 | grep "batch drained" | tail -10
```
Calculate: 500 rows / avg interval seconds.
**Assert**: ≥50 rows/s.

### 4.5 Spot-check 5 listings
```bash
curl -s -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"beds":2,"baths":1,"sqft":900,"year_built":1985,"lot_sqft":5000,"hoa_fee":0,"latitude":28.5,"longitude":-81.3,"property_type":"SINGLE_FAMILY","zip_code":"32801"}'
```
**Assert**: `predicted_rent` > 0, `rent_low` < `rent_high`, `model_version` = `'v1'`.

### 4.6 Observe nightly retrain
Verify ml-scheduler triggers at 01:00 UTC (or manually trigger via 3.2).
**Assert**: One full train→eval→gate→promote→drain cycle observed.

---

## Phase 5: Quality & Docs

### 5.1 Write tests
- `services/ml/tests/test_eval_v1.py` — gate logic, metrics computation, DB upsert
- `services/ml/tests/test_train_v1.py` — feature generation, split correctness
- `services/ml/tests/test_dataset.py` — SQL correctness, HUD join, zip encoding
- `services/ml/tests/test_model_store.py` — model loading, HUD cache, predict

### 5.2 Update baseline doc
In `docs/superpowers/plans/2026-07-06-wave-2-baseline.md`:
- Add per-state MAE table (from `rent_models.metrics->'per_state'`)
- Add gate result with explicit pass/fail
- Add band coverage calibration note (0.767 vs target 0.80)
- Fill Task 6 acceptance placeholder with server data
- Add nightly retrain schedule note

### 5.3 Update wave-progress.md
Mark Wave 2 as shipped with summary metrics.

### 5.4 Document manual rollback
```sql
-- Rollback to previous model:
SELECT version FROM rent_models WHERE active = true ORDER BY trained_at DESC;
UPDATE rent_models SET active = false, promoted_at = NULL WHERE version = '<bad_version>';
UPDATE rent_models SET active = true, promoted_at = NOW() WHERE version = '<previous_good_version>';
-- If training artifacts need rollback:
cp -r /models/rent_v1_backup/* /models/rent_v1/
```

---

## Dependency Order

```
Phase 1 (code fixes)
  │
  ▼
Phase 2 (build + deploy) ──── 3.1 (reset stuck rows)
  │                               │
  ▼                               ▼
3.2 (trigger retrain)          worker picks up stuck rows
  │
  ▼
3.3 (activate + re-pend)
  │
  ▼
Phase 4 (verify exit criteria)
  │
  ▼
Phase 5 (quality + docs)
```
