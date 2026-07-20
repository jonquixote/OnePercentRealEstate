# Alerts That Cover Metros — City-Wide Matching, Free-Tier Email Delivery, Tick Observability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The activation wizard ships users into an alert engine that watches almost nothing and emails free users never. An onboarded "Houston" area is stored as the single ZIP `77002` (downtown condos — currently **zero** 1%-clearing candidates), so exact-ZIP matching makes the flagship promise ("we watch your markets") quietly false. And the daily digest never reads `alert_events`, so the free tier's promised "daily digest" of deal alerts does not exist — the UpgradeMoment copy "Daily digest stays free" is currently untrue. This plan widens area matching to city+state (keeping ZIP for map centering), folds undelivered area alerts into the existing digest email, and gives the alert tick the observability to prove it.

**Architecture:** The prefs `areas[]` entry (today `{zip, label}`) gains optional `city`/`state`; `METROS` already knows both, the wizard and account presets write them through the existing validated `/api/prefs` PUT (no migration — jsonb). The worker's `CANDIDATES_SQL` adds `city, state` to its SELECT; pure `matchAreas` matches on `zip === candidate.zip` OR (`city` + `state` case-insensitive equal), deduped per (user, listing). The digest worker gains an alert section: undelivered `alert_events` for opted-in users render through the existing alert-email template and ride the existing Resend send; `delivered_at` stamps on success only.

**Tech Stack:** apps/one (Next 16, `parsePrefs` clamp table), apps/worker (`alerts.ts`, `alert-email.ts`, `digest.ts`, node-postgres, Resend REST), Vitest.

## Global Constraints

- **No new tables, no migration.** `city`/`state` live inside the existing `profiles.prefs` jsonb via `parsePrefs`; older blobs without them keep working (ZIP-only matching).
- **Alert dedup invariant unchanged:** `alert_events` UNIQUE (user_id, listing_id). Widened matching must emit at most ONE row per (user, listing) even when both ZIP and city match.
- **`delivered_at` stamps ONLY on a successful send** (or on pro instant fanout exactly as today). A failed digest send leaves rows undelivered for the next run — never lose an event, never double-mark.
- **Email is opt-in and Resend-gated:** only users whose prefs have `alertOptIn === true` AND a non-null email get digest alert emails; absent `RESEND_API_KEY` ⇒ no-op with the existing single boot log line.
- **Scraper politeness untouchable:** nothing here changes crawl cadence, recheck share, or scraper behavior. The worker only reads what the crawler already wrote.
- **Parameterized SQL only; `listing_status NOT IN ('sold','stale','rental_misfiled')` stays in every candidate query.**
- **Tests:** `pnpm --filter @oper/one test`, `pnpm --filter @oper/worker test`.

## Current State (verified 2026-07-19 on prod + code)

