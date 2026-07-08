# Deployment & Maintenance State — 2026-07-08

Authoritative snapshot of the production server's known-good state after the
2026-07-08 ML-outage incident and frontend-overhaul work. If you are about to
deploy, read **§4 Deploy procedure** and **§8 Traps** first — one of them
(root-file corruption) silently boots the crawler on the public web port.

- **Host:** `209.94.61.108` (2-core, 15 GB RAM, ~148 GB disk). `ssh -i ~/.ssh/id_onepercent root@209.94.61.108`.
- **Repo on server:** `/opt/onepercent` (rsync target of local `/Users/johnny/Code/OnePercentRealEstate/`).
- **Compose file:** `infrastructure/docker-compose.yml`, driven by `infrastructure/deploy.sh` (thin wrapper: sources `.env`, runs `docker compose -f infrastructure/docker-compose.yml "$@"`).
- **Another agent may also be operating on this server** — assume root-level files can change under you (see §8).

---

## 1. Service topology (20 containers, all healthy 2026-07-08)

| Container | Public/bind port → internal | Role |
|---|---|---|
| `app` | `:3001 → 3000` | **one.octavo.press** — Next.js consumer app. Image `infrastructure-app`, CMD **must** be `node apps/one/server.js`. |
| `two` | `:3002 → 3000` | **two.octavo.press** — pro terminal (Next.js). |
| `postgres` | `127.0.0.1:5432` | PostgreSQL 16.4 + PostGIS. DB name is **`postgres`** (not `onepercent`). |
| `redis` | `127.0.0.1:6379` | cache / queues. |
| `ml` | `8000` (internal only) | FastAPI rent estimator, 3 uvicorn workers. Model **v1**, 13 features. |
| `scraper` | `127.0.0.1:8001 → 8000` | FastAPI homeharvest scrape service. |
| `pg_tileserv` | `127.0.0.1:7800` | MVT tiles for the map. |
| `worker` | — | crawl orchestrator. |
| `worker-rent` | — | async rent estimator (drains `rent_calc_status='pending'`). |
| `worker-refresh` | — | cluster-tile refresh. |
| `worker-ml-scheduler` | — | nightly retrain 01:00 / drift 02:00 / eval Sun 03:00 UTC. |
| `worker-media-health` | — | photo-URL health crawler. |
| `worker-watchlist-alerts` | — | watchlist/saved-search notifier. |
| `prometheus` / `alertmanager` / `grafana` | `127.0.0.1:9090` / `:9093` / `:3003` | monitoring. |
| `postgres-exporter` / `redis-exporter` / `cadvisor` | internal | metrics. |
| `n8n` | `:5678` | legacy automation (frozen). |

Deploy touches `app`, `two`, `ml`, `scraper`, and the `worker-*` set. **Never touch** postgres/redis data volumes; **never run `docker compose down`** (recreates the whole stack).

---

## 2. Data & model state

- `listings`: ~981.6K rows; **99.4%** census-tract tagged (`census_tract`).
- `rent_calc_status`: **done ≈ 980.9K**, **failed = 1,519** (all genuinely un-estimatable — 1,507 no lat/lon, the rest non-rentable types), pending ≈ 0.
- Rent model: **v1**, features = `[beds, baths, sqft_log, year_built, lot_sqft_log, hoa_fee, lat, lng, ptype_code, zip_te, hud_anchor_log, zcta_med_income_log, zcta_med_rent_log]` (13). Artifacts in the `ml_models` volume at `/models/rent_v1/{p10,p50,p90}.txt` + `metadata.json`. Last retrain holdout **MAE $487.90** vs HUD baseline $780.54, MAPE 15.3%, band coverage 76%.
- Track B data: `sold_listings` ~13.8K (accruing), `zcta_demographics` 67.5K (ACS), `census_tracts` 84.4K (83.2K NRI-scored), `hud_safmr` ~193K.

**Model/feature invariant:** `services/ml_rent_estimator/dataset.py` `FEATURE_NAMES` and the trained model on disk must have the **same feature count**. If you add/remove a feature you **must retrain** (`POST ml:8000/ops/run-train`) or ML will `LightGBMError` on every predict and fall back to `v0-fallback`. This exact mismatch (code 13 vs model 11) caused the 2026-07-08 outage.

---

## 3. Resource limits (docker-compose `deploy.resources.limits`)

- `ml`: **memory 4 G** / cpus 2. Was 3 G — the retrain subprocess shares the cgroup with the 3 uvicorn workers and OOM-killed itself at 3 G. Do not lower.
- `postgres`: ~6 G (peaks ~4.7 G).
- `app`/`two`: ~2 G each.
- Host headroom is tight (~2 G free, ~7 G available). Do not add heavy new services without checking `free -g`.

---

## 4. Deploy procedure

```bash
# 1. Push code (from local repo root). NEVER drop these excludes:
rsync -az \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude .venv --exclude venv --exclude .turbo \
  --exclude infrastructure/monitoring/alertmanager/alertmanager.runtime.yml \
  -e "ssh -i ~/.ssh/id_onepercent" \
  ./ root@209.94.61.108:/opt/onepercent/

# 2. Build + recreate ONLY the changed service(s), never the whole stack:
ssh -i ~/.ssh/id_onepercent root@209.94.61.108 \
  'cd /opt/onepercent && ./infrastructure/deploy.sh build <svc> \
   && ./infrastructure/deploy.sh up -d --no-deps <svc>'
```

