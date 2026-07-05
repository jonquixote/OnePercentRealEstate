# OnePercentRealEstate — Full Upgrade Plan v2 (Design Spec)

**Date:** 2026-07-05
**Status:** Design approved by owner; implementation plan to follow.
**Supersedes:** `plans/m-plan1.md`, `plans/dsi-plan1.md`, `plans/g-plan1.md`, `docs/plans/*` (May-era audits, pre-monorepo paths, largely stale). This spec is grounded in a live production audit performed 2026-07-05.

---

## 1. Context

OnePercentRealEstate is a real-estate-investor analytics platform: Next.js 16 monorepo
(`apps/one` consumer, `apps/two` pro terminal, `apps/worker` background jobs), Postgres 16 +
PostGIS + pg_tileserv, Redis, Python homeharvest scraper (`services/scraper_service`), FastAPI
ML rent service (`services/ml`), all self-hosted via docker-compose on a single 15 GB VPS
(209.94.61.108) behind host nginx. Multi-strategy underwriting rules engine
(`packages/primitives/underwriting.ts` + `underwriting_rules` table) shipped June 2026.

### Ground truth audit — 2026-07-05 (live server)

**Healthy: ingestion.**

| Signal | Value |
|---|---|
| Listings | 936,374 (+10–26K/day) |
| Rental comps (`rental_listings`) | 341,339, fresh same-day |
| Crawl queue | 36 pending / 84,636 completed — draining fine |
| Distress classification | live (auction 3,749 · foreclosure 2,815 · short_sale 1,203 · reo 291 · pre_fc 37) |
| Disk / RAM | 21% used / 3.9 of 15 GB |

**Broken: enrichment + safety.**

| # | Problem | Evidence |
|---|---|---|
| P1 | ML service crash loop | `RestartCount=2472` (~every 2 min for 4 days). Exit code 0, not OOM. "ML model not available" warning at boot — no trained model artifact. `rent_estimator_v2.py` placed on server Jul 1, absent from git, never wired. Prime suspect: `worker-ml-scheduler` container restart cadence, or v2 file import path. |
| P2 | Rent engine dead in water | 633,435 rows `estimated_rent = 0.00`; 613,433 `rent_calc_status='pending'`; 171,245 stuck `'failed'` (never retried — worker marks ML connection-refused as permanent failure). Throughput 453 predictions / 6 h ⇒ ~436 days to drain. |
| P3 | Rent values weak even when present | Model `v0` = HUD FMR + comps fallback; 724K v0 audit rows; clustered point guesses (~$2,000). The 1% rule — the product's core metric — is computed from this. |
| P4 | Zero backups | No pgbackrest, no crontab, nothing. Repo scaffolding from Wave 7 never activated. |
| P5 | Postgres stock config | `shared_buffers=128MB` on a 15 GB box; `work_mem=4MB`; PostGIS + 1.6M-row MV refresh + tile serving starved. |
| P6 | Free data discarded | `raw_data` JSONB (100% of rows) carries hoa_fee (~65% non-null), estimated_value (~80%), county, fips_code, neighborhoods, property_url, permalink, last_sold_price/date, assessed_value, description `text`, style, parking_garage, lot_sqft, new_construction, nearby_schools. Scraper extracts **only `alt_photos`**. Columns `hoa_fee`, `tax_annual_amount`, `property_url` exist and are **0% populated**. Tax data requires homeharvest `extra_property_data` flag (currently null in raw_data). |
| P7 | Price changes silently lost | `listings_history` table exists, **0 rows** — no trigger ever wired. Price-cut signal (motivated sellers) not captured. |
| P8 | Zero users | `profiles`, `watchlists`, `saved_searches`, `alerts`, `stripe_webhook_events` all 0 rows. Login stub; `STRIPE_PRICE_MONTHLY=PLACEHOLDER` in prod env. `worker-watchlist-alerts` container runs against empty tables. |
| P9 | Deployment forked | Last 3 commits configure Vercel for `apps/one` while server nginx+docker serves one.octavo.press / two.octavo.press. `NEXT_PUBLIC_SITE_URL` points at a third domain (`onepercent.octavo.press`). |
| P10 | `two` terminal is a skeleton | 2 pages. SQL expression bar deferred although `packages/query-lang` is already built and `/api/properties/query` exists. |
| P11 | Misc debt | `status` column = `'watch'` for all 936K rows (dead); Mapbox token still in env after MapLibre migration; MapLibre swap itself unverified end-to-end; alertmanager restart-looping placeholder; secrets rotation from Wave 7 still outstanding. |

