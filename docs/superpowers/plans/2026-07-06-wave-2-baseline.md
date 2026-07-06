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

_(appended on completion)_

## Task 3 — eval results + promotion gate

_(appended on completion)_

## Task 6 — re-score acceptance

_(appended on completion)_
