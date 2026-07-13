# Pro Terminal — Make two.octavo.press Worth Paying For

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build apps/two from a two-page prototype into the product the pro tier is sold on: a keyboard-first deal screener with saved scans, live columns of investor math, query-based alerts, CSV export, market time-series charts, and (stretch) API keys — the Bloomberg-for-1%-rule identity the two-frontend strategy always intended.

**Architecture:** Everything hard already exists and just needs assembly: the query-lang (`@oper/query-lang` compiles user expressions to safe WHERE via `/api/properties/query`, server re-parses, columns whitelisted), `@oper/primitives/hotkeys` (combos, chords, help overlay), `@oper/api-client` (typed hooks), tier auth (`useSessionUser`, server-side pro checks, Stripe loop verified green), the digest email worker (query-based alerts reuse its send path), and the datasets (FHFA/BLS/h3 stats for charts). The terminal is a **workspace shell** hosting panes; state (layout, screens, columns) persists server-side per account so it follows the user.

**Tech Stack:** Next 16, `@oper/query-lang`, `@oper/primitives` (hotkeys, underwriting), `@oper/api-client`, `@oper/map` (map pane), Postgres, existing digest worker, Resend.

## Global Constraints

- **Keyboard-first is the identity**: every action reachable without the mouse; `?` opens the hotkey help (primitives has `HotkeyHelp` — use it); chords follow the existing `g p` convention.
- **Server-side trust boundary unchanged**: the client NEVER ships compiled SQL; expressions go to `/api/properties/query` which re-parses + re-compiles against the column whitelist (the Wave 6 contract — read `apps/one/src/app/api/properties/query/route.ts` and `packages/query-lang` before touching anything).
- **Pro gating server-side**: terminal data endpoints check tier (free = read-only demo with capped rows + upsell banner; pro = full). Client hiding is cosmetic only. Reuse the compare-gate pattern (402 + upsell).
- **Design language**: two.octavo.press is the dense dark terminal (existing `PropertyTable`/`StatBar` aesthetic) — NOT the apps/one wine-menu. Density toggle already exists (`DENSITY_ROW_HEIGHT`).
- **Deploys**: `deploy-systemd.sh two`; live verify each phase.
- **New tables** follow migration discipline; all keyed to account `user_id` (the claim-on-login identity) — anonymous users get localStorage fallback read-only.

## Current state (read first)

- `apps/two/src/app/(terminal)/page.tsx`: viewport tape (hardcoded eastern-US bbox) + FilterExpression switching to query results. `PropertyTable` (365 lines, virtualized?—verify), `PropertyInspector`, `FilterRail`, `StatBar`, `lib/selection.ts`, `lib/coerce.ts`.
- `/portfolio` page exists — audit what it does before Phase W.
- No saved state, no columns config, no export, no charts, no alerts, no tier awareness.

---

## Phase W — Workspace shell

### Task W1: Screens (saved scans) — the core object

**Files:**
- Create: `infrastructure/migrations/2026_07_XX_terminal_screens.sql`
- Create: `apps/two/src/app/api/screens/route.ts`
- Create: `apps/two/src/components/ScreenTabs.tsx`
- Modify: `apps/two/src/app/(terminal)/page.tsx`

```sql
CREATE TABLE IF NOT EXISTS terminal_screens (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expression TEXT NOT NULL DEFAULT '',      -- query-lang source
  columns JSONB NOT NULL DEFAULT '[]',      -- ordered column ids (W2)
  sort JSONB,                               -- {col, dir}
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_terminal_screens_user ON terminal_screens (user_id, position);
```

- [ ] CRUD route (session auth, same identity rules as saved-searches incl. claim-on-login coverage — add `terminal_screens` to `claim_anon_identity()`).
- [ ] `ScreenTabs`: tab strip above the table (Bloomberg function-key feel): `1..9` hotkeys switch screens, `cmd+s` saves current expression+columns+sort into the active screen, `cmd+shift+n` new screen. Dirty-state dot when the live expression differs from the saved one.
- [ ] Seed 4 built-in read-only screens (shipped as constants, not rows): "Clears the line" (`ratio >= target`), "Price cuts" (`price_cut_pct > 0.05`), "Stale + motivated" (`dom > 90 and motivated_score > 50`), "Fresh today" — these are also the free-tier demo.
- [ ] Acceptance: create/rename/switch/save screens; hotkeys work; screens survive re-login from another browser. Commit.

### Task W2: Column system + investor math columns

**Files:**
- Create: `apps/two/src/lib/columns.tsx` (registry)
- Modify: `apps/two/src/components/PropertyTable.tsx`