---

## 2. Decisions (locked with owner, 2026-07-05)

| Decision | Choice | Rationale |
|---|---|---|
| North star | **Data truth first** | 0 users today ⇒ product truth > launch speed. Everything downstream depends on trustworthy numbers. |
| Rent estimator | **Train real model** (LightGBM on 341K rental comps) | Free; uses data already collected; per-metro eval vs HUD baseline makes quality measurable. |
| Deployment | **Self-hosted canonical** | DB + tiles live on the server; drop Vercel configs (or park as PR-preview only); one deploy path. |
| Plan shape | **Two-track parallel** (Track D data, Track P product) after a solo Wave 0 | Tracks touch disjoint code (scraper/ML/SQL vs auth/UI); faster wall-clock; merge at Wave 4. |

### Non-goals (this cycle)

- No Supabase / managed-DB migration (standing decision).
- No image rehosting — links-first stands; `media_source` layer stays dormant.
- No unified single frontend — two-app strategy stands.
- No paid data APIs (RentCast etc.).
- No listings partitioning yet — documented plan only; trigger at ~3M rows or p95 breach (~mid-2027 at current growth).
- No STR revenue data (ADR) — STR strategy stays provisional.

---

## 3. Objectives + exit criteria

| Objective | Metric at cycle end |
|---|---|
| Trustworthy rent | ≥95% of listings carry model rent + confidence band; backlog <10K; full drain <24 h |
| Model quality | Beats HUD-FMR baseline MAE by ≥15% overall; per-metro eval dashboard exists |
| Complete data | hoa/tax/url/county/last-sold coverage ≈ source availability (65–80%); `listings_history` capturing changes daily (>0 rows/day) |
| Safety | Nightly backup + **tested restore**; ML uptime >99% over 7 days |
| Performance | Viewport/list API p95 <300 ms; LCP <2.5 s; PG tuned |
| Launch-ready | Auth + watchlist alert email fire end-to-end; Stripe unblocked |
| Pro terminal | SQL bar (query-lang) + watchlists live on `two` |

---

## 4. Wave specifications

Every wave: own branch → tests + typecheck → deploy via `/opt/onepercent/infrastructure/deploy.sh` → verify on live server → memory/progress update. Cross-cutting engineering standards (established for the rules platform, carried forward): one explainable truth in `@oper/primitives`, lifecycle-aware config, provenance on derived data, observability views for every pipeline, large-table discipline (CHECK … NOT VALID + VALIDATE, CREATE INDEX CONCURRENTLY, keyset-batched backfills, never long-hold locks on `listings`).

### Wave 0 — Stop the bleeding (1–2 days, solo, blocks everything)

**Pre-flight:** reconcile in-flight work by other agents — `rent_estimator_v2.py` on server (not in git) and locally modified `apps/worker/dist/*`. Adopt-or-archive explicitly before touching ML. **Acceptance: v2 file is either committed to git under `services/ml/` and wired, or removed from the server and archived in a `graveyard/` directory with a note in AGENTS.md; local `dist/*` modifications likewise adopted or reverted. No ghost state remains.**

