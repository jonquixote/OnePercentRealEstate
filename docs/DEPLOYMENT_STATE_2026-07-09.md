# Deployment & Maintenance State — 2026-07-09

Updated after Phase 1 (hyperlocal features) deployment.

- **Host:** `209.94.61.108` (2-core, 15 GB RAM, ~148 GB disk). `ssh -i ~/.ssh/id_onepercent root@209.94.61.108`.
- **Repo on server:** `/opt/onepercent` (rsync target of local `/Users/johnny/Code/OnePercentRealEstate/`).
- **Systemd services:** `oper-ml`, `oper-postgres`, `oper-redis`, `oper-worker-ml-scheduler`, `oper-worker-rent`.

---

## 1. Service topology (systemd, not Docker)

| Service | Port | Role |
|---|---|---|
| `oper-ml` | `127.0.0.1:8000` | FastAPI rent estimator, 3 uvicorn workers. Model **v1**, 30 features. |
| `oper-postgres` | `127.0.0.1:5432` | PostgreSQL 16 + PostGIS. DB name is **`postgres**. |
| `oper-redis` | `127.0.0.1:6379` | Cache / queues. |
| `oper-worker-ml-scheduler` | — | Nightly: market-stats 00:30, census-tract 00:40, train 01:00, drift 02:00, eval Sun 03:00 UTC. |
| `oper-worker-rent` | — | Async rent estimator (drains `rent_calc_status='pending'`). |

---

## 2. Data & model state

- `listings`: ~981K rows; **99.8%** census-tract tagged.
- `rental_listings`: ~391K rows; **99.8%** census-tract tagged.
- `rent_calc_status`: **done ≈ 980.9K**, **failed = 1,519**, pending ≈ 0.
- `h3_market_stats`: 116K rows, **90,413** distinct H3 res-8 hexes.
- `tract_demographics`: **84,400** rows (ACS 2023).
- `address_rent_history`: populated (P2 prior-rent memory).

**Rent model: v1, 30 features (P1 hyperlocal + P2 history + P3 temporal)**

Features: `beds, baths, sqft_log, year_built, lot_sqft_log, hoa_fee, lat, lng, ptype_code, zip_te, hud_anchor_log, zcta_med_income_log, zcta_med_rent_log, tract_te, h3_te, local_rent_psf_log, local_sold_psf_log, local_obs_log, tract_med_income_log, h3_8_obs_log, h3_9_obs_log, years_since_last_sale, last_sold_ppsf_log, last_sold_vs_local, last_sold_ratio_present, prior_rent_log, months_since_prior_rent, fmr_cagr_3yr, zcta_income_growth_5yr, zcta_rent_growth_5yr`

Artifacts: `/models/rent_v1/{p10,p50,p90}.txt` + `metadata.json`.

**P0 baseline (frozen):** overall MAE $357.0, highvar_zip_mae $688.2, within_zip_spearman 0.912, band_coverage 0.546.

**P1 retrain (2026-07-09 07:49 UTC):** overall MAE $358.2, highvar_zip_mae $688.0, within_zip_spearman 0.910, band_coverage 0.548.

Note: P1 retrain shows near-identical metrics to P0 because the P0 baseline was already trained WITH P1 features (the P1 commit preceded the baseline freeze).

**Model/feature invariant:** `services/ml_rent_estimator/dataset.py` `FEATURE_NAMES` and the trained model on disk must have the **same feature count**. If you add/remove a feature you **must retrain** (`POST ml:8000/ops/run-train`).

---

## 3. Scheduler jobs

| Job | UTC Time | Endpoint | Notes |
|---|---|---|---|
| Market stats refresh | 00:30 | `POST /ops/refresh-market-stats` | H3 rent/sold $/sqft surface + address_rent_history |
| Census tract increment | 00:40 | Direct SQL | Last 2 days of rental_listings |
| Nightly retrain | 01:00 | `POST /ops/run-train` | Train + eval gate + promote |
| Drift monitor | 02:00 | `POST /ops/run-drift` | Feature drift check |
| Eval (weekly) | Sun 03:00 | `POST /ops/run-eval` | Legacy eval harness |

---

## 4. Migrations applied (out-of-band)

- `2026_07_09_rental_census_tract.sql` — column + partial index. **Applied.**
- `2026_07_09_backfill_rental_census_tract.sql` — keyset backfill procedure. **Applied (390K rows filled).**
- `2026_07_09_h3_market_stats.sql` — H3 market stats table. **Applied.**
- `2026_07_09_tract_demographics.sql` — ACS tract demographics. **Applied (84.4K rows).**
- `2026_07_08_perf_indexes.sql` — 4 perf indexes. **Applied.**
- `2026_07_08_repend_ml_outage_failed.sql` — re-pended 24,808 rows. **Applied.**

---

## 5. Monitoring

- Alert rules: `RentFailuresHigh` (>5000 failed for 1h), `RentBacklogGrowing` (>50K pending for 24h).
- Alertmanager → Telegram (live config at `/etc/prometheus/rules/alertmanager.runtime.yml`, gitignored).

---

## 6. Traps

1. **Root-file corruption** — `/opt/onepercent/Dockerfile` and `package.json` may be overwritten by other agents. Verify before deploy.
2. **Never `docker compose down`** — use systemd: `systemctl restart oper-ml`.
3. **Feature/model count must match** — retrain after any dataset feature change.
4. **Band coverage is 0.548** — well below 0.78–0.84 target. Warning-only at P0–P2; becomes hard gate at P3.