- [ ] Column registry: `{id, label, width, align, sortKey?, render(row)}` for ~20 columns — the existing table's columns plus computed investor math via `@oper/primitives/underwriting`: ratio, cap rate (50% rule), CoC (20% down), band spread %, $/sqft, motivated score, DOM, cut %, flood SFHA (when the row carries it — extend the query route's column whitelist as needed, server-side).
- [ ] Column picker (hotkey `c`): checkbox list + drag order, persisted per screen (W1's `columns`).
- [ ] Sort by any sortable column server-side: the query route gains `orderBy` restricted to the same whitelist (never interpolated — map id → SQL expression server-side).
- [ ] Acceptance: add CoC column → sort desc → top row's CoC recomputed client-side matches (parity check); layout persists per screen. Commit.

### Task W3: Pane layout — inspector + map + chart

**Files:**
- Create: `apps/two/src/components/Workspace.tsx`
- Modify: `apps/two/src/app/(terminal)/page.tsx`, `apps/two/src/components/PropertyInspector.tsx`

- [ ] Grid: table (main) + right inspector (existing, keep) + bottom pane toggleable between **map** (`@oper/map`, dark liberty basemap, selected row ↔ pin sync via the feature-state helpers) and **chart** (W4). Pane sizes draggable (CSS resize or a 40-line splitter — no dep), persisted in localStorage.
- [ ] `j/k` row navigation already in hotkeys conventions — wire: j/k moves selection, `enter` focuses inspector, `m` toggles map pane, `x` chart pane, `esc` back to table.
- [ ] Acceptance: full keyboard loop table→inspector→map-sync without mouse; pane layout survives reload. Commit.

### Task W4: Market chart pane

**Files:**
- Create: `apps/two/src/components/ChartPane.tsx`
- Create: `apps/two/src/app/api/market-series/route.ts`

- [ ] `/api/market-series?zip=&series=hpi,unemployment,rent_psf`: HPI yearly (`fhfa_zip_hpi`), county unemployment monthly (`bls_county_laus` via zip→county from listings), median rent $/sqft monthly (`h3_market_stats` hexes within the ZIP — precomputed per request is fine at ZIP scale). Zod-validated, cached 1h.
- [ ] Chart renders for the selected row's ZIP: 3 stacked sparkline-style series (SVG, follow `PriceSparkline.tsx`'s hand-rolled approach — no chart dep), hover crosshair with values, series toggles.
- [ ] Acceptance: select a 90004 listing → chart shows 10y HPI + unemployment + rent trend; values spot-checked against SQL. Commit.

---

## Phase AL — Alerts (the retention hook for pros)

### Task AL1: Screen alerts

**Files:**
- Create: `infrastructure/migrations/2026_07_XX_screen_alerts.sql` (`screen_alerts(screen_id, user_id, cadence 'instant'|'daily', last_run_at, enabled)`)
- Modify: `apps/worker/src/` digest worker (extend — read `ccd1b70`'s digest implementation first and follow its opt-in/unsubscribe/caps patterns exactly)

- [ ] "Alert me" toggle on a screen (pro only): daily cadence first (instant is a stretch). The worker tick compiles the screen's expression server-side (same query route internals — extract the compile+execute into a shared server module both the route and worker import), runs it bounded (`created_at > last_run_at`, LIMIT 20), emails new matches through the digest sender (1 email/user/day cap shared with saved-search digests — merge into the same daily send).
- [ ] Malformed/expensive expressions: compile failure disables the alert + notes it in the email footer; statement_timeout 5s on the alert query.
- [ ] Acceptance: seeded pro account + screen `price_cut_pct > 0.05` gets an email containing a listing inserted after last_run_at; unsubscribe works; free account sees the upsell instead of the toggle. Commit.

---

## Phase X — Export + tier gating + polish

### Task X1: CSV export (pro)

- [ ] `cmd+e` exports the current screen's full result set (server-generated CSV from the same compiled query, LIMIT 10,000, streamed response, pro-gated 402 otherwise). Columns = the screen's visible columns. Filename `oper-screen-<name>-<date>.csv`.
- [ ] Acceptance: exported CSV row count matches the StatBar count (≤10K); free account gets the upsell. Commit.

### Task X2: Tier gate + trial UX

- [ ] Terminal page server component checks session tier: `free`/anonymous → demo mode (built-in screens only, 50-row cap, persistent banner "Terminal is a Pro feature — full access from $X/mo" → pricing), `pro` → everything. Server enforces the row cap in the query route (not CSS).
- [ ] apps/one pricing page gains the terminal as a listed pro feature with a screenshot.
- [ ] Acceptance: anonymous sees demo + banner; test-mode pro account (Stripe runbook) sees full; row cap verified server-side via curl. Commit.

### Task X3: Hotkey help + status polish

- [ ] `?` opens `HotkeyHelp` (primitives) listing everything registered; StatBar gains query latency + row count + active screen name; error states for query-lang parse errors show the caret position (the parser exposes it — check `packages/query-lang` API).
- [ ] Acceptance: every hotkey in the help actually fires; a parse error points at the offending token. Commit.

### Task X4 (stretch, needs user go-ahead): API keys

- [ ] `api_keys(user_id, key_hash, name, created_at, last_used_at)` + `/api/v1/listings?filter=<query-lang>` bearer-authed, pro-only, rate-limited (nginx zone from the backend plan), same compile path. Docs page `/docs/api` with 5 curl examples.
- [ ] Acceptance: curl with a key returns JSON; revoked key 401s. **Skip unless the user confirms demand.**

## Execution order

```
W1 → W2 → W3 → W4
AL1 (after W1; needs backend-plan A1 rate limits ideally)
X1 → X2 → X3 (X2 can land right after W1 if revenue urgency demands)
X4 stretch, user decision
```

Acceptance summary: a pro user can build a screen in query-lang, shape its columns, watch it daily by email, chart any row's market, and export CSV — entirely from the keyboard; a free user sees enough demo to want it.
