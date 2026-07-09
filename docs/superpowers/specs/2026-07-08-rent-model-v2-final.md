# Rent Model v2 — Hyperlocal Location, Property History, Temporal Demographics, and Systemd Capacity Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rent model accurate *within* ZIP codes — resolve micro-location (tract/block scale), exploit each property's own sale/rent history, anchor to how local incomes and rents have moved over time, and deliberately create enough host headroom to train and serve a somewhat larger LightGBM safely after the infrastructure migration.

**Architecture:** Keep the LightGBM p10/p50/p90 quantile trio and the metadata-driven feature builder (`ml_rent_estimator/dataset.py` is the single feature truth for train + serve). Add three independent signal families in gated phases: (1) hierarchical location target-encodings (tract + H3 hexes) plus a precomputed local price surface, (2) per-property history, (3) temporal anchors (multi-year HUD SAFMR, multi-vintage ACS). After Wave 4 and before Wave 5, migrate the host from Docker Compose to systemd-managed services, reclaim RAM currently stranded behind container caps/overhead, and use that extra headroom to widen the ML service budget and test a modestly stronger tree configuration.

**Tech Stack:** LightGBM (existing), `h3` (new Python dep, pure-wheel), PostGIS (existing), Census ACS API (key already in server `.env`), HUD SAFMR public files, pandas, systemd (new ops target after Wave 4).

## Global Constraints

- **No paid APIs.** Census, HUD, TIGER, FRED only (locked project decision).
- **Self-hosted:** 2-core / 15 GB VPS. Before the infra migration, the ML service remains Docker-capped at **4 G**. After the systemd cutover, target an ML service working budget of **6–8 G** host RAM with the rest reserved for Postgres, Redis, apps, and OS cache.
- **`dataset.py` stays the one feature truth.** Serving builds vectors only via it; no feature logic in `model_store.py`.
- **Feature registry is append-only.** Never rename or repurpose a feature name; new features append to `FEATURE_NAMES`.
- **Serve-side compatibility invariant (incident 2026-07-08):** new code must be able to serve an *older* model artifact. Vectors are emitted in the *artifact's* `metadata.feature_names` order, and a feature-count preflight guards every predict.
- **Leakage discipline:** every history/aggregate feature must use only data strictly *before* the training row's `listing_date`; TE/encoders fit on the train fold only; the address-hash 90/10 split stays.
- **Large-table discipline:** backfills use keyset batches, never touch `updated_at` on `listings`, never run wholesale UPDATEs inside the txn migration runner (out-of-band dir for those).
- **Calibration discipline:** quantile bands are product-facing output, so every retrain must report empirical p10/p90 coverage and fail loudly if bands drift materially off target.
- **Infra sequencing discipline:** do **not** combine the model feature rollout with the service-manager migration. Finish model phases first, freeze a stable baseline, then do the Docker → systemd cutover between Waves 4 and 5, then re-benchmark memory and tree size.
- **Tree-config discipline:** `NUM_LEAVES` and `N_ESTIMATORS` must be named constants at the top of `train_v1.py` with their current values recorded in comments. Raising either is only permitted when the holdout gate improves; the current values must also be recorded in this document's Sizing & ops notes so the P4 A/B has a documented baseline.
- **Address normalization freeze:** the address normalization expression (`lower(regexp_replace(trim(address), '\\s+', ' ', 'g'))`) is defined in exactly one place (`market_stats.py`) and mirrored verbatim in SQL. Never refactor or "clean up" this expression — any divergence silently breaks the `address_rent_history` lookup against the training LAG partition and kills the prior-rent feature without raising an error.

---

## 0. Why (evidence)

ZIP **90004** (user ground truth): Hancock Park west of Van Ness, Koreatown east — same ZIP, ~10× price spread; within Hancock Park, Rossmore vs Gower differ ~5×. Our own data agrees: 90004 spans **16 census tracts** whose tract-median asking prices run **$1.5 M → $5.0 M** and tract-median estimated rents **$3.1 K → $9.2 K**. The v1 model's only location signals are `zip_te` and raw lat/lng tree splits; both are too weak for split-ZIP neighborhoods. HUD SAFMR is also ZIP-level. So within split ZIPs both the model and HUD flatline at the ZIP mean: west side underestimated, east side overestimated.

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

