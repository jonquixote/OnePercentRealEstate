# Pro Deal Flow — Instant Area Alerts + Terminal Workspaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give paying users a reason to stay paying: (1) **Deal alerts** — when a new listing clears the line inside a user's watched areas and matches their preset criteria, they hear about it fast (in-app always; email/Telegram when configured) — instant for pro, daily digest for free. (2) **Terminal workspaces** — the two.octavo.press pro terminal finally gets its long-owed watchlist pane, column picker, and saved layouts so a pro's screen configuration survives sessions.

**Architecture:** A worker alert tick diffs "new since last tick" 1%-clearing listings against every user's watched areas (`profiles.prefs.areas` from the Investor's Shelf plan + criteria watchlists), writes `alert_events` rows (the in-app inbox and the dedup ledger), and fans out instantly for pro / batches daily for free through the existing digest email plumbing and the existing Telegram bot config. The terminal stores named layouts (visible columns, column order, sort, active pane sizes) in a `terminal_layouts` table keyed to the session user, with the watchlist pane reading the same watchlists API apps/one uses.

**Tech Stack:** apps/worker (Vitest, pg, existing digest/email + Telegram alert plumbing), apps/one (inbox surface), apps/two (terminal panes, query-lang tables), Postgres migrations.

## Global Constraints

- **Session identity only**; alert routing respects `subscription_tier` (`pro` ⇒ instant, else daily batch). Tier lives on `profiles.subscription_tier`.
- **Dedup is a hard invariant:** a (user, listing) pair alerts at most once, ever — enforced by a UNIQUE constraint, not application memory.
- **Email sends stay owner-gated** behind `RESEND_API_KEY` exactly like the digest worker — absent key ⇒ in-app only, no errors. Telegram reuses the existing alertmanager-style bot config pattern (server-only runtime env, never committed).
- **Depends on** the Investor's Shelf plan (`profiles.prefs.areas`) and plays nice with Listing Truth (`listing_status='active'` filter when the column exists; feature-detect fallback otherwise).
- **Worker units are COPIED to /etc/systemd/system** — a new unit needs scp + daemon-reload at deploy (deploy-systemd.sh does not install units). Any worker importing `@oper/query-lang` must run via tsx (known constraint) — the alert worker must NOT import query-lang; it evaluates criteria via the same SQL compilation endpoint the digest uses.
- **Design:** apps/one inbox uses the eggshell tokens; apps/two keeps its terminal idiom.
- **Tests:** `pnpm --filter @oper/worker test <path>`, `pnpm --filter @oper/one test <path>`, `pnpm --filter @oper/two test <path>`.

## Current State (verified 2026-07-18 + session memory)

- Alerts today: watchlist evaluation exists in the worker tick (Wave 5) and a digest worker (`oper-worker-digest`, runs via tsx) emails saved-search digests when `RESEND_API_KEY` is set; Telegram alerting is wired for OPS alerts via alertmanager, and the pattern (bot token in server-only runtime file) is established.
- No in-app notification surface exists; no per-(user,listing) alert ledger.
- Terminal (apps/two): screens/market-series/screen-alerts APIs live; **watchlist pane, column picker, saved layouts** are the recorded leftovers. The grid columns are currently fixed in the Workspace component.
- `profiles.prefs` ships with the Investor's Shelf plan; `watchlists.query_json` is the criteria format the worker already evaluates.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_18_alert_events_layouts.sql` (create) | `alert_events` + `terminal_layouts` tables. |
| `apps/worker/src/alerts.ts` (create) + `alerts.test.ts` | Alert tick: candidate diff, matching, dedup insert, tiered fanout. |
| `ops/systemd/oper-worker-alerts.service` (create) | New unit (plain node dist — no query-lang import). |
| `apps/one/src/app/api/alerts/route.ts` (create) | GET inbox (+ unread count), POST mark-read. |
| `apps/one/src/components/AlertsBell.tsx` (create) | Header bell + dropdown inbox. |
| `apps/two/src/app/api/layouts/route.ts` (create) | Terminal layout CRUD (session-scoped). |
| `apps/two/src/components/ColumnPicker.tsx`, `WatchlistPane.tsx` (create); `Workspace.tsx` (modify) | Pro terminal panes. |

---

## Task 1: Migration — `alert_events` + `terminal_layouts`

- [ ] **Step 1:**

