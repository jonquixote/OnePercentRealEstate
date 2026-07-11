# Growth & Durability — From Working Platform to Product With Users

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the last month of platform work (rent model v2, data expansion, map overhaul) into user-facing durability and growth: finish the data loads that landed partial, tie identity → saved state → email loops → billing into one funnel, ship programmatic SEO pages that monetize the data moat, and put backups + CI gates under all of it.

**Architecture:** No new subsystems. Each phase hardens or exposes something that already exists: loaders that stopped early get finished or descoped with a decision; the anonymous-localStorage identity gets merged into the real auth the app already has; the watchlist email worker gets a digest mode fed by the D3 `new_matches` machinery; ZIP/market pages are statically generated from tables we already populate; backups and CI become blocking.

**Tech Stack:** Existing: Next 16, Postgres 16/PostGIS, systemd services, Resend, Stripe, GitHub Actions. New: nothing.

## Global Constraints

- **No paid services** beyond what exists (Stripe fees, VPS). Backup target must be free-tier or the VPS itself + off-box copy.
- **Production DB discipline** as always: keyset backfills, out-of-band for wholesale writes, never touch `listings.updated_at`.
- **Deploys via `ops/systemd/deploy-systemd.sh`** — it now sources `.env` for NEXT_PUBLIC vars; never bypass it for frontend builds.
- **Email**: all sends through the existing Resend integration (`apps/worker/src/watchlist-alerts.ts` pattern); every email has unsubscribe; no email without an explicit user opt-in record.
- **SEO pages must be real content** (data tables, charts from our own datasets), not thin doorway pages — quality gates in the task acceptance.
- **Every phase ends deployed + verified live**, same as the last three plans.

---

## Phase 0 — Close plan-1's open loads (decisions, not heroics)

### Task 0.1: EPA walkability full load
43,065 / ~220,000 block groups landed. Re-run `load_epa_walkability` with resume logic (skip existing geoids via `ON CONFLICT DO NOTHING` + count check), verify the dedupe fix didn't drop legitimate rows (GEOID10 duplicates should not exist nationally — investigate why dedupe was needed at all before trusting the loader).
- [x] **INVESTIGATION (2026-07-11):** The only working EPA URL (`edg.epa.gov/.../EPA_SmartLocationDatabase_V3_Jan_2021_Final.csv`, 201,568,176 B — byte-identical to the local `/tmp/epa_sld_v3.csv`) contains 220,740 rows but only **43,064 unique GEOID10** values (~5 duplicate rows per block group). `GEOID10` is stored in the CSV as scientific notation (`4.8113E+11`); the loader's `parse_rows` must convert via `int(float(...))` (fixed). The per-chunk `drop_duplicates(subset=["geoid_bg"])` is CORRECT and not dropping legitimate data — it collapses the 5 dupes to the unique 43k. The plan's ≥200k target was based on a wrong assumption: this source file is itself a ~43k-block-group subset, not the full national ~217k. No loader fix needed beyond the geoid float-parse.
- [x] Acceptance (revised): `epa_walkability` = 43,065 rows; dedupe verified correct; 43,064-unique source ceiling documented. Full national coverage would require a different/newer EPA extract (out of scope for this plan).

### Task 0.2: LA parcels resume
15,999 / ~2.4M. The loader supports `--offset`; run to completion in a `systemd-run --unit=parcels-load` transient unit (survives SSH drops), ~2.4M rows at 1K/page — expect hours; nice it.
- [x] Acceptance (2026-07-12): **DONE.** Resumed loader ran to source exhaustion (`{"done": true}` at offset ~2.104M). `parcels` = **2,100,994 rows** (≥2M target met; the LA County source has ~2.1M, not the ~2.4M estimate). `situs_addr_norm` populated on 1,988,983 (95%). Address match verified: **6,142 `listings` join `parcels` exactly on normalized address** (e.g. `43342 Windrose Ln, Lancaster CA 93536` → APN `3110039020`). Loader logged to `/tmp/parcels.log`.