Current v1 baseline (2026-07-08 retrain): holdout MAE **$487.90**, MAPE 15.3%, vs HUD baseline $780.54; p10/p90 band coverage 76.3%.

## 1. Design at a glance

13 existing features + 14 planned new features + 4 evaluation/serving improvements = a staged v2 that first fixes serving reliability, then adds hyperlocal, history, and temporal signal, then reclaims RAM via systemd and tests a slightly larger LightGBM.

| Phase | New features / work | New data plumbing / infra |
|---|---|---|
| **P0 hardening + benchmark** | — | meta-order vector emission, feature-count preflight, `/healthz` surface, split-ZIP benchmark in eval, quantile coverage report |
| **P1 hyperlocal location** | `tract_te`, `h3_te`, `local_rent_psf_log`, `local_sold_psf_log`, `local_obs_log`, `tract_med_income_log`, density-aware H3 support features | `rental_listings.census_tract` backfill; `h3_market_stats` table + nightly refresh; `tract_demographics` ACS load; TE stats sidecar file |
| **P2 property history** | `years_since_last_sale`, `last_sold_ppsf_log`, `last_sold_vs_local`, `prior_rent_log`, `months_since_prior_rent` | `address_rent_history` table + nightly upsert; async-loaded rent-memory cache; worker payload fields |
| **P3 temporal** | `fmr_cagr_3yr`, `zcta_income_growth_5yr`, `zcta_rent_growth_5yr` (+ fy-correct HUD anchor in training; metro-aware recency weighting) | HUD SAFMR fy2021-2025 load; ACS 2019 vintage load |
| **P4 systemd migration (between Waves 4 & 5)** | no new model features; host capacity upgrade | replace Docker Compose services with systemd units; reclaim ML RAM; re-benchmark training/inference memory; test larger tree budget |

Every phase ends with: retrain → gate (must beat the *promoted* model, not just HUD) → atomic promote → live verify. Pre-systemd rollback remains model-artifact swap plus container restart. Post-systemd rollback becomes model-artifact swap plus `systemctl restart ml.service` (or the final unit name chosen during P4).

**Deliberately out of scope:** amenity flags (`parking_garage`, `has_ac`, …) — present on rentals but unverified/absent for for-sale serve-side; would train-serve skew. Rental `days_on_market`/`price_reduced` — no serve-side equivalent for a for-sale subject. Neural/embedding models — LightGBM stays (2-core budget). Paid data (Zillow/ATTOM/CoreLogic) — locked out. Go rewrite of the ML service — rejected here because it would not materially change LightGBM memory usage and would increase implementation risk.

---

## Phase 0 — Serving hardening + the benchmark that measures this work

Ship first, before any feature work: it kills the 2026-07-08 outage class and freezes the baseline the later gates compare against.