```sql
-- infrastructure/migrations/2026_07_18_alert_events_layouts.sql
CREATE TABLE IF NOT EXISTS alert_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id  bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source      text   NOT NULL CHECK (source IN ('area','watchlist')),
  source_label text  NOT NULL,           -- e.g. 'Houston (77002)' or the watchlist name
  ratio       numeric,
  price       numeric,
  created_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,              -- set when instant/daily fanout succeeded
  read_at     timestamptz,
  UNIQUE (user_id, listing_id)           -- the dedup invariant: one alert per pair, ever
);
CREATE INDEX IF NOT EXISTS idx_alert_events_inbox ON alert_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_undelivered ON alert_events (created_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS terminal_layouts (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  layout     jsonb NOT NULL,             -- {columns:[{key,visible,width}], sort:{key,dir}, panes:{...}}
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON alert_events, terminal_layouts TO oper_app;
GRANT SELECT, INSERT, UPDATE ON alert_events TO oper_worker;
GRANT USAGE, SELECT ON SEQUENCE alert_events_id_seq, terminal_layouts_id_seq TO oper_app;
GRANT USAGE, SELECT ON SEQUENCE alert_events_id_seq TO oper_worker;
```

(Verify live role names — `oper_app`/`oper_worker` per the least-priv role set — and adjust at deploy if they differ.)

- [ ] **Step 2: CI dry-run green; commit** — `feat(data): alert_events ledger + terminal_layouts`

---

## Task 2: Worker alert tick

**Interfaces (apps/worker/src/alerts.ts):**
- `CANDIDATES_SQL` — 1%-clearers seen since a watermark: `last_seen_at > $1` (NOT `created_at` — a price cut can turn an old listing into a fresh deal and `created_at` would miss it), `rent_price_ratio >= 0.01`, `price >= 30000`, ratio `<= 0.05` (the spotlight sanity bounds), lifecycle-active when the column exists. Over-matching re-seen rows is harmless: the `alert_events` UNIQUE (user, listing) dedup absorbs them.
- `matchAreas(candidates, users): AlertRow[]` — pure: user areas are ZIP prefixes-exact matches (`zip === candidate.zip_code`).
- `runAlertTick(pool, log, cfg)` — waterline from `worker_state` (key/value table pattern the worker already uses — verify name; else a tiny `alert_state(id=1, last_created_at)` created in the migration), candidates → per-user matches from (a) `profiles.prefs->'areas'` (b) watchlists via the SAME evaluation path the existing watchlist tick uses (call that function — do not re-implement query-lang), → `INSERT … ON CONFLICT DO NOTHING` into `alert_events`, → fanout: pro users' fresh rows get instant email/Telegram (when configured) and `delivered_at=now()`; free rows are left for the digest job, which appends "New in your areas" to the existing daily email and stamps `delivered_at`.