- `apps/one/src/lib/metros.ts` — `Metro = { slug, label, zip, lat, lng }`, 8 metros (Los Angeles/Houston/Atlanta/Tampa/Columbus/Memphis/Cleveland/San Antonio). No city/state fields yet (label ≈ city name; state must be added: CA TX GA FL OH TN OH TX).
- `apps/one/src/lib/prefs-shared.ts` — `InvestorPrefs.areas: Array<{zip, label}>` clamped by `parsePrefs`; `onboarded`/`alertOptIn` booleans landed 2026-07-19.
- Wizard (`apps/one/src/components/onboarding/WizardSteps.tsx`) builds areas from `METROS` chips; account presets (`apps/one/src/app/account/page.tsx#presets`) edits the same shape.
- `apps/worker/src/alerts.ts` — `CANDIDATES_SQL` selects `id, address, zip_code, price, estimated_rent, rent_price_ratio` where `last_seen_at > $1 AND rent_price_ratio BETWEEN 0.01 AND 0.05`, lifecycle-filtered, `ORDER BY last_seen_at ASC LIMIT 2000`; watermark in `alert_state`. `matchAreas` accepts `{zip,label}` objects + bare ZIP strings (fixed 2026-07-19 — objects were silently dropped before) but matches **exact ZIP only**. Tick log: `candidates, eventsInserted, instantSent`.
- Prod truth: ZIP `77002` has 0 candidates; `44102` (Cleveland) has 33 — all `last_seen_at` older than the alert watermark, so they only re-enter when the recheck loop re-sees them. City-wide matching multiplies coverage immediately.
- `apps/worker/src/alert-email.ts` — `renderAlertEmail(user, events, candidates)` + `sendAlertEmails` (Resend REST via `WATCHLIST_FROM_EMAIL`, signed unsubscribe URL helper). Used by the **pro instant** leg only.
- `apps/worker/src/digest.ts` — daily saved-search digest (runs via tsx, Resend-gated). **Never reads `alert_events`** — free-tier area alerts are never emailed anywhere.
- `RESEND_API_KEY` IS present on prod (verified in `/etc/oper.env`) — the send path is armed.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/metros.ts` (modify) | Metro gains `city`, `state`. |
| `apps/one/src/lib/prefs-shared.ts` (modify) | Area gains optional `city`, `state`; clamps. |
| `apps/one/src/components/onboarding/WizardSteps.tsx` (modify) | Chips write `{zip,label,city,state}`. |
| `apps/one/src/app/account/page.tsx` (modify) | Presets editor preserves city/state on edit. |
| `apps/worker/src/alerts.ts` (modify) | Candidates carry city/state; matching widened + deduped; richer tick log. |
| `apps/worker/src/digest.ts` (modify) | Digest delivers undelivered alert_events to opted-in users. |
| `apps/worker/src/alert-email.ts` (modify) | Render helper reused by the digest leg (export what it needs; no copies). |

---

## Task 1: Area schema + metros gain city/state (apps/one)

**Files:** modify `apps/one/src/lib/metros.ts`, `apps/one/src/lib/prefs-shared.ts` + `prefs-shared.test.ts`, `apps/one/src/components/onboarding/WizardSteps.tsx` + test, `apps/one/src/app/account/page.tsx`.

- [ ] **Step 1: Failing prefs tests** (`prefs-shared.test.ts`):

```ts
it('round-trips area city/state and clamps junk', () => {
  const p = parsePrefs({
    areas: [
      { zip: '77002', label: 'Houston', city: 'Houston', state: 'tx' },
      { zip: '44102', label: 'Cleveland' }, // older blob shape — still valid
      { zip: '30310', label: 'Atlanta', city: 42, state: 'GEORGIA' }, // junk city dropped, state clamped off
    ],
  });
  expect(p.areas[0]).toEqual({ zip: '77002', label: 'Houston', city: 'Houston', state: 'TX' });
  expect(p.areas[1]).toEqual({ zip: '44102', label: 'Cleveland' });
  expect(p.areas[2]).toEqual({ zip: '30310', label: 'Atlanta' });
});
```

- [ ] **Step 2: RED → implement.** In `prefs-shared.ts`: area parser keeps existing zip/label rules and adds — `city`: string, trimmed, 1–40 chars, else omitted; `state`: string of exactly 2 A–Z letters after `trim().toUpperCase()`, else omitted; **emit `city`/`state` keys only when BOTH are valid** (matching needs the pair — a city without a state is ambiguous). GREEN.
- [ ] **Step 3: metros.ts** — add to each entry (and the `Metro` type): `city` and `state`:

```ts
{ slug: 'los-angeles', label: 'Los Angeles', city: 'Los Angeles', state: 'CA', zip: '90004', lat: 34.076, lng: -118.309 },
{ slug: 'houston',     label: 'Houston',     city: 'Houston',     state: 'TX', zip: '77002', lat: 29.756, lng: -95.363 },
{ slug: 'atlanta',     label: 'Atlanta',     city: 'Atlanta',     state: 'GA', zip: '30310', lat: 33.727, lng: -84.42 },
{ slug: 'tampa',       label: 'Tampa',       city: 'Tampa',       state: 'FL', zip: '33604', lat: 27.998, lng: -82.457 },
{ slug: 'columbus',    label: 'Columbus',    city: 'Columbus',    state: 'OH', zip: '43206', lat: 39.94,  lng: -82.966 },
{ slug: 'memphis',     label: 'Memphis',     city: 'Memphis',     state: 'TN', zip: '38106', lat: 35.102, lng: -90.026 },
{ slug: 'cleveland',   label: 'Cleveland',   city: 'Cleveland',   state: 'OH', zip: '44102', lat: 41.474, lng: -81.739 },
{ slug: 'san-antonio', label: 'San Antonio', city: 'San Antonio', state: 'TX', zip: '78201', lat: 29.469, lng: -98.525 },
```

(Preserve each entry's existing lat/lng/zip verbatim — only ADD the two fields.)
- [ ] **Step 4: Wizard writes them through.** In `WizardSteps.tsx`, wherever the selected metro chip becomes an area object, produce `{ zip: m.zip, label: m.label, city: m.city, state: m.state }`. Extend the existing wizard test's finish assertion to expect the 4-field areas. Account presets editor: when a row is edited, existing `city`/`state` on that area must survive a label/zip edit untouched (add a test if the page has one; otherwise assert via the shared parser test).
- [ ] **Step 5: Full one suite + typecheck; commit** — `feat(user): areas carry city+state — metros, prefs schema, wizard write-through`

## Task 2: Worker matches city-wide (apps/worker)

**Files:** modify `apps/worker/src/alerts.ts` + `alerts.test.ts`.

- [ ] **Step 1: Failing tests:**

```ts
const candHouston = { id: 7, address: '9 Suburb Ln', zip_code: '77099', city: 'Houston', state: 'TX',
  price: 120000, estimated_rent: 1300, rent_price_ratio: 0.0108 };