### Task 0.1: Meta-order vector emission + feature-count preflight

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml/model_store.py`
- Create: `services/ml_rent_estimator/test_dataset.py`

**Interfaces:**
- Produces: `compute_features(row: dict, meta: dict, asof=None) -> dict[str, float]` (named features, superset OK) and `vector_from_features(feats: dict, meta: dict) -> list[float]` (emits in `meta["feature_names"]` order). `build_feature_row(row, meta)` becomes `vector_from_features(compute_features(row, meta), meta)`.

- [ ] Write failing tests proving that new code can serve an older artifact whose `metadata.feature_names` is shorter than current `FEATURE_NAMES`.
- [ ] Run to verify failure.
- [ ] Refactor `dataset.py` so feature computation returns a dict and ordering is driven only by artifact metadata.
- [ ] Add the preflight in `model_store.predict_rows` before `.predict`; on mismatch, return `None`, set a module-level health flag false, and log at critical.
- [ ] Run tests → PASS; run the full ML smoke (`POST /predict` returns `model_version: v1`); commit `feat(ml): meta-order vectors + feature-count preflight (serve old models safely)`.

### Task 0.2: Split-ZIP benchmark + band calibration in the eval gate

**Files:**
- Modify: `services/ml_rent_estimator/eval_v1.py`
- Modify: `services/ml_rent_estimator/train_v1.py`

**Interfaces:**
- Produces: eval report gains `highvar_zip_mae`, `highvar_zip_count`, `within_zip_spearman`, `band_coverage_p10_p90`, `band_undercoverage`, `band_overcoverage`; gate config gains `highvar_regression_max` (default 1.02).

- [ ] Implement the high-variance ZIP slice after holdout predictions exist.
- [ ] Change `within_zip_spearman` aggregation from plain mean to a size-aware weighted mean using `sqrt(n_zip)` so 5-row ZIPs do not count the same as 500-row ZIPs.
- [ ] Add quantile calibration reporting: `coverage = mean((actual >= p10) & (actual <= p90))`; persist it in `eval_report.json` and log it on every train.
- [ ] Gate: existing overall ratio pass, plus highvar non-regression, plus a calibration warning if coverage falls outside 0.78–0.84. Warning only in P0; becomes a hard fail at P3-promote time.
- [ ] **Eval history rolling log:** after every promote, append the full `eval_report.json` as a single JSON line to `eval_history.jsonl` alongside the artifact. This gives a queryable record of every promoted model's metrics so ratchets are visible. The gate may optionally compare `highvar_zip_mae` against the 30-day rolling minimum from this log rather than just the previous artifact — implement the comparison helper now even if the gate only uses the latest-promote denominator in P0.
- [ ] **Training wall-time budget alert:** at the end of every train run, log `train_wall_seconds`. If `train_wall_seconds > 0.6 * TRAIN_TIMEOUT_SECONDS` (currently 1800 s, threshold = 1080 s), log a warning at WARN level with the message `training wall time approaching timeout ceiling — review num_leaves/n_estimators or prune rental_listings`. This is not a gate; it is early signal before the pipeline breaks.
- [ ] Retrain once now (no new features) to freeze the v2 baseline report: overall MAE, `highvar_zip_mae`, `within_zip_spearman`, empirical band coverage, and the first `eval_history.jsonl` entry. Commit `feat(ml): split-ZIP benchmark + quantile calibration + eval history log; baseline frozen`.

---

## Phase 1 — Hyperlocal location

The 90004 fix. Three complementary channels: census-tract TE, H3 hex TE, and a precomputed local price surface.

### Task 1.1: `rental_listings.census_tract` backfill + nightly increment

**Files:**
- Create: `infrastructure/migrations/2026_07_09_rental_census_tract.sql`
- Create: `infrastructure/migrations/out-of-band/2026_07_09_backfill_rental_census_tract.sql`
- Modify: `apps/worker/src/ml-scheduler.ts`

- [ ] Add the column + partial index in the txn-safe migration.
- [ ] Run the out-of-band keyset backfill using the same batching structure as the existing census tract backfill.
- [ ] Add a nightly bounded increment job for rows created in the last 2 days.
- [ ] Acceptance: `census_tract` fill-rate on geocoded rows ≥ 0.97. Commit.

### Task 1.2: `h3` dependency + `h3_market_stats` table + nightly refresh

**Files:**
- Modify: `services/ml/requirements.txt`
- Create: `infrastructure/migrations/2026_07_09_h3_market_stats.sql`
- Create: `services/ml_rent_estimator/market_stats.py`
- Modify: `services/ml/main.py`
- Modify: `apps/worker/src/ml-scheduler.ts`

**Interfaces:**
- Produces: `h3_market_stats(h3_8 TEXT, stat_month DATE, med_rent_psf REAL, n_rent INT, med_sold_psf REAL, n_sold INT, PRIMARY KEY (h3_8, stat_month))` and a refresh endpoint/job.

- [ ] Add `h3>=4`.
- [ ] Build the refresh job in Python (no Postgres h3 extension).
- [ ] Keep the leakage rule: training joins prior-month stats; serving uses latest complete month.
- [ ] Acceptance: `count(DISTINCT h3_8) > 50,000`. Commit.

### Task 1.3: Tract-level ACS income

**Files:**
- Modify: `services/ml_rent_estimator/load_acs_zcta.py`
- Create: `infrastructure/migrations/2026_07_09_tract_demographics.sql`

- [ ] Add `--geo tract` mode, writing to `tract_demographics`.
- [ ] Load ACS 2023 tract data.
- [ ] Acceptance: `tract_demographics` row count ≥ 80,000. Commit.

### Task 1.4: Hyperlocal features — TE cascade + local surface + density awareness

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml_rent_estimator/train_v1.py`
- Modify: `services/ml/model_store.py`
- Modify: `services/ml_rent_estimator/test_dataset.py`

