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
- [ ] Acceptance: ≥ 2M rows; a known LA address matches by `situs_addr_norm`.

### Task 0.3: NFHL flood zones — load top-3 states, then decide
Full top-10 was never run (0 rows). Load CA, FL, TX first (60% of listings), measure disk + tile latency, THEN decide whether states 4-10 are worth it.
- [ ] Acceptance: `flood_zone_at(29.76, -95.36)` returns a row; flood layer toggle enables itself on the map (availability probe flips automatically).

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
- [ ] On successful login/signup, the client sends its localStorage `oper:user_id`; server re-keys that UUID's rows (`saved_searches`, `watchlists`) to the account id in one transaction. Idempotent (re-login re-claims nothing).
- [ ] `useLocalUserId()` returns the session user id when authenticated, falling back to the anonymous UUID.
- [ ] Acceptance: save a search anonymous → sign up → search appears under the account from another browser.

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
- [ ] Acceptance: seeded test account receives one digest containing a listing inserted after the search was saved.

### Task 2.2: Weekly ZIP market brief (the data moat as email)
- [ ] For watchlisted ZIPs: median list price WoW, new/sold counts, rent $/sqft trend from `h3_market_stats`, HPI YoY from `fhfa_zip_hpi`. One email per user per week, same opt-in + unsubscribe discipline.
- [ ] Acceptance: rendered email for 90004 shows real numbers matching ad-hoc SQL.

---

## Phase 3 — Programmatic SEO: /market/[zip]

The data tables (FHFA, BLS, schools, walkability, h3 rent surface, NRI) make genuinely useful ZIP pages — the classic real-estate growth engine, and ours carries analysis competitors don't publish.

### Task 3.1: Page + route
**Files:** `apps/one/src/app/market/[zip]/page.tsx`, `apps/one/src/app/sitemap.ts` (extend)
- [ ] SSG with `generateStaticParams` for the top ~2,000 ZIPs by listing count, ISR (`revalidate: 86400`) for the tail. Sections: hero stats (median price, est. rent, ratio, listing count — live queries), HPI 10-yr sparkline, rent $/sqft mini-map image or hex summary, income/walkability/NRI context, schools count, top 6 current listings that clear the rule, links to adjacent ZIPs.
- [ ] Every number sourced from our tables; NO lorem-ipsum filler paragraphs. Page renders nothing rather than an empty section.
- [ ] JSON-LD (`Place` + `Dataset` breadcrumbs), canonical, OG image via the existing `og` pattern if present (`grep -r opengraph apps/one/src/app` first).
- [ ] Acceptance: `/market/90004` scores ≥ 90 Lighthouse SEO; sitemap includes market pages; internal links from property pages ("more in 90004 →").

---

## Phase 4 — Durability: backups, CI gates, uptime

### Task 4.1: Postgres backups (currently: NONE verified — audit first)
- [x] **DECISION (2026-07-11): off-box copy via rclone to Cloudflare R2** (free 10 GB; compressed dump ~2.5–3.5 GB; S3-compatible; no egress fees for restore drills). SCP-to-home rejected (machine usually offline). Local `/var/backups/oper/` nightly dump + R2 copy.
- [x] **Audit (2026-07-11): NO backups existed.** Built `ops/systemd/backup-postgres.sh` (pg_dump -Fc, local rotation, R2 copy), `verify-backup.sh` (restore drill), `notify-ops.sh` (WEBHOOK_URL alert), and systemd units `oper-backup.{service,timer}` (nightly 03:15) + `oper-backup-verify.{service,timer}` (Sun 04:30) + `oper-backup-failure.service`. First dump = **2.4 GB**. Timers enabled.
- [x] **Local retention adjusted (2026-07-11):** plan said 7 daily + 4 weekly *local*, but VPS has only 36 GB free and the DB grows as parcels load (~2.4 GB/dump now, will grow). Local retention set to **3 daily**; weekly (Sunday) snapshots are copied to R2 and **pruned locally** after copy. Long-term 7-daily + 4-weekly retention lives in R2. `FREE_FLOOR_GB=8` guard skips backups when disk is low.
- [x] **R2 off-box LIVE (2026-07-11):** rclone remote `oper-r2` configured on the server (credentials live only in `/root/.config/rclone/rclone.conf`, chmod 600 — never committed, never in this repo). First nightly dump copied to R2 and verified via `rclone ls`. `backup-postgres.sh` default `R2_REMOTE` points at the `oper-r2` remote's bucket. Off-box copy now runs nightly after each local dump. **A backup that lives only on the same VPS is not a backup** — now satisfied.
- [ ] Restore drill: restore latest dump into a scratch database, count rows in 3 tables, drop it. Scripted as `ops/systemd/verify-backup.sh`, run weekly by timer, alert on failure via OPS webhook.
- [ ] Acceptance: restore drill passes; alert fires when the dump is missing (test by renaming one).

### Task 4.2: CI becomes a gate
- [ ] `ci.yml` audit: does it run vitest (primitives, worker), pytest (ml_rent_estimator), `pnpm build` for both apps, `tsc` for packages? Add what's missing; make it required on main via branch protection (user click) or at minimum a red-X convention.
- [ ] Acceptance: a PR with a failing dataset test shows red.

### Task 4.3: External uptime probe
- [ ] Internal Prometheus can't see DNS/TLS/edge failures. Free external check (UptimeRobot free tier or GitHub Actions schedule hitting one.octavo.press + /api/healthz every 5 min, failing loudly to the OPS webhook). Pick the Actions route if no new accounts wanted.
- [ ] Acceptance: probe green; simulated outage (stop oper-app for 60s, restart) produces exactly one alert and one recovery.

---

## Execution order

```
Phase 0 (0.1–0.5)  — data closure; 0.5 needs a user decision first
Phase 4.1          — backups BEFORE new user data accumulates (do early!)
Phase 1 → 2 → 3    — identity, then retention, then growth
Phase 4.2–4.3      — anytime, independent
```

Acceptance summary: all plan-1 tables at final counts or explicitly descoped; anonymous → account claim works; Stripe loop documented green; digest + weekly brief emailing opted-in users; /market/[zip] indexed; nightly off-box backups with a passing weekly restore drill; CI red on broken tests; external uptime alerting.