it('matches an area to any candidate in the same city+state', async () => {
  const { matchAreas } = await import('./alerts');
  const rows = matchAreas([candHouston as any],
    [{ id: 'u1', areas: [{ zip: '77002', label: 'Houston', city: 'Houston', state: 'TX' }] }]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ listing_id: 7, source_label: 'Houston' });
});

it('city match is case-insensitive and state exact', async () => {
  const { matchAreas } = await import('./alerts');
  const rows = matchAreas([{ ...candHouston, city: 'HOUSTON' } as any],
    [{ id: 'u1', areas: [{ zip: '00000', label: 'H', city: 'houston', state: 'TX' }] }]);
  expect(rows).toHaveLength(1);
});

it('emits ONE row when both zip and city match the same listing', async () => {
  const { matchAreas } = await import('./alerts');
  const rows = matchAreas([{ ...candHouston, zip_code: '77002' } as any],
    [{ id: 'u1', areas: [{ zip: '77002', label: 'Houston', city: 'Houston', state: 'TX' }] }]);
  expect(rows).toHaveLength(1);
});

it('old ZIP-only blobs keep matching by zip alone', async () => {
  const { matchAreas } = await import('./alerts');
  const rows = matchAreas([{ ...candHouston, zip_code: '77002', city: null } as any],
    [{ id: 'u1', areas: [{ zip: '77002', label: 'Houston' }] }]);
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: RED → implement.** `CANDIDATES_SQL` (and `CANDIDATES_SQL_NO_LIFECYCLE`) add `city, state` to the SELECT list — nothing else in the query changes (the partial-index alignment comment and predicates stay byte-identical). `Candidate` type gains `city: string | null; state: string | null`. `matchAreas`:

```ts
export function matchAreas(
  candidates: Candidate[],
  users: Array<{ id: string; areas: unknown }>,
): AlertRow[] {
  const rows: AlertRow[] = [];
  for (const user of users) {
    const areas = Array.isArray(user.areas) ? user.areas : [];
    const seen = new Set<number>(); // one row per (user, listing) no matter how many areas/criteria hit
    for (const area of areas) {
      let areaZip: string | null = null;
      let label: string | null = null;
      let areaCity: string | null = null;
      let areaState: string | null = null;
      if (typeof area === 'string') {
        areaZip = area;
      } else if (area && typeof area === 'object') {
        const a = area as { zip?: unknown; label?: unknown; city?: unknown; state?: unknown };
        if (typeof a.zip === 'string') areaZip = a.zip;
        if (typeof a.label === 'string' && a.label.length > 0) label = a.label;
        if (typeof a.city === 'string' && a.city.length > 0) areaCity = a.city.toLowerCase();
        if (typeof a.state === 'string' && a.state.length === 2) areaState = a.state.toUpperCase();
      }
      const hasCity = areaCity !== null && areaState !== null;
      if ((!areaZip || areaZip.length === 0) && !hasCity) continue;
      for (const c of candidates) {
        if (seen.has(c.id)) continue;
        const zipHit = typeof c.zip_code === 'string' && c.zip_code.length > 0 && c.zip_code === areaZip;
        const cityHit = hasCity
          && typeof c.city === 'string' && c.city.toLowerCase() === areaCity
          && typeof c.state === 'string' && c.state.toUpperCase() === areaState;
        if (!zipHit && !cityHit) continue;
        seen.add(c.id);
        rows.push({
          user_id: user.id,
          listing_id: c.id,
          source: 'area',
          source_label: label ?? areaZip ?? `${c.city}, ${c.state}`,
          ratio: c.rent_price_ratio,
          price: c.price,
        });
      }
    }
  }
  return rows;
}
```

- [ ] **Step 3: GREEN, then update `runAlertTick`'s mock-pool test fixtures** to include `city`/`state` on candidate rows (existing tier-split tests must stay green unmodified in intent).
- [ ] **Step 4: Worker suite + typecheck; commit** — `feat(worker): area alerts match city-wide (zip OR city+state), deduped per listing`

## Task 3: Digest delivers free-tier alert events

**Files:** modify `apps/worker/src/digest.ts` + its test, `apps/worker/src/alert-email.ts` (export the render pieces the digest needs).

- [ ] **Step 1: Failing tests** (digest test file, mock pool + mock fetch, follow the file's existing test idiom):
  - Given a free user `{ email, prefs: { alertOptIn: true } }` with 2 undelivered `alert_events` rows (joined listing fields present), a digest run sends ONE email whose html contains both addresses, and afterwards issues the `UPDATE alert_events SET delivered_at = now() WHERE user_id = $1 AND id = ANY($2)` (assert the exact ids).
  - `alertOptIn` false or missing ⇒ no send, no stamp.
  - Send throws ⇒ NO `delivered_at` update issued (rows retry tomorrow), error logged, run continues to the next user.
  - `RESEND_API_KEY` absent ⇒ the alert section is skipped entirely (existing no-op pattern).
- [ ] **Step 2: RED → implement.** In `alert-email.ts`: export `renderAlertEmail` (if not already exported) so digest reuses the exact template — do not copy it. In `digest.ts`, after the existing saved-search section, add the alert-delivery pass:

```sql
-- Undelivered area/watchlist alert events per user, newest first, joined to listings
SELECT ae.id, ae.user_id, ae.listing_id, ae.source_label, ae.ratio, ae.price,
       l.address, l.city, l.state, l.zip_code, l.primary_photo
FROM alert_events ae
JOIN listings l ON l.id = ae.listing_id
WHERE ae.delivered_at IS NULL
ORDER BY ae.user_id, ae.created_at DESC
LIMIT 500
```

Group rows by user in TS; for each user, load email + prefs (reuse the digest's existing profile query — do not add a second query shape if one exists), skip unless `alertOptIn === true` and email present; render via `renderAlertEmail`, send via the digest's existing send helper; on success `UPDATE alert_events SET delivered_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[])` with exactly the ids sent. Wrap per-user send in try/catch (log + continue).
- [ ] **Step 3: GREEN; worker suite + typecheck; commit** — `feat(worker): daily digest delivers undelivered alert events (opt-in, Resend-gated, retry-safe)`

## Task 4: Tick observability

**Files:** modify `apps/worker/src/alerts.ts` + test.

- [ ] **Step 1: Failing test:** the tick-complete log object (the existing mock-logger assertion in `alerts.test.ts`) gains `backlogFull` (boolean: `candidates.length === 2000`, i.e. the LIMIT was hit and the watermark is crawling a backlog) and `watermarkLagSeconds` (integer: `now − new watermark` — 0-ish when caught up, hours when replaying).
- [ ] **Step 2: RED → implement → GREEN.** Both values computed from data the tick already holds (no new queries). Log line stays a single object: `{ candidates, eventsInserted, instantSent, backlogFull, watermarkLagSeconds }`.
- [ ] **Step 3: Commit** — `feat(worker): alert tick logs backlog + watermark lag`

## Task 5: Deploy + coverage proof

- [ ] **Step 1:** Deploy: `bash ops/systemd/deploy-systemd.sh app worker-alerts worker-digest` (worker dist rebuild: `rm -rf apps/worker/dist apps/worker/*.tsbuildinfo` first — the tsc incremental cache can exit 0 without writing dist).
- [ ] **Step 2: Coverage proof:** update the existing proof account's areas via `/account#presets` (or re-run the wizard) so Houston/Cleveland carry city+state; within ≤2 ticks the log shows `eventsInserted > 0` as city-wide candidates land (Cleveland OH alone had 33 in-range listings on 2026-07-19; city-wide Houston TX will add more as the crawler re-sees them). `SELECT count(*) FROM alert_events WHERE user_id = <proof user>` grows.
- [ ] **Step 3: Email proof:** with an operator-controlled inbox on the proof account and `alertOptIn = true`, the next digest run (or a manually-triggered run) delivers ONE email containing the queued deals; `delivered_at` is stamped on exactly those rows; a second run sends nothing (idempotent).
- [ ] **Step 4: No-regression:** pro instant leg untouched (tier-split tests green); tick logs show `watermarkLagSeconds` shrinking between ticks; scraper cadence unchanged (crawl completions steady in `journalctl -u oper-worker`).

## Self-Review

**Spec coverage:** metro areas actually cover their metro (T1 schema + T2 matching) · free tier's promised daily digest of deals becomes real, opt-in and retry-safe (T3) · the engine's health is observable (T4) · deployed with coverage/email/idempotency proofs (T5). Covered.

**Placeholder scan:** all steps name exact files; test bodies and the matching implementation are complete; the one SQL block is full text; no "similar to" references.

**Type consistency:** `Metro` gains `city/state` (T1) consumed by the wizard write-through (T1 §4); the area parser emits `city`/`state` only as a valid pair, which is exactly what `matchAreas` requires (T2 `hasCity`); `Candidate` gains `city/state` in the same task that changes the SQL; `renderAlertEmail` is exported once and reused (T3), never copied.