**Interfaces:**
- `FEATURE_NAMES` appends, in order: `"tract_te", "h3_te", "local_rent_psf_log", "local_sold_psf_log", "local_obs_log", "tract_med_income_log"`.
- Add two density-awareness support features so the model can learn when to trust the fine cell: `"h3_8_obs_log"`, `"h3_9_obs_log"`.
- Artifact gains sidecar `te_stats.json` with raw `[n, logsum]` for `tract`, `h3_8`, `h3_9`.

**Required improvement #1 — density-aware H3 instead of a fixed-resolution assumption:**
- [ ] Keep the shrinkage cascade `zip -> tract -> h3_8 -> h3_9`, but persist and expose both `h3_8` and `h3_9` observation counts as explicit features (`log1p(n)`) so LightGBM can learn whether the fine-level TE is trustworthy.
- [ ] Keep `h3_8` as the market-stats table resolution for refresh cost and cache size, but derive `h3_9` TE only from training/sidecar stats; do not add a second market-stats table.
- [ ] Tests: empty levels fall back to `zip_te`; strong tract density dominates prior; `h3_9_obs_log` differs across dense vs sparse fixtures.

**Required improvement #2 — soften the Phase 1 gate to match current data density:**
- [ ] Change the hard gate from `highvar_zip_mae` improvement ≥ 10% to **≥ 5% hard / ≥ 10% stretch**. If candidate improves 5–9.99%, promote is allowed but the train report must log `gate_note: stretch target missed; dense-ZIP improvement landed in acceptable band`.
- [ ] Keep `within_zip_spearman` improvement as a hard requirement.

**Local surface rule:**
- [ ] `local_rent_psf_log` and `local_sold_psf_log` use hex → ring-1 mean → ZIP-level → global fallback.
- [ ] `tract_med_income_log` falls back to existing `zcta_med_income`.

- [ ] Run tests → PASS. Commit `feat(ml): hyperlocal features — tract/H3 TE cascade + local surface + density awareness`.

### Task 1.5: Worker payload + PredictRequest plumbing

**Files:**
- Modify: `apps/worker/src/rent-estimator.ts`
- Modify: `services/ml/main.py`

- [ ] Add `census_tract` and `address` to the job SELECT and to both single + batch ML payloads.
- [ ] Add `census_tract: Optional[str] = None`, `address: Optional[str] = None` to `PredictRequest`.
- [ ] `pnpm --filter @oper/worker build` + existing vitest suite green. Commit.

### Task 1.6: Retrain, gate, promote, verify

- [ ] Run retrain.
- [ ] Gate: overall ratio pass AND `highvar_zip_mae` improves **≥ 5% hard**, **≥ 10% stretch**, AND `within_zip_spearman` improves.
- [ ] Add top-20 gain importances to `eval_report.json` for debugging priors and density features.
- [ ] **Canary shadow window:** before committing the new model to all worker-rent jobs, implement a shadow harness here in P1 so it is available for all subsequent promotes. On every promote, the harness runs both the incumbent artifact and the candidate on the first 200 real predictions after cutover, logs both `old_p50` and `new_p50` with the `listing_id`, and fires the existing OPS_WEBHOOK alert if the median absolute deviation between old and new exceeds $300. This catches systematic regressions on feature classes that holdout did not expose. Do not disable the harness in P4 — the systemd cutover is a deployment event and must also run the canary.
- [ ] Live verify on two real 90004 listings west/east of Van Ness; predictions should no longer sit within a few percent of each other for comparable homes.
- [ ] Update deployment-state docs. Commit + push.

---