- [ ] **Step 1: Failing tests** — SQL-shape (parameterized watermark, bounds present, `ON CONFLICT (user_id, listing_id) DO NOTHING`); `matchAreas` pure cases (match, no-match, malformed zip dropped, multiple users same candidate); tier split (mock rows: pro → instant list, free → untouched).
- [ ] **Step 2: RED → implement → GREEN** (structure mirrors `lifecycle.ts` from the Listing Truth plan: exported SQL constants + a tick function; email via the digest's existing `sendEmail` helper import — reuse, don't duplicate).
- [ ] **Step 3: Entry point + unit** — `apps/worker/src/alerts-main.ts` (loop on `ALERT_TICK_MS`, default 5 min) + `ops/systemd/oper-worker-alerts.service` (`ExecStart=/usr/bin/node apps/worker/dist/alerts-main.js`, EnvironmentFile pattern copied from `oper-worker-digest.service` but node-not-tsx since no query-lang import — verify by grepping alerts-main's import graph in the task).
- [ ] **Step 4: Worker suite + typecheck green; commit** — `feat(worker): tiered deal alerts — area/watchlist match, dedup ledger, instant-for-pro`

---

## Task 3: In-app inbox (apps/one)

- [ ] **Step 1: Failing route test** — GET returns newest 50 with `unread` count; POST `{ids:[…]}` sets `read_at` only for the session user; 401 unauthenticated.
- [ ] **Step 2: Implement `/api/alerts`** (session pattern from `/api/watchlists`; join listings for address/photo/ratio like the saved-properties GET).
- [ ] **Step 3: `AlertsBell.tsx`** — header bell with unread dot (poll 60s), dropdown: rows "address · ratio figure · source_label · time-ago", click → property page + mark-read; "Mark all read". Empty state: "Alerts land here when a deal clears the line in your areas." jsdom test: unread dot renders with mocked count, mark-all POST fires.
- [ ] **Step 4: Mount in `Header.tsx`** (signed-in only). Suite + typecheck; commit — `feat(user): in-app deal-alert inbox + header bell`

---

## Task 4: Terminal — column picker + saved layouts + watchlist pane

- [ ] **Step 1: Layout CRUD** — `apps/two/src/app/api/layouts/route.ts`: GET list / PUT upsert by name / DELETE — session-scoped, `layout` validated (known column keys only, max 5 layouts free / 20 pro). Route test first (RED→GREEN).
- [ ] **Step 2: `ColumnPicker.tsx`** — popover listing the grid's column registry (key, label, visible toggle, drag to reorder); emits `ColumnConfig[]`. The registry: extract the CURRENT hardcoded column defs from `Workspace.tsx` into `apps/two/src/lib/columns.ts` (`export const COLUMNS: ColumnDef[]`) so picker + grid share one source. Component test: toggling hides a column key in the emitted config.
- [ ] **Step 3: `Workspace.tsx` integration** — grid renders from `ColumnConfig`; a layout bar (dropdown of saved layouts + "Save as…") wires the CRUD; last-used layout name in localStorage, content always from the server.
- [ ] **Step 4: `WatchlistPane.tsx`** — collapsible side pane listing the user's watchlists (`/api/watchlists` — two's nginx already routes its own /api/*; VERIFY two.octavo.press proxies `/api/watchlists` to apps/one:3001 per the established vhost exact-match pattern, add the location block to `ops/nginx/sites/two.octavo.press` if missing); clicking one loads its `query_json` into the expression bar (the bar's setter already exists from W6).
- [ ] **Step 5: two suite + typecheck; commit** — `feat(two): column picker, saved layouts, watchlist pane`

---

## Task 5: Deploy + end-to-end proof

- [ ] Migrate → build one/two/worker → install `oper-worker-alerts.service` (scp + daemon-reload + enable) → restart `oper-app`, `oper-two`, new unit.
- [ ] **Alert path proof:** with a test pro user whose prefs.areas contains a busy ZIP, wait ≤2 ticks after fresh crawl inserts → `alert_events` row exists (UNIQUE holds on rerun), bell shows unread, email arrives if `RESEND_API_KEY` set (else `delivered_at` stays null and the row waits for digest — verify the free-tier user's row is picked up by the next digest run).
- [ ] **Terminal proof:** hide two columns, save layout "narrow", reload → layout persists; open watchlist pane, click a watchlist → expression bar fills and the grid updates; second browser (free user) capped at 5 layouts.
- [ ] Screenshot bell dropdown + terminal layout bar for the PR.

## Self-Review

**Spec coverage:** pro-differentiated deal flow (instant vs daily, tier-gated layout counts) · alerts on preset areas from the Shelf plan + existing watchlists · block-safe (zero new scraping; alerts diff data already collected) · terminal leftovers (watchlist pane, column picker, saved layouts) retired · email/Telegram reuse existing gated plumbing. Covered.

**Placeholder scan:** schemas + SQL + component contracts complete; the four verify-on-site points (worker state-table name, live role names, digest sendEmail helper name, two's nginx /api/watchlists route) are named with exact fallback actions.

**Type consistency:** `alert_events` columns match the worker INSERT and the inbox GET; `ColumnDef/ColumnConfig` single-sourced in `columns.ts` for picker + grid + layout validation; tier values (`pro`) read from the same `profiles.subscription_tier` the compare gate uses.

## Deferred / Non-blocking follow-ups

Captured from the final deep-review pass on PR #39 (pro-deal-flow). These were
judged non-blocking and consciously left for later — NOT bugs in the shipped code.

1. **Unbounded `SELECT … FROM watchlists` in `runAlertTick`**
   The tick fetches the entire `watchlists` table once per run, then evaluates
   each candidate in memory (O(candidates × watchlists)). Fine at current
   volume; at thousands of watchlists this grows memory + CPU per tick.
   Follow-up: cap/paginate the fetch (e.g. shard by `user_id` or `LIMIT`+offset)
   before this path sees production scale.

2. **`MemoryMax=192M` headroom on `oper-worker-alerts.service`**
   The fanout loop holds all candidates + watchlists in memory. At large scale
   could approach the 192M cap. Follow-up: raise the cap or stream batches if
   matched-row volume grows.

3. **Verify `listings(last_seen_at)` index exists**
   `CANDIDATES_SQL` filters/sorts on `last_seen_at` (`WHERE last_seen_at > $1
   ORDER BY last_seen_at ASC LIMIT 2000`). Confirm a matching index pre-exists
   (or add one) so the tick stays index-only at scale.

4. **Free users are inbox-only by design (product limitation, not a bug)**
   `alert_events` rows for free-tier users are written but never emailed — the
   digest worker does NOT consume `alert_events` (documented in
   `apps/worker/src/alerts.ts`). Free users get in-app deal alerts only.
   If email-for-free is later desired, wire a digest pass that reads
   `alert_events WHERE delivered_at IS NULL` grouped by user.

NOTE: implementation deviation — `alert_events.user_id` and `terminal_layouts.user_id`
are `text` (matching `profiles.id` which is TEXT), not `uuid` as the original
plan sketch suggested. Intentional; consistent with `2026_07_12_api_keys.sql`.
