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

_(appended on completion)_