1. **Backups.** Day-1 stopgap: nightly `pg_dump -Fc` to local disk (113 GB free) with 7-day rotation + failure alert. Then activate repo pgbackrest scaffolding (full weekly + incr daily + WAL archiving). Offsite (B2) when bucket decision lands — listed as owner action, not a blocker. **Acceptance: restore tested into a scratch container, documented timing.**
2. **ML crash root-cause.** Diagnose the 2-min death cycle (scheduler container vs v2 file vs healthcheck interplay). Fix so ML stays up unsupervised. **Acceptance: RestartCount stable over 24 h.**
3. **Rent worker resilience.** ML connection-refused / timeout = transient ⇒ keep `pending` + exponential backoff; circuit-break during ML outage instead of mass-failing. One-time sweep: re-pend the 171,245 stuck `failed` rows. **Acceptance: ML restart under load produces 0 new permanent `failed` rows.**
4. **Postgres tuning.** `shared_buffers=4GB`, `effective_cache_size=10GB`, `work_mem=64MB`, `maintenance_work_mem=1GB`, `random_page_cost=1.1`, `wal_compression=on`, enable `pg_stat_statements`. One coordinated restart, backup taken first. **Acceptance: settings live; MV refresh + viewport p95 measured before/after.**
5. **n8n interference freeze.** Audit n8n for active crawl workflows; if any are writing to `listings` or the crawl queue, disable the workflow triggers (leave container running) for the duration of Waves 0–3. Re-enable or decommission at Wave 8. **Acceptance: no n8n-originated writes observed during the freeze window.**
6. **Secrets rotation** (owner actions, tracked not blocking — except FRED, which gates Wave 3): n8n PG password, FRED key, server root password, Stripe live key + real `STRIPE_PRICE_*`.

### Track D — data truth

### Wave 1 — Free data harvest (3–5 days)

1. **Scraper extraction.** Map all homeharvest fields → columns: `hoa_fee`, `property_url` (permalink), `county`, `fips_code`, `neighborhoods`, `last_sold_price`, `last_sold_date`, `assessed_value`, `estimated_value`, `description`, `style`, `parking_garage`, `lot_sqft`, `new_construction`, `list_date`; derive `price_per_sqft`. New-column migration first (nullable adds — instant).
2. **`extra_property_data=True`** for tax + tax_history + schools. Measure request-volume cost on one ZIP before fleet-wide enablement; add throttle/sampling if needed (risk R1).
3. **Backfill 936K existing rows from `raw_data` via SQL only** — no re-scrape. Keyset-batched procedure in `infrastructure/migrations/out-of-band/` (same pattern as the rules-engine backfill).
4. **`listings_history` trigger** on UPDATE OF price / status / mls_status → history row. Derived cols: `last_price_change_pct`, `price_cut_count`. History starts now (no retroactive data exists).
5. **External free sources:** Census ACS ZIP demographics (median income, rent burden), FEMA flood zone by point, FRED mortgage rate wired into underwriting config.
6. **Hygiene:** drop dead `status` column; coverage observability as a **Postgres view** (e.g. `vw_field_coverage`: per-column % by scrape date — not a one-off script; it is the input to the Wave 7 `raw_data` retention gate); `estimated_rent=0` → NULL semantics fix rides Wave 2.

**Acceptance:** new scrapes populate all fields; backfill coverage matches raw_data availability (hoa ~65%, est_value ~80%); history rows accrue; coverage view live.

### Wave 2 — Rent engine v1 (~1 week)

1. **Dataset build:** 341K `rental_listings` joined to listing features; dedup, outlier fences (winsorize ~$300–$10K), time-decay weights.
2. **Model:** LightGBM, target log(rent). Features: beds, baths, sqft, property_type, geo (lat/lng or H3 cell), ZIP target-encoding, HUD-FMR anchor ratio, ACS median income, year_built, lot_sqft. Quantile heads (P10/P90) → confidence bands. Start global model with ZIP features; evaluate per metro.
3. **Eval harness** in `services/ml`: MAE/MAPE/RMSE per metro vs HUD-FMR baseline and v0. **Promotion gate: only ship if ≥15% MAE win overall.** Registry row `v1` in `rent_models` with metrics jsonb.
4. **Batch scoring path:** worker pulls 10K-row batches → ML `/predict_batch` → single `UPDATE … FROM` write-back. Replaces per-row HTTP for backlog; LISTEN path stays for realtime inserts. Target: drain ~784K in <48 h.
5. **Lifecycle:** nightly retrain via the (fixed) ml-scheduler; drift monitor (PSI — `services/ml/drift.py` exists); auto-rollback to prior model on eval regression.
6. **Schema:** add `rent_low`, `rent_high` (or reuse audit jsonb); `estimated_rent=0` → NULL migration; re-pend all listings once v1 promoted; full drain.