Service names: `app`, `two`, `ml`, `scraper`, `worker-rent`, `worker-refresh`, `worker-media-health`, `worker-ml-scheduler`, `worker-watchlist-alerts`.

**MANDATORY when building `app`** — verify the image before deploying (see §8):

```bash
docker inspect infrastructure-app --format '{{.Config.Cmd}}'
# MUST print: [node apps/one/server.js]   (NOT crawl.js)
```

Then smoke-test: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` → `200`.

---

## 5. Migrations

- **Runner migrations:** `infrastructure/migrations/*.sql` — each wrapped in one `BEGIN/COMMIT`, auto-recorded in `schema_migrations`.
- **Out-of-band:** `infrastructure/migrations/out-of-band/*.sql` — anything that can't run in a transaction (`CREATE INDEX CONCURRENTLY`) or is a large-table backfill. **Run by hand**, statement-by-statement, via `docker exec infrastructure-postgres-1 psql -U postgres -d postgres -f <file>`.
- Applied out-of-band on 2026-07-08:
  - `2026_07_08_perf_indexes.sql` — 4 perf indexes (census_tract, rental GiST, NRI score, zip/type/sale composite). **Applied.**
  - `2026_07_08_repend_ml_outage_failed.sql` — re-pended 24,808 rows condemned by the outage. **Applied (idempotent; safe to re-run).**

**Large-table discipline:** backfills never touch `updated_at` or rent columns wholesale, use keyset batching + `FOR UPDATE SKIP LOCKED` for big mutations, and never deadlock against the live crawler upserts.

---

## 6. Monitoring & alerts

- Alert rules load into Prometheus from `/etc/prometheus/rules/*.yml`. Rent alerts (gauge-based, off `postgres-exporter` `rent_calc_status_count`):
  - **`RentFailuresHigh`**: `rent_calc_status_count{status="failed"} > 5000` for 1h. **Absolute count** — it stays firing until failed rows are cleared, it does not self-clear when new failures stop. Currently 1,519 → resolved.
  - **`RentBacklogGrowing`**: `rent_calc_status_count{status="pending"} > 50000` for 24h.
- Alertmanager → Telegram. **Live receiver config is server-only** at `infrastructure/monitoring/alertmanager/alertmanager.runtime.yml` (gitignored, contains the bot token, mounted by compose). The repo's `alertmanager.yml` is a placeholder template. **Never commit the token; always keep the `--exclude` on runtime.yml in rsync.**

---

## 7. Data-quality guards (do not remove)

- **Future sold dates:** the scrape source feeds placeholder/typo dates (`2099-01-01` = pending sentinel, future typos). Guarded at ingest (`services/scraper_service/main.py` rejects `sold_date > today`) **and** in every read path that counts sold comps (`market/[zipcode]` page, `api/properties/[id]/comps` ARV route) with `sold_date <= now()`.
- **ARV = P75 sold $/sqft × subject sqft** (Track B §B4), needs ≥5 priced+sized comps. Do **not** revert to `median_sold_price × 0.7` — that's the 70%-rule MAO discount, not ARV, and double-discounts inside `maoFlip`.
- **1%-gate:** `is_rentable(property_type) AND estimated_rent IS NOT NULL AND (estimated_rent/price) >= resolve_rule(...).target_ratio`. Keeps houseless land out of the pass list.

---

## 8. Traps (read before deploying)

1. **Root-file corruption (highest risk).** `/opt/onepercent/Dockerfile` and `/opt/onepercent/package.json` have repeatedly been found overwritten with **apps/worker's** versions (another agent's build workflow). Effect: `deploy.sh build app` builds the *worker* image, so `app` boots `crawl.js` — no HTTP server, every page returns `000`, and `docker logs infrastructure-app-1` shows `service:"worker"`. It also breaks `pnpm install --frozen-lockfile` (`ERR_PNPM_OUTDATED_LOCKFILE`). **rsync does not reliably fix it** (it survived two `rsync -az` pushes). Recovery: `scp` the correct local `Dockerfile` + `package.json` to `/opt/onepercent/`, rebuild, and verify the image CMD is `node apps/one/server.js` (§4) before `up -d`.
2. **Never `docker compose down`** — recreates postgres/redis; use `up -d --no-deps <svc>`.
3. **DB name is `postgres`**, not `onepercent`. `psql -U postgres -d postgres`.
4. **Feature/model count must match** (§2) — retrain after any dataset feature change.
5. **ML mem is 4 G for a reason** (§3) — retrain OOMs below it.
6. **runtime.yml holds a live token** (§6) — never commit or rsync it.

---

## 9. Outstanding / owner-gated

- `RESEND_API_KEY` — **missing**; alert emails stay dark until set in server `.env`. Only remaining built-but-inactive feature.
- B2 (Backblaze) image rehost bucket — deferred pending live traffic.
- Password rotations still pending: old `n8n` DB password, and any credential ever committed before 2026-07-05.
- Nightly retrain (01:00 UTC) now succeeds again (was failing Jul 7–8 on the dataset.py IndentationError + OOM); confirm the next run promotes cleanly.