## Phase 2 — Property history

“What did it sell for, what did it rent for, and how does that compare with its neighbors.”

### Task 2.1: `address_rent_history` table + nightly upsert

**Files:**
- Create: `infrastructure/migrations/2026_07_09_address_rent_history.sql`
- Modify: `services/ml_rent_estimator/market_stats.py`

- [ ] Create the durable table.
- [ ] Normalize address exactly once and reuse the same normalization string on both write and lookup.
- [ ] Upsert latest per-address observed rent nightly.
- [ ] Acceptance: row count ≥ 250 K after first run. Commit.

### Task 2.2: History features in `dataset.py`

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml_rent_estimator/test_dataset.py`
- Modify: `services/ml/model_store.py`
- Modify: `apps/worker/src/rent-estimator.ts`

**Interfaces:**
- `FEATURE_NAMES` appends: `"years_since_last_sale", "last_sold_ppsf_log", "last_sold_vs_local", "prior_rent_log", "months_since_prior_rent"`.
- Worker payload gains `last_sold_price`, `last_sold_date`.

**Required improvement #3 — distinguish “no sale” from “no local sold surface”:**
- [ ] Keep `last_sold_ppsf_log` as its own feature with missing sentinel `0.0`.
- [ ] Keep `last_sold_vs_local`, but only compute the ratio when both `last_sold_price/sqft` **and** `local_sold_psf_log` are truly available from non-global fallback context. When ratio is not meaningful, emit sentinel `1.0` and also add a companion binary feature `"last_sold_ratio_present"` (1.0/0.0) so the model can separate “neutral ratio because missing” from a real ratio near 1.
- [ ] Update `FEATURE_NAMES` accordingly; append `"last_sold_ratio_present"` after `last_sold_vs_local`.

**Required improvement #4 — make `_rent_memory` load non-blocking:**
- [ ] In `model_store.refresh()`, load boosters and critical metadata synchronously, but load `_rent_memory` asynchronously in a background thread/task with a TTL cache that defaults empty on cold start.
- [ ] Health/readiness rule: `/healthz` stays green if boosters are loaded and feature counts match, even while `_rent_memory` is still warming. Expose a secondary field like `rent_memory_ready: bool` for observability.
- [ ] If `_rent_memory` is unavailable, serving falls back to `prior_rent_log = 0.0`, `months_since_prior_rent = -1.0`; log a warning once per refresh cycle, not on every request.

**Training-side sources:**
- [ ] Sale history comes from `raw_data` only when `last_sold_date < listing_date`; otherwise treat as missing.
- [ ] Prior rent uses SQL window `LAG()` over normalized address; do **not** use `address_rent_history` for training labels/features.

**Serve-side sources:**
- [ ] `last_sold_*` from the request payload.
- [ ] Prior rent from async `_rent_memory` cache.

- [ ] Tests: LAG-equivalent fixture; sentinel paths; `last_sold_date >= listing_date` treated as missing; ratio-present feature flips correctly; cold-start empty cache still builds valid vectors. Commit.

### Task 2.3: Retrain, gate, promote, verify

- [ ] Gate: overall ratio pass, `highvar_zip_mae` non-regression (≤1.02×), and report `repeat_address_mae`.
- [ ] Add `repeat_address_age_median_days` to the eval report so early improvements are interpretable; if median age < 60 days, annotate the slice as re-list-heavy rather than durable-memory-proven.
- [ ] Live verify on a property present in `address_rent_history`; prediction should move toward prior observed rent vs P1.

---

## Phase 3 — Temporal anchors & trajectories

“How have incomes and rents moved here” + period-correct training anchors.

### Task 3.1: Historical HUD SAFMR (fy2021-2025)

**Files:**
- Modify: `services/ml_rent_estimator/load_hud_safmr.py`

- [ ] Parameterize `--fy` and load fy2021–fy2025 public SAFMR files.
- [ ] Acceptance: `hud_safmr` has 6 fiscal years total, each > 150 K rows. Commit.

### Task 3.2: ACS 2019 vintage (ZCTA + tract)

- [ ] Run the ZCTA loader and tract loader with `--year 2019`.
- [ ] Acceptance: `zcta_demographics` has acs_year 2019 and `tract_demographics` has 2019. Commit.

### Task 3.3: Trajectory features + fy-correct anchor + metro-aware recency weighting

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml_rent_estimator/test_dataset.py`
- Modify: `services/ml/model_store.py`