**Acceptance:** promotion gate passed; backlog <10K after drain; confidence bands populated; nightly retrain observed once; UI-visible values change plausibly.

### Wave 3 — Underwriting truth (3–4 days)

1. Real `tax_annual_amount` (from extra_property_data; fallback `assessed_value ×` county millage table) and real `hoa_fee` into NOI in `underwriting.ts`. Per-input **provenance flag: real vs estimated**.
2. FRED live 30-yr rate replaces hardcoded mortgage rate (rate source + refresh in `underwriting_rules` config). **Gate: a working FRED key must be live before this wave deploys. If unavailable, this line item is a Wave 3 blocker — surface to owner; do not silently ship the hardcoded rate under an "underwriting truth" banner.**
3. State-level insurance estimate table (public averages) replaces flat %.
4. Scorecard chips: "from tax records" vs "estimated". One-truth constraint holds: all math in `@oper/primitives/underwriting.ts`, SQL parity test extended for new inputs.
5. Flip ARV: derive from `estimated_value` or comps P75 $/sqft × sqft; STR stays provisional.

**Acceptance:** cap rate / cash-flow visibly shift for tax-real listings; provenance chips render; parity test green.

### Track P — product (parallel after Wave 0)

### Wave 5 — Launch rails (~1 week)

1. Auth wiring end-to-end (existing stub → real login; `profiles` rows created; protect account surfaces).
2. Watchlists + saved searches activated in `one` UI; `worker-watchlist-alerts` wired to Resend; digest email = price cuts + new matches on watched criteria. **The retention loop.**
3. Stripe: real price IDs (owner supplies), checkout + webhook (DLQ already built) verified in test mode; paywall boundary decided at wave time (default: free browse, paid alerts/exports).
4. `two` gets `/api/healthz`; uptime checks for both apps.
5. **Null-safety note:** Wave 2 converts `estimated_rent=0` → NULL. All Track P UI built in this wave must null-guard rent-derived displays (no "$NaN", no 0-as-real-value) since Track P can deploy before/while Wave 2 drains.

**Acceptance:** signup → watchlist → triggered email works on prod; Stripe test-mode checkout completes.

### Wave 6 — `two` pro terminal buildout (1–2 weeks)

1. SQL expression bar backed by `packages/query-lang` + existing `/api/properties/query`; saved queries.
2. Watchlist pane + alert-rule builder (maps to existing alert tables).
3. Portfolio P&L (manual entries + live listing values), compare tray.
4. Grid: column picker, saved layouts, CSV export. Command palette on existing hotkeys primitive.

**Acceptance:** analyst can go query → grid → watchlist → alert without leaving `two`.

### Merge + hardening

### Wave 4 — Investor surfaces (~1 week, needs W2 + W3)

1. Price-cut everywhere: badge (−X% since list), history sparkline on detail, "reduced" rail on home, sort by biggest cut. **Motivated-seller score** = cuts + DOM + distress type.
2. Detail enrichment: source link (`property_url`), schools, neighborhood, last-sold, est-value-vs-list gap badge ("listed 8% under estimate"), sanitized description.
3. Filters: HOA max, price-cut, DOM, min rent confidence.
4. **Verify MapLibre migration end-to-end** (fresh Mapbox→MapLibre swap is unverified; tiles via pg_tileserv). **Pass = all four observable facts: tiles load at zoom 8–14; property pins render from the viewport query; zero console errors referencing `mapbox-gl`; Mapbox token removed from prod env.**
5. SEO enrichment of `/market/[zipcode]` pages (ACS + FMR trend), sitemap, OG images — free growth channel.

**Acceptance:** screenshot-verified on prod; price-cut data flows list→detail→map consistently.

