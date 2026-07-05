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

## Postgres before/after (Task 6)

_(appended by Task 6 Steps 1 + 4)_

## 24-hour acceptance (Task 10)

_(appended by Task 10 Step 1)_