**Interfaces:**
- `FEATURE_NAMES` appends: `"fmr_cagr_3yr", "zcta_income_growth_5yr", "zcta_rent_growth_5yr"`.

- [ ] Replace the latest-fy HUD join in training with the listing-time-correct lateral join.
- [ ] Compute the three trajectory features with missing→0.0 sentinels.
- [ ] Replace the single global recency half-life with a **metro-aware half-life** derived from available growth anchors: faster-growing metros get shorter decay, slower-growing metros longer decay. Keep a guarded fallback to 365 days where metro growth is unavailable.
- [ ] Add one explicit eval check proving these growth features are non-zero on at least one eligible ZIP/metro after data load, so the phase cannot “pass” entirely on sentinels.
- [ ] Tests: fy contract, growth-feature sentinels, metro half-life fallback path.
- [ ] **`fmr_cagr_nonzero_pct` gate requirement:** after loading fy2021-2025, `fmr_cagr_3yr` is only computable for ZIPs where both `safmr_fy2023` and `safmr_fy2026` are present. Add `fmr_cagr_nonzero_pct` to `eval_report.json` (fraction of training rows where the feature is non-sentinel). The P3 gate **hard fails** if `fmr_cagr_nonzero_pct < 0.50` — the phase cannot promote on a feature that is sentinel for the majority of training rows. If the threshold is not met after loading all 6 fiscal years, inspect coverage by state and escalate before promoting.
- [ ] **Band calibration hard gate (active from P3 onward):** upgrade the P0 calibration warning to a hard fail at P3-promote time. If `band_coverage_p10_p90` is outside 0.78–0.84, do not promote. Log the deviation and inspect quantile alpha values in `train_v1.py` before retrying.
- [ ] Retrain → gate (overall pass + highvar non-regression + `fmr_cagr_nonzero_pct ≥ 0.50` + band coverage in 0.78–0.84) → promote → verify. Commit + push.

---

## Phase 4 — Docker → systemd migration between Waves 4 & 5

This phase is operational, not modeling. The purpose is to reclaim ML headroom and simplify service scheduling on a single VPS, **after** the model work is stable and benchmarked under Docker.

### Task 4.1: Freeze state and document current Docker budgets

**Files:**
- Create: `docs/systemd-migration-plan.md`
- Modify: `docs/DEPLOYMENT_STATE_2026-07-08.md` (or successor)

- [ ] Record current Docker Compose services, restart policies, env files, bind mounts, ports, and memory limits.
- [ ] Measure baseline host memory by service: Postgres RSS, ML RSS, worker RSS, Next.js app RSS, Redis RSS, idle OS/cache.
- [ ] Freeze a known-good ML artifact and eval report before touching infra.

### Task 4.2: Create systemd units and cut over one service at a time

**Files:**
- Create: `ops/systemd/*.service` (final naming at implementer discretion)
- Modify: deploy scripts/docs accordingly

- [ ] Create systemd unit files for: Postgres, Redis, ML, worker, scraper, pg_tileserv, frontend apps, and any scheduler currently relying on Compose.
- [ ] Use `Restart=on-failure`, `RestartSec=5`, `After=`/`Requires=` for dependency ordering, `EnvironmentFile=` for env loading, and `WorkingDirectory=`/`ExecStart=` with the final runtime commands.
- [ ] Replace Docker networking assumptions with localhost / explicit host:port wiring.
- [ ] Cut over one service at a time; verify health before disabling the corresponding container.
- [ ] Keep Docker installed until the systemd stack has survived at least one nightly train, one market-stats refresh, and one deploy.

### Task 4.3: Reclaim ML memory budget and re-benchmark