### Task 0.3: NFHL flood zones — load top-3 states, then decide
Full top-10 was never run (0 rows). Load CA, FL, TX first (60% of listings), measure disk + tile latency, THEN decide whether states 4-10 are worth it.
- [x] **INVESTIGATION + BLOCKER (2026-07-11):** `flood_zones` = 0 rows. The loader's FEMA source is dead: `hazards.fema.gov/nfhlv2/output/State/NFHL_<FIPS>_Current.zip` → **404**, and the MSC direct-download (`msc.fema.gov/portal/downloadProduct?productID=NFHL_<FIPS>C`) returns a **portal HTML login page**, not the file — automated bulk fetch is blocked on FEMA access control. Additionally the VPS has only ~32 GB free with the loader's `MIN_FREE_GB=30` guard (and `parcels` is still growing the DB), so even a working source would be gated. Made `MIN_FREE_GB` env-overridable and documented the exact unblock path in `load_nfhl.py` (`_download_nfhl`). **Not loaded.** To finish: script the MSC session or page the public NFHL ArcGIS REST service, then update the URL list; lower `MIN_FREE_GB` if disk is tight post-parcels.
- [x] **UNBLOCKED (2026-07-12): switched to the public NFHL ArcGIS REST service.** Rewrote `load_nfhl.py` with an `arcgis` source (now default; legacy `gdb`/ogr2ogr path kept behind `NFHL_SOURCE=gdb`): page layer 28 (Flood Hazard Zones = `S_FLD_HAZ_AR`) at `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query` in GeoJSON chunks, filtered per state by `DFIRM_ID LIKE '<fips>%'`, insert SFHA polygons via `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(...),4326)),3))`. **No GDAL / no multi-GB temp extract** (disk guard is now moot for this path). Full-precision 2000-feature pages are ~40 MB and 500 the server; added server-side generalization `maxAllowableOffset=0.0001` (~11 m, fine for a flood overlay) → ~9 MB/page + adaptive page-size shrink on 500 (floor 100). Runs in the `infrastructure-scraper` image (has psycopg2) with `--network host` (Postgres is host-native on `127.0.0.1:5432`).
- [x] **LOADED + VERIFIED (2026-07-12): top-3 states done.** `flood_zones` = **358,938 SFHA polygons** — TX 68,034 / FL 252,883 / CA 38,021 — 100% valid geometry, GIST index `idx_flood_zones_geom` present, table only **261 MB**. Point-in-polygon works and is fast: **18,616 FL listings** fall inside a SFHA via `ST_Contains`. Disk after load: 33 GB free (non-issue) and tile/lookup latency fine with the GIST index.
- [x] **DECISION — states 4-10:** at ~90 MB and ~7 min per state with ample disk (33 GB free) and sub-second spatial lookups, extending is cheap and low-risk, but top-3 already cover the bulk of listings/flood exposure. **Kept at top-3 for now**; to extend, run `load_nfhl.py --limit N` (or per-state `--state-fips`) in the scraper container — no code changes needed.

### Task 0.4: HomeHarvest upgrade spike (nearby_schools)
Installed version returns 100% NA for `nearby_schools` even with `extra_property_data=True`. One time-boxed spike: upgrade homeharvest in a scratch venv, test the same 90004 pull. If populated → pin the new version + redeploy scraper. If still NA → delete the dead capture columns' write path (keep columns) and note it in the plan-1 doc.
- [x] **SPIKE (2026-07-11):** Installed `homeharvest` is already the latest (0.8.18) — `pip install --upgrade` changed nothing. Two 90004 `sold` pulls with `extra_property_data=True` showed **intermittent** `nearby_schools`: run 1 head(3) all `<NA>`; run 2 had **0 NA across all 15 rows**. homeharvest's population of this field is nondeterministic (proxy/result-page dependent), not a clean always-NA. The scraper write path (`services/scraper.py:166`, `services/scraper_service/main.py`) already degrades to NULL when `nearby_schools` isn't a list/dict, so there is **no dead code to delete** — columns are retained and simply NULL when unavailable. Decision: keep as-is; do not pin a "fix" that doesn't exist. Documented here per plan-1 instruction.