### Wave 7 — Performance + scale (3–5 days, interleaved)

1. Index audit from `pg_stat_statements` (expected: composite (sale_type, listing_type, price); zip; partial index on ratio sorts; history (listing_id, changed_at); verify geom GIST).
2. MV refresh cost measured; refresh-on-threshold or cadence tuning; nginx cache headers for pg_tileserv (~60 s).
3. **`raw_data` decision gate (owner):** after Wave 1 extraction, keep / cold-table / drop with 90-day retention. Biggest storage lever. Decision input = the Wave 1 `vw_field_coverage` view (proves extraction completeness before anything is discarded).
4. Cursor pagination coverage, Redis hit-rate check; targets: viewport p95 <300 ms.
5. Bundle audit both apps (map chunk-split, lazy images); LCP <2.5 s on 4G.
6. Partitioning plan documented only (by state or created_at; trigger ~3M rows).

### Wave 8 — Ops maturity (2–3 days, rolling)

1. Alertmanager fixed (currently restart-looping placeholder) → real channel (email/Telegram). Rules: scrape stalled 6 h, rent backlog growing 24 h, ML down 5 m, disk >80%, backup failed, app 5xx spike.
2. Grafana dashboards: pipeline (scrapes/day, rent coverage %, backlog, model MAE by metro), infra (exporters already running).
3. CI gates on PR: typecheck, vitest, next build, migration dry-run against shadow DB.
4. DR drill: timed restore to scratch; targets RPO ≤24 h (≤5 min once WAL archiving live), RTO ≤2 h; runbook updated.
5. **Deployment consolidation:** remove/park Vercel configs, fix `NEXT_PUBLIC_SITE_URL`, document the single deploy path.
6. n8n decommission decision (workflows disabled since the Wave 0 freeze): worker owns crawl; if the ZIP iterator is redundant, retire container (frees RAM); re-enable only if ad-hoc value found.

---

## 5. Sequencing

```
W0 ──► W1 ──► W2 ──► W3 ──► W4 ──► W7 ──► W8 (rolling)
  └──► W5 ──► W6 ────────────┘
        (Track P, parallel)
```

~6–8 weeks of focused agent work. Track P may start any time after Wave 0; Wave 4 requires W2 + W3 complete.

---

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `extra_property_data` multiplies homeharvest request volume | Measure on one ZIP first; throttle/sample; tax fallback via assessed_value × millage exists |
| R2 | Rental comps distribution ≠ sale-listing distribution (model bias) | HUD anchor feature; per-metro eval; confidence bands; promotion gate makes failure visible |
| R3 | PG restart = brief downtime | Wave 0 window, backup first, off-peak |
| R4 | Another agent mid-flight on server ML | Wave 0 pre-flight reconciles `rent_estimator_v2.py` + local dist changes before any ML work |
| R5 | Backfill on 936K rows locks/bloats | Keyset batches, out-of-band procedure, autovacuum headroom check after |
| R6 | MapLibre swap already broken in prod unnoticed | Wave 4 verification pass is explicit; screenshot QA |

---

## 7. Owner actions (tracked, non-blocking)

1. Rotate: n8n PG password, FRED key, server root password, Stripe live key (all outstanding since Wave 7). **Exception to "non-blocking": the FRED key gates the Wave 3 deploy** (see Wave 3 item 2).
2. Supply real `STRIPE_PRICE_*` IDs (Wave 5).
3. B2 (or other) offsite bucket decision (Wave 0 follow-up).
4. `raw_data` retention decision at the Wave 7 gate.

---

## 8. Verification protocol (every wave)

1. `pnpm typecheck` + `pnpm test` + `next build` green locally.
2. Migrations applied on prod via runner (single-transaction files; OOB steps documented in run order).
3. Deploy via `deploy.sh`; rollback images auto-tagged.
4. Live verification: healthz 200s, endpoint spot-checks, container logs 0 new errors, and the wave's own acceptance criteria above.
5. Update progress memory + `documentation/` runbook if ops-relevant.
