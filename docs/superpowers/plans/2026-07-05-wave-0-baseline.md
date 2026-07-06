# Wave 0 — Baseline Metrics

Captured at the start of `wave/0-bleed-stop` execution. All Wave 0 acceptance
checks (esp. Task 10) compare against these.

## Pre-flight reconciliation (Task 0)

- **Branch:** `wave/0-bleed-stop` off `main` @ `995ab74`.
- **`apps/worker/dist/*`:** the pre-session "modified" state was **stale build artifacts**, not hand-edits — committed `dist/rent-estimator.js` still carried the old hardcoded `NON_RENTABLE_TYPES` set while committed `src` already used `public.is_rentable()`. Fresh `tsc` build regenerated correct artifacts; committed as `661cafa`. (Prod rebuilds TS inside the Dockerfile, so stale dist never reached runtime.)
- **`rent_estimator_v2.py` ghost-file check:** local `md5 = f1337aec4b3b672e76ba3db8d813a21f`; server `/app/rent_estimator_v2.py` `md5 = f1337aec4b3b672e76ba3db8d813a21f` → **match**. File is committed to git under `services/` and wired via `services/ml/Dockerfile`. Spec pre-flight acceptance satisfied; no `graveyard/` needed.
- **`deploy.sh`:** thin wrapper — `cd /opt/onepercent; source .env; docker compose -f infrastructure/docker-compose.yml "$@"`. Later tasks use `/opt/onepercent/infrastructure/deploy.sh build <svc>` + `deploy.sh up -d --no-deps <svc>`.

## Baseline metrics — 2026-07-05 (~09:5x UTC)

| Metric | Value | Notes |
|---|---|---|
| `infrastructure-ml-1` RestartCount | **2863** | was 2472 at the pre-plan audit hours earlier → ~+390, confirms the ~2 min death cycle is ongoing |
| listings `rent_calc_status = done` | 153,340 | |
| listings `rent_calc_status = failed` | 176,279 | climbing (171,245 at audit) — the P2 bleed |
| listings `rent_calc_status = pending` | 613,401 | |
| `rent_predictions_audit` rows / 6 h | 541 | ⇒ ~2,164/day throughput at baseline |

Reference point from the 2026-07-05 pre-plan audit: RestartCount=2472,
pending=613,433, failed=171,245, done=151,728, audit_6h=453.

## Restore-test evidence (Task 1)

- First backup: `pg_20260705_221449.dump`, **1.6 GB**, custom-format `-Z 6`, `pg_dump` wall-clock ~2.5 min, TOC integrity gate passed.
- Cron installed: `17 3 * * *` (03:17 UTC nightly) → `backup.log` + `cron.log`.
- **Restore test into a scratch `postgis:16-3.4-alpine` container:**
  - `listings` = **943,020** (within one day's churn of the ~936K prod baseline ✓)
  - `underwriting_rules` = **21** ✓
  - restore wall-clock = **233 s (~4 min)** with `--jobs 2` — this is the RTO evidence for the Wave 8 DR drill.
- `spatial_ref_sys` duplicate-key noise on restore is expected (postgis template pre-seeds it) and does not affect the data tables above.

## Rent worker throughput + fire-drill (Task 5)

- **Sweep:** `UPDATE 176307` — all stranded `failed` rows re-pended. Post-sweep `failed` settled to **3** (genuine permanents: missing lat/lon).
- **Tuning path (measured, not guessed):**
  - concurrency 8 / 1 ML worker → ML OOM at 2G + 30s timeouts (over-provisioned).
  - concurrency 4 / 1 ML worker → stable, 0 timeouts, **0.67/s**.
  - concurrency 6 / **3 ML uvicorn workers** / ML 3G → **1.27/s ≈ 110K/day**, 0 timeouts, 0 breaker trips, ML mem 1.1G/3G, 0 restarts.
- **vs baseline 453/6h (0.021/s): ~60× throughput.** Backlog drains in ~7 days (was ~436). Full drain-to-zero is Wave 2's batch-scoring path; Wave 0's bar is "drains instead of mass-failing" — met.
- **Breaker fire-drill (spec Wave 0 item-3 acceptance):** restarted `infrastructure-ml-1` under load → `failed` **3 → 3 (delta 0)**. 80 in-flight requests stayed `pending`; breaker opened exactly once (guard prevented same-outage escalation); recovered to ~1.37/s within 30s of ML returning. **The mass-fail-on-outage failure mode is eliminated.**

## Postgres before/after (Task 6)

| Setting | Before | After |
|---|---|---|
| shared_buffers | 128 MB | **4 GB** |
| work_mem | 4 MB | **64 MB** |
| effective_cache_size | 4 GB | **10 GB** |
| maintenance_work_mem | 64 MB | **1 GB** |
| random_page_cost | 4 (HDD default) | **1.1 (SSD)** |
| wal_compression | off | **on** |
| pg_stat_statements | absent | **preloaded + extension created** |
| container mem limit | 4 G | 6 G |

- Restart: `deploy.sh up -d postgres`, fresh 1.6 GB backup taken first, ~25 s downtime.
- **All dependents reconnected:** app `/api/healthz` 200; worker-rent reconnected and drained 76 rows within 90 s; `two` root page 200 (healthy, 0 restarts).
- **Pre-existing (NOT a restart regression):** `two /api/healthz` returns 500 — its healthz route proxies to `localhost:3000` and ECONNRESETs (was `000` at the pre-plan audit). This is the Wave 5 "two gets a real /api/healthz" item.
- **Hot query still full parallel seq scan + sort** (`SELECT … WHERE sale_type/listing_type/price ORDER BY rent_price_ratio`) — no supporting index. Tuning helps sort/cache; the composite index is the Wave 7 `pg_stat_statements`-driven audit target.
- pg mem right after restart: 366 MB (shared_buffers pages allocate lazily as touched).

## Acceptance — T+~1 h snapshot (Task 10) + 24 h gate baseline

Captured 2026-07-05 23:18 UTC, ~1 h after the clean 3-ML-worker deploy.

| Criterion | Target (24 h) | T+1 h reading | Status |
|---|---|---|---|
| ML RestartCount | delta 0 over window | **0** (baseline for the 24 h delta) | ✅ on track |
| ML memory | no climb | 1.16 GB / 3 GB, flat | ✅ (was OOM-climbing to 668 MB/768 MB pre-fix) |
| `failed` rows | < 5,000 | **5** | ✅ (mass-fail mode eliminated; fire-drill proven) |
| `pending` trajectory | falling | 788,027, falling at ~1.27/s clean-state | ✅ draining (~110K/day; full drain is Wave 2) |
| Nightly backup | overnight `ok` | 2 dumps on disk; cron `17 3 * * *` armed | ⏳ overnight cron fires 03:17 UTC |
| PG tuning | held | `shared_buffers=4GB` | ✅ |
| Apps | 200 | app 200, two-root 200 | ✅ |

**24 h gate remains open on two passive items:** (1) confirm ML RestartCount is still 0
at ~2026-07-06 23:18 UTC; (2) confirm `backup.log` shows an overnight `ok` line dated 07-06.
Every *mechanism* is already verified (OOM root-caused + fixed, breaker fire-drill passed,
restore tested at 233 s) — the gate is a watch, not new work.

**Throughput caveat:** the "last 60 min" audit count at snapshot time (2,040) is depressed by
the earlier in-hour tuning churn (concurrency-8 timeout storm, the 5-min breaker park, several
redeploys). The clean steady-state rate is 1.27/s (measured over an uninterrupted 180 s window).