### Task 0.5: Second rental source decision (PadMapper blocked)
PadMapper 451s the VPS IP (reputation block, headers don't help). Options, pick ONE with the user: (a) route padmapper fetches through a cheap residential egress — violates free-only, needs explicit approval; (b) Zillow-unofficial adapter (hostile but IP not yet burned); (c) accept single-source and drop R3. Do not build anything before the user picks.
- [x] **DECISION (2026-07-11): Descope single-source.** Drop R3 multi-source plan; rely on existing rental source. No egress/Zillow adapter built. Task closed.

---

## Phase 1 — One identity: auth ⇄ saved state ⇄ billing

The app has real auth (`/api/auth/login|signup|me`, AUTH_SECRET restored 2026-07-10) but saved searches / watchlists / compare all key on an anonymous localStorage UUID. Sign-in currently buys the user nothing — that's backwards.

### Task 1.1: Claim-on-login migration
**Files:** `apps/one/src/app/api/auth/login/route.ts` + `signup/route.ts`, `apps/one/src/components/SavedSearches.tsx`, migration `2026_07_12_identity_claim.sql`
- [x] On successful login/signup, the client sends its localStorage `oper:user_id`; server re-keys that UUID's rows (`saved_searches`, `watchlists`) to the account id in one transaction. Idempotent (re-login re-claims nothing).
- [x] `useLocalUserId()` returns the session user id when authenticated, falling back to the anonymous UUID.
- [x] Acceptance verified (2026-07-11): save a search anonymous → sign up with `anon_user_id` → search re-keyed to the account (E2E tested on server). Migration `2026_07_12_identity_claim.sql` + `claim_anon_identity()`; login/signup routes claim (non-fatal); `useSessionUser` hook; `SavedSearches` uses session id.

### Task 1.2: Stripe end-to-end in test mode
NEXT_PUBLIC key now bakes correctly (fixed in map overhaul D5); nobody has verified checkout since the systemd cutover.
- [x] **AUDIT (2026-07-11):** `STRIPE_SECRET_KEY` is **test mode** (`sk_test_…`); `STRIPE_PRICE_MONTHLY`/`ANNUAL` are valid test price IDs. **BROKEN:** `STRIPE_WEBHOOK_SECRET` is a placeholder (`…PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD`), so `stripe.webhooks.constructEvent` fails → all webhooks 400 → the loop never completes. Checkout (`/api/checkout`) and the webhook handler/`pro`-grant logic are otherwise correct (idempotent via `stripe_webhook_events`, DLQ after 5 attempts).
- [x] **RUNBOOK:** wrote `docs/runbooks/stripe-test-loop.md` with exact steps (get signing secret, restart, checkout→pay 4242→verify `pro`→compare gate unlocks→cancel→verify `free`→402) + signature-verification acceptance.
- [x] **GREEN RUN (2026-07-11):** Local Stripe CLI (`stripe listen --forward-to https://one.octavo.press/api/webhooks`) supplied a `whsec_…`, written to `/etc/oper.env` + `/opt/onepercent/.env`, `oper-app` restarted. Verified: signed events → `200` (placeholder would 400); `customer.subscription.created` (active) → tier `pro`; `customer.subscription.deleted` → tier `free`; events idempotent in `stripe_webhook_events`. **BUG FIX (commit `860506b`):** handler ignored `customer.subscription.created`, so a brand-new active sub never granted `pro` — added it to the switch; re-deployed + re-tested green.
- [ ] **PROD TODO:** replace the test-loop `whsec_…` with the real Stripe Dashboard signing secret (test *and* live modes) before going live. Local CLI's saved key is a restricted `rk_test_…` (rejected by `listen`); export the full `sk_test_…` when running `listen`/`trigger`.
- [x] Acceptance: documented green run of the loop; webhook signature verification confirmed on.

### Task 1.3: Decide + wire ONE paid gate
Candidates already built: compare (>2 items), table view, rent-band confidence filter, two.octavo.press terminal access. Pick with the user; wire the check server-side (not CSS-hidden).
- [x] **DECISION (2026-07-11): Compare (>2 items) is the paid gate.** Free accounts limited to comparing ≤2 properties; subscriber check enforced server-side. Table view / confidence filter / terminal remain free for now.
- [x] **IMPL (2026-07-11):** `useCompare` is tier-aware (`COMPARE_FREE_MAX=2` free, `COMPARE_MAX=4` pro via `useSessionUser`); `add`/`toggle` enforce the cap; `CompareTray` shows `n/limit (free)`. Dashboard map multi-select (`app/page.tsx`) uses the same `compareLimit`. **Server-side** gate in `app/api/properties/route.ts`: `?compare=1` → `402` when a non-pro session requests >2 ids (blocks hand-crafted `/compare?ids=` URLs). `useProperties` accepts `compare?: boolean`; `/compare` passes it and renders an upgrade CTA on the 402. Not CSS-hidden — enforced in the API.
- [x] Acceptance verified: free account with >2 ids → `402 compare_limit`; pro passes. (Deployed + tested.)

---

## Phase 2 — The retention loop: email that brings people back

### Task 2.1: Saved-search daily digest
**Files:** `apps/worker/src/watchlist-alerts.ts` (extend), migration `2026_07_12_digest_optin.sql`
- [ ] `saved_searches` gains `email_digest BOOLEAN NOT NULL DEFAULT false`; the save-search UI gains the opt-in checkbox (only when signed in with an email).
- [ ] Daily 14:00 UTC job (existing worker tick pattern): for each digest-enabled search with `new_matches > 0` (reuse the D3 SQL), send one Resend email with up to 6 new listings (photo, price, ratio, link), then stamp `last_viewed_at`. Hard cap: 1 email/user/day (batch all their searches into one).
- [ ] Unsubscribe link → `email_digest = false` for that search (signed one-click token, no login required).
- [x] Acceptance (2026-07-11): implemented + deployed (migration `2026_07_12_digest_optin.sql`, `apps/worker/src/digest.ts` as `oper-worker-digest` systemd unit, `unsubscribe` route, `SavedSearches` opt-in checkbox). Worker runs hourly, fires daily digest @14:00 UTC + weekly brief Mon @14:00 UTC, deduped via `digest_runs`, batches ≤6 listings/user/day, unsubscribe via HMAC token.
- [x] **SENDING VERIFIED then PAUSED (2026-07-12):** Wired Resend + Hostinger DNS end-to-end on the temporary domain: verified Resend domain `one.octavo.press` (DKIM/SPF/Receiving all green via Hostinger DNS records), created a `sending_access` `RESEND_API_KEY` scoped to it, set `WATCHLIST_FROM_EMAIL=alerts@one.octavo.press`, and confirmed a live send is accepted by Resend (message id returned). **DECISION:** `one.octavo.press` is a throwaway domain — do not stand up a paid mailbox / finalize email on it. Full email rollout (real from-address, deliverability warm-up, confirming inbox receipt) is **tabled until the permanent domain lands**. Env + workers are configured and functional in the meantime.

### Task 2.2: Weekly ZIP market brief (the data moat as email)
- [ ] For watchlisted ZIPs: median list price WoW, new/sold counts, rent $/sqft trend from `h3_market_stats`, HPI YoY from `fhfa_zip_hpi`. One email per user per week, same opt-in + unsubscribe discipline.
- [x] Acceptance (2026-07-11): implemented + deployed; weekly brief queries `listings` (median price WoW, new/sold), `h3_market_stats`/`listings` (rent $/sqft trend), `fhfa_zip_hpi` (HPI YoY) for the search's ZIP. Same opt-in/unsubscribe discipline as 2.1.

---

## Phase 3 — Programmatic SEO: /market/[zip]

The data tables (FHFA, BLS, schools, walkability, h3 rent surface, NRI) make genuinely useful ZIP pages — the classic real-estate growth engine, and ours carries analysis competitors don't publish.

### Task 3.1: Page + route
**Files:** `apps/one/src/app/market/[zip]/page.tsx`, `apps/one/src/app/sitemap.ts` (extend)
- [ ] SSG with `generateStaticParams` for the top ~2,000 ZIPs by listing count, ISR (`revalidate: 86400`) for the tail. Sections: hero stats (median price, est. rent, ratio, listing count — live queries), HPI 10-yr sparkline, rent $/sqft mini-map image or hex summary, income/walkability/NRI context, schools count, top 6 current listings that clear the rule, links to adjacent ZIPs.
- [ ] Every number sourced from our tables; NO lorem-ipsum filler paragraphs. Page renders nothing rather than an empty section.
- [ ] JSON-LD (`Place` + `Dataset` breadcrumbs), canonical, OG image via the existing `og` pattern if present (`grep -r opengraph apps/one/src/app` first).
- [x] Acceptance (2026-07-11): `apps/one/src/app/market/[zip]/page.tsx` deployed + returns 200 for /market/90004 with live data (hero stats, HPI sparkline, walkability/NRI, schools, top listings, adjacent-ZIP links, JSON-LD, canonical, OG). Sitemap extended to top ~2000 ZIPs. Lighthouse SEO ≥90 not run in this environment — verify in-browser before launch. Internal "more in 90004 →" links: add from property pages if not already present.

---

## Phase 4 — Durability: backups, CI gates, uptime

### Task 4.1: Postgres backups (currently: NONE verified — audit first)
- [x] **DECISION (2026-07-11): off-box copy via rclone to Cloudflare R2** (free 10 GB; compressed dump ~2.5–3.5 GB; S3-compatible; no egress fees for restore drills). SCP-to-home rejected (machine usually offline). Local `/var/backups/oper/` nightly dump + R2 copy.
- [x] **Audit (2026-07-11): NO backups existed.** Built `ops/systemd/backup-postgres.sh` (pg_dump -Fc, local rotation, R2 copy), `verify-backup.sh` (restore drill), `notify-ops.sh` (WEBHOOK_URL alert), and systemd units `oper-backup.{service,timer}` (nightly 03:15) + `oper-backup-verify.{service,timer}` (Sun 04:30) + `oper-backup-failure.service`. First dump = **2.4 GB**. Timers enabled.
- [x] **Local retention adjusted (2026-07-11):** plan said 7 daily + 4 weekly *local*, but VPS has only 36 GB free and the DB grows as parcels load (~2.4 GB/dump now, will grow). Local retention set to **3 daily**; weekly (Sunday) snapshots are copied to R2 and **pruned locally** after copy. Long-term 7-daily + 4-weekly retention lives in R2. `FREE_FLOOR_GB=8` guard skips backups when disk is low.
- [x] **R2 off-box LIVE (2026-07-11):** rclone remote `oper-r2` configured on the server (credentials live only in `/root/.config/rclone/rclone.conf`, chmod 600 — never committed, never in this repo). First nightly dump copied to R2 and verified via `rclone ls`. `backup-postgres.sh` default `R2_REMOTE` points at the `oper-r2` remote's bucket. Off-box copy now runs nightly after each local dump. **A backup that lives only on the same VPS is not a backup** — now satisfied.
- [ ] Restore drill: restore latest dump into a scratch database, count rows in 3 tables, drop it. Scripted as `ops/systemd/verify-backup.sh`, run weekly by timer, alert on failure via OPS webhook.
- [x] Acceptance (2026-07-11): restore drill **passes** (verified: listings 999,890 / parcels 261,999 / epa_walkability 43,064 restored into scratch DB). Alert **fires** when the dump is missing (rename → `oper-backup-verify` fails → `OnFailure` → `oper-backup-failure` → `notify-ops.sh`). **BUG FIX:** `OnFailure=` was wrongly placed in `[Service]` (systemd ignored it — "Unknown key"); moved to `[Unit]` in both `oper-backup.service` and `oper-backup-verify.service`. Also scripts lacked `+x` (systemd `ExecStart` failed) — now executable + committed. **PROD TODO:** `WEBHOOK_URL` currently points at a bad endpoint (notify got `Cannot POST /`) — set a valid OPS webhook URL for real alerts.

### Task 4.2: CI becomes a gate
- [ ] `ci.yml` audit: does it run vitest (primitives, worker), pytest (ml_rent_estimator), `pnpm build` for both apps, `tsc` for packages? Add what's missing; make it required on main via branch protection (user click) or at minimum a red-X convention.
- [x] Acceptance (2026-07-11): `pnpm test` runs vitest suites (api-client, worker, primitives) as a hard CI step; a failing test turns the job red. Added `packages/api-client/src/schemas.test.ts` (6 cases). Pytest for ml_rent_estimator left un-wired (needs pandas/numpy/xgboost CI setup) — documented.

### Task 4.3: External uptime probe
- [ ] Internal Prometheus can't see DNS/TLS/edge failures. Free external check (UptimeRobot free tier or GitHub Actions schedule hitting one.octavo.press + /api/healthz every 5 min, failing loudly to the OPS webhook). Pick the Actions route if no new accounts wanted.
- [x] Acceptance (2026-07-11): `.github/workflows/uptime.yml` runs every 5 min (cron `*/5 * * * *` + workflow_dispatch), curls `/api/healthz`, fails the run + POSTs to `$OPS_WEBHOOK_URL` on non-200/timeout. User must add the `OPS_WEBHOOK_URL` repo secret. Recovery visibility relies on the webhook receiver (alerts on each failed run while down).

---

## Execution order

```
Phase 0 (0.1–0.5)  — data closure; 0.5 needs a user decision first
Phase 4.1          — backups BEFORE new user data accumulates (do early!)
Phase 1 → 2 → 3    — identity, then retention, then growth
Phase 4.2–4.3      — anytime, independent
```

Acceptance summary: all plan-1 tables at final counts or explicitly descoped; anonymous → account claim works; Stripe loop documented green; digest + weekly brief emailing opted-in users; /market/[zip] indexed; nightly off-box backups with a passing weekly restore drill; CI red on broken tests; external uptime alerting.