- [ ] After full cutover, allocate host memory roughly as: Postgres 5–6 G, ML 6–8 G target ceiling, remainder shared by Redis, apps, worker, and OS cache.
- [ ] Measure real steady-state RSS for ML, Postgres, worker, apps, and total free memory after one full nightly cycle.
- [ ] Update ops docs to replace Docker restart/rollback examples with `systemctl` equivalents.

### Task 4.4: Use the reclaimed RAM conservatively for a stronger LightGBM

- [ ] With the systemd headroom, run a bounded A/B on tree size: keep the current baseline config as control, then test moderate increases such as `num_leaves` and/or `n_estimators` within a total train-time ceiling of 15 minutes on 2 cores.
- [ ] Do **not** switch frameworks. Stay on LightGBM; no Go rewrite; no CatBoost switch in this phase.
- [ ] Promote the larger configuration only if holdout MAE improves and calibration/highvar metrics do not regress.
- [ ] If the bigger tree budget does not win clearly, keep the existing config and bank the RAM as reliability margin.

---

## Acceptance summary (whole spec)

| Metric (holdout) | Baseline (P0 freeze) | Target after P3 | Target after P4 |
|---|---|---|---|
| Overall MAE | $487.90 | ≤ $440 | same or better after any tree-size A/B |
| MAE vs HUD baseline | 62.5% of HUD's $780 | ≤ 56% | non-regressing |
| `highvar_zip_mae` | measured at P0 | **−5% hard minimum**, −10% stretch at P1 | non-regressing |
| `within_zip_spearman` | measured at P0 | improved at P1, non-regressing after | non-regressing |
| `band_coverage_p10_p90` | 76.3% | 78%–84% preferred band | non-regressing |
| `repeat_address_mae` | measured at P2 | tracked monthly | tracked monthly |
| `repeat_address_age_median_days` | measured at P2 | reported for interpretation | reported |
| `fmr_cagr_nonzero_pct` | — | **≥ 50% hard gate at P3** | non-regressing |
| `band_coverage_p10_p90` | 76.3% | warning P0–P2; **hard gate 0.78–0.84 at P3** | hard gate every promote |
| `train_wall_seconds` | measured at P0 freeze | logged; warn if > 1080 s | logged; warn if > 1080 s |
| `eval_history.jsonl` entries | 1 (P0 baseline) | grows with every promote | grows with every promote |
| `repeat_address_age_median_days` | measured at P2 | reported for interpretation | reported |

Operational invariants after every phase: `/healthz` shows `model_feature_match: true`; `worker-rent` drains with `model_version: v1` and non-null bands; nightly retrain, market-stats refresh, tract-tag all green; `_rent_memory` can warm asynchronously without failing health; after P4 the same invariants hold under systemd instead of Docker.

## Sizing & ops notes

- Training grows from roughly 385 K × 13 to ~450 K × 29–30 effective features once density and ratio-presence helpers are added. Under Docker, keep the current training timeout budget. Under systemd, re-measure before increasing tree size.
- `te_stats.json` sidecar ≈ 5–20 MB, `_rent_memory` cache ≈ 40 MB, market-stats cache ≈ 10 MB. Under Docker these are fine but justify async warmup; under systemd they are comfortably within budget.
- The main RAM benefit comes from removing the 4 G ML container cap and container overhead on a single host, not from changing Python. This spec explicitly keeps Python for ML because LightGBM and pandas dominate the value path while interpreter overhead is comparatively small.
- All new nightly jobs continue to live in `ml-scheduler.ts` or its post-migration equivalent scheduling path; preserve alert-suppression logging and operational visibility during and after the systemd cutover.
- The `h3` wheel adds ~1 MB to the ML environment. No Postgres extensions are added by this spec.
- **Current LightGBM config (record actuals before P4 A/B):** `NUM_LEAVES = 63`, `N_ESTIMATORS = 400`. The P4 A/B is not permitted to start until these are written down here. Suggested P4 test range: `num_leaves` up to 4× current, `n_estimators` up to 2.5× current, within a 15-minute wall-time ceiling on 2 cores.
- **Canary shadow harness (implemented at P1.6):** fires on every future promote; 200-job shadow window; OPS_WEBHOOK alert if median deviation > $300. Do not disable it in P4 — the systemd cutover counts as a deployment event and should run the canary.
