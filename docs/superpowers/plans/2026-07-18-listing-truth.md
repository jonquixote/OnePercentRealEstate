# Listing Truth — Rental Misfiles, Sold Reconciliation, Block-Safe Freshness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop lying about deals. (1) Rentals misfiled as for-sale listings — $12,000/mo apartments shown as $12,000 houses "clearing the line" — get classified truthfully at ingest and quarantined retroactively. (2) Sold/vanished listings get a lifecycle: reconciled against sold records, aged out when the crawler stops seeing them, kept forever in the data but excluded from search/features by default. All refresh work rides the existing AIMD scraper pool so Realtor.com never sees a new traffic pattern.

**Architecture:** The discriminator is already in our data: Realtor rental URLs are `/rentals/details/…` while sales are `/realestateandhomes-detail/…`. The scraper gains a per-row URL check that routes rentals to `rental_listings` no matter which pass returned them. A migration quarantines the existing 2,865 misfiled rows via a new `listing_status` lifecycle (`active | pending_verify | sold | stale | rental_misfiled`) that every read surface filters on. A `last_seen_at` column (stamped on upsert) feeds a worker reaper that ages out unseen listings and matches them against `sold_listings` by address. A `recheck` crawl-job kind re-scans ZIPs holding aged pending/contingent clearers — capped at a fraction of pool slots so politeness is untouched.

**Tech Stack:** Python FastAPI scraper (`services/scraper_service`, pytest), Postgres migration (repo runner), TS worker (`apps/worker`, Vitest), Next API routes (apps/one).

## Global Constraints

- **Never delete listing data.** Misfiled/sold/stale rows are re-labeled, never dropped. `sold_listings` stays the sales ledger; `listings.listing_status` is the lifecycle.
- **Politeness is inviolable:** zero new request patterns. Rechecks are ordinary `crawl_jobs` rows consumed by the existing pool/AIMD driver; recheck share ≤ 1 in 5 claimed jobs (`RECHECK_MAX_SHARE = 0.2`); no new endpoints hit, no burst behavior. The scraper service itself changes only row ROUTING, not request volume.
- **`listing_status` semantics:** `active` (default), `pending_verify` (aged PENDING/CONTINGENT awaiting recheck), `sold`, `stale` (unseen ≥ `STALE_AFTER_DAYS`=10, ≈2 full passes at current 2-IP throughput), `rental_misfiled`. The legacy value `'watch'` is migrated to `active`.
- **Read surfaces default to `listing_status NOT IN ('sold','stale','rental_misfiled')`**; sold rows are opt-in (`include_sold=1` param) and render with a SOLD treatment. Surfaces: `/api/properties`, `/api/properties/query`, spotlight, `mv_market_grid`, the 1% index snapshot job, valuation comps.
- **URL classification is authoritative over pass type:** `%/rentals/details/%` ⇒ rental, both at ingest and in the backfill. A missing URL falls back to today's behavior.
- **Tests:** scraper `cd services/scraper_service && pytest -q`; worker `pnpm --filter @oper/worker test <path>`; app `pnpm --filter @oper/one test <path>`.

## Current State (verified 2026-07-18 on prod)

- 2,865 rows in `listings` have `raw_data->>'property_url' LIKE '%/rentals/details/%'`; **2,834 falsely clear 1%** (2.5% of all 112,909 clearers); pass origin: PENDING 2,650 · CONTINGENT 188 · FOR_SALE 27. Example: id 4588, "2831 S Bayshore Dr Unit 2205" — price $12,000 (actually monthly rent), status CONTINGENT.
- Genuine cheap sales exist (id 9, "225 Sun Ter" Tampa, $12,000, sales URL) — **price floors cannot fix this; only the URL can.**
- "225 Sun Ter" is SOLD on realtor.com but our row says PENDING (updated 07-07); it is NOT in `sold_listings` (the 14-day sold pass missed it) → reconciliation needs the recheck path, not just the sold table.
- `listings.listing_status` exists (text) with the single value `'watch'` everywhere. `updated_at` is NOT a seen-signal (touched by enrichment). No `last_seen_at` exists.
- Scraper routing: `services/scraper_service/main.py` `route_row_type(row_status, is_combined, req_listing_type)` trusts the request type for single-type passes — that is the hole (pending/contingent passes return rental rows).
- Driver: `apps/worker/src/crawl.ts` claims `crawl_jobs` (SKIP LOCKED) via `claimNextJob()`, 5 passes per job through the AIMD `ScraperPool`. `crawl_jobs` has `region_type/region_value/status` columns.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_18_listing_lifecycle.sql` (create) | `last_seen_at` column, lifecycle CHECK, quarantine backfill, partial indexes. |
| `services/scraper_service/main.py` (modify) | `is_rental_url()` guard inside row routing; stamp `last_seen_at` on upsert. |
| `services/scraper_service/test_rental_url_routing.py` (create) | Routing tests. |
| `apps/worker/src/lifecycle.ts` (create) | Reaper: stale marking, sold matching, recheck enqueue. Pure SQL steps, testable. |
| `apps/worker/src/lifecycle.test.ts` (create) | SQL-shape + share-cap tests. |
| `apps/worker/src/crawl.ts` (modify) | Wire `runLifecycleTick` on an interval; recheck jobs flow through the normal claim path. |
| `apps/one/src/app/api/properties/query/route.ts` + `apps/one/src/app/api/properties/route.ts` + `apps/one/src/lib/spotlight.ts` (modify) | Default lifecycle filter + `include_sold`. |
| `infrastructure/migrations/2026_07_18_mv_market_grid_lifecycle.sql` (create) | Rebuild mv with the lifecycle filter. |

---

## Task 1: Migration — lifecycle column, quarantine, indexes

**Files:**
- Create: `infrastructure/migrations/2026_07_18_listing_lifecycle.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lifecycle for listings + quarantine of rental misfiles.
-- NEVER deletes: misfiled rows are re-labeled and excluded by readers.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
-- Seed: best available proxy so the reaper doesn't mass-stale on day one.
UPDATE listings SET last_seen_at = updated_at WHERE last_seen_at IS NULL;

-- Normalize legacy status value, then constrain the vocabulary.
UPDATE listings SET listing_status = 'active' WHERE listing_status = 'watch' OR listing_status IS NULL;
-- NULL silently passes a CHECK (UNKNOWN) — lock the column down first.
ALTER TABLE listings ALTER COLUMN listing_status SET NOT NULL;
ALTER TABLE listings ALTER COLUMN listing_status SET DEFAULT 'active';
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_lifecycle_chk;
ALTER TABLE listings ADD CONSTRAINT listings_lifecycle_chk
  CHECK (listing_status IN ('active','pending_verify','sold','stale','rental_misfiled'));

-- Quarantine: the URL is authoritative. 2,865 rows at authoring time.
-- property_url is a first-class column (verified 100% populated on prod) —
-- avoid deserializing raw_data JSONB across 1.1M rows.
UPDATE listings SET listing_status = 'rental_misfiled'
WHERE property_url LIKE '%/rentals/details/%';

-- Sold columns denormalized onto the listing when reconciled (Task 3).
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_price numeric;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_date date;

-- Readers filter on lifecycle constantly; keep it cheap.
CREATE INDEX IF NOT EXISTS idx_listings_lifecycle ON listings (listing_status)
  WHERE listing_status <> 'active';
-- Reaper scan support.
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings (last_seen_at)
  WHERE listing_type = 'for_sale' AND listing_status IN ('active','pending_verify');
```

- [ ] **Step 2: Dry-run locally / CI** — `migrations-dry-run` CI job must pass (the runner wraps the file in one transaction; all statements above are transactional-safe).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/migrations/2026_07_18_listing_lifecycle.sql
git commit -m "feat(data): listing lifecycle + rental-misfile quarantine + last_seen_at"
```

---

## Task 2: Scraper — URL-authoritative routing + last_seen stamp

**Files:**
- Modify: `services/scraper_service/main.py`
- Create: `services/scraper_service/test_rental_url_routing.py`

**Interfaces:**
- Produces: pure `is_rental_url(url: str | None) -> bool`; `route_row_type(row_status, is_combined, req_listing_type, property_url=None)` gains the optional url param — **url verdict wins**.

- [ ] **Step 1: Write the failing tests**

```python
# services/scraper_service/test_rental_url_routing.py
from main import is_rental_url, route_row_type

def test_rental_details_url_is_rental():
    assert is_rental_url("https://www.realtor.com/rentals/details/2831-S-Bayshore-Dr...") is True

def test_sale_url_is_not_rental():
    assert is_rental_url("https://www.realtor.com/realestateandhomes-detail/225-Sun-Ter...") is False
    assert is_rental_url(None) is False

def test_url_overrides_pending_pass():
    # The exact prod bug: pending pass returns a rental row.
    assert route_row_type("PENDING", False, "pending",
                          property_url="https://www.realtor.com/rentals/details/x") == "for_rent"

def test_no_url_keeps_legacy_behavior():
    assert route_row_type("PENDING", False, "pending", property_url=None) == "pending"
```

- [ ] **Step 2: Run to verify it fails** — `cd services/scraper_service && pytest test_rental_url_routing.py -q` → FAIL (import).

- [ ] **Step 3: Implement** — in `main.py`:

```python
def is_rental_url(url):
    return bool(url) and "/rentals/details/" in str(url)

# route_row_type: add the parameter and the FIRST check:
def route_row_type(row_status, is_combined, req_listing_type, property_url=None):
    # Realtor's pending/contingent (and rarely for_sale) searches return rental
    # rows whose list_price is the MONTHLY RENT. The URL is authoritative.
    if is_rental_url(property_url):
        return 'for_rent'
    if not is_combined:
        return req_listing_type
    ...  # unchanged
```

Wire the call site (the per-row loop) to pass `row.get('property_url')`, and in the three INSERT/upsert statements (`listings`, `rental_listings`, `sold_listings`) add `last_seen_at = now()` to both the INSERT columns and the `ON CONFLICT ... DO UPDATE SET` list for `listings` (the other two tables don't need it). NOTE: rental-routed rows from a single-type pass must go through the SAME rental insert path the combined demux uses — follow the existing `row_type == 'for_rent'` branch.

- [ ] **Step 4: Run new tests + full scraper suite** — `pytest -q` all green.

- [ ] **Step 5: Commit**

```bash
git add services/scraper_service/main.py services/scraper_service/test_rental_url_routing.py
git commit -m "fix(scraper): rental URLs route to rental_listings from ANY pass; stamp last_seen_at"
```

---

## Task 3: Worker lifecycle tick — stale reaper, sold matcher, recheck enqueue

**Files:**
- Create: `apps/worker/src/lifecycle.ts` + `apps/worker/src/lifecycle.test.ts`
- Modify: `apps/worker/src/crawl.ts` (one interval wire-up), `apps/worker/src/env.ts` (knobs)

**Interfaces:**
- `runLifecycleTick(pool: Pool, log: WorkerLogger, cfg: LifecycleCfg): Promise<LifecycleStats>` where `LifecycleCfg = { staleAfterDays: number; pendingVerifyAfterDays: number; recheckBatch: number }` and `LifecycleStats = { staled: number; soldMatched: number; pendingFlagged: number; rechecksEnqueued: number }`.
- env: `LIFECYCLE_TICK_MS` (default 6h), `STALE_AFTER_DAYS` (10), `PENDING_VERIFY_AFTER_DAYS` (7), `RECHECK_BATCH` (40).

- [ ] **Step 1: Failing tests** — test the four SQL steps as pure builders (same style as `spotlight.test.ts`: assert parameterization + the load-bearing predicates):

```ts
// apps/worker/src/lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { STALE_SQL, SOLD_MATCH_SQL, PENDING_FLAG_SQL, RECHECK_ENQUEUE_SQL } from './lifecycle';

describe('lifecycle SQL', () => {
  it('stale: only active/pending_verify for_sale rows, param-driven cutoff, never sold/misfiled', () => {
    expect(STALE_SQL).toMatch(/listing_status\s+IN\s+\('active','pending_verify'\)/i);
    expect(STALE_SQL).toMatch(/last_seen_at\s*<\s*now\(\)\s*-\s*\(\$1\s*\|\|\s*' days'\)::interval/i);
    expect(STALE_SQL).toMatch(/SET\s+listing_status\s*=\s*'stale'/i);
  });
  it('sold match: exact address join to sold_listings, copies price/date', () => {
    // Both tables build address with the SAME scraper normalization, so raw
    // equality is index-friendly (no lower/trim wrappers defeating indexes).
    expect(SOLD_MATCH_SQL).toMatch(/l\.address\s*=\s*s\.address/i);
    expect(SOLD_MATCH_SQL).toMatch(/SET\s+listing_status\s*=\s*'sold',\s*sold_price/i);
  });
  it('pending flag: aged PENDING/CONTINGENT clearers become pending_verify', () => {
    expect(PENDING_FLAG_SQL).toMatch(/raw_data->>'status'\s+IN\s+\('PENDING','CONTINGENT'\)/);
    expect(PENDING_FLAG_SQL).toMatch(/pending_verify/);
  });
  it('recheck enqueue: distinct zips, capped batch, idempotent against open jobs', () => {
    expect(RECHECK_ENQUEUE_SQL).toMatch(/INSERT INTO crawl_jobs/i);
    expect(RECHECK_ENQUEUE_SQL).toMatch(/LIMIT \$1/);
    expect(RECHECK_ENQUEUE_SQL).toMatch(/NOT EXISTS/i); // no dup open job for the zip
  });
});
```

- [ ] **Step 2: RED**, then **Step 3: Implement** `lifecycle.ts`:

```ts
import type { Pool } from 'pg';
import type { WorkerLogger } from './logger.js';

export const STALE_SQL = `
  UPDATE listings SET listing_status = 'stale'
   WHERE listing_type = 'for_sale'
     AND listing_status IN ('active','pending_verify')
     AND last_seen_at < now() - ($1 || ' days')::interval`;

export const SOLD_MATCH_SQL = `
  UPDATE listings l
     SET listing_status = 'sold', sold_price = s.sold_price, sold_date = s.sold_date
    FROM sold_listings s
   WHERE l.listing_type = 'for_sale'
     AND l.listing_status IN ('active','pending_verify','stale')
     AND l.address = s.address
     AND s.sold_date >= l.created_at::date`;

export const PENDING_FLAG_SQL = `
  UPDATE listings SET listing_status = 'pending_verify'
   WHERE listing_type = 'for_sale' AND listing_status = 'active'
     AND raw_data->>'status' IN ('PENDING','CONTINGENT')
     AND last_seen_at < now() - ($1 || ' days')::interval`;

// One recheck job per ZIP holding pending_verify rows; ordinary crawl_jobs rows
// (the driver's normal claim/pace path applies) tagged so completion re-stamps.
export const RECHECK_ENQUEUE_SQL = `
  INSERT INTO crawl_jobs (region_type, region_value, status)
  SELECT 'zip_recheck', z.zip_code, 'pending'
    FROM (SELECT zip_code, count(*) AS n FROM listings
           WHERE listing_status = 'pending_verify' AND zip_code ~ '^\\d{5}$'
           GROUP BY zip_code ORDER BY n DESC LIMIT $1) z
   WHERE NOT EXISTS (SELECT 1 FROM crawl_jobs c
                      WHERE c.region_value = z.zip_code
                        AND c.region_type = 'zip_recheck'
                        AND c.status IN ('pending','processing'))`;

export type LifecycleCfg = { staleAfterDays: number; pendingVerifyAfterDays: number; recheckBatch: number };
export type LifecycleStats = { staled: number; soldMatched: number; pendingFlagged: number; rechecksEnqueued: number };

export async function runLifecycleTick(pool: Pool, log: WorkerLogger, cfg: LifecycleCfg): Promise<LifecycleStats> {
  const staled = (await pool.query(STALE_SQL, [cfg.staleAfterDays])).rowCount ?? 0;
  const soldMatched = (await pool.query(SOLD_MATCH_SQL)).rowCount ?? 0;
  const pendingFlagged = (await pool.query(PENDING_FLAG_SQL, [cfg.pendingVerifyAfterDays])).rowCount ?? 0;
  const rechecksEnqueued = (await pool.query(RECHECK_ENQUEUE_SQL, [cfg.recheckBatch])).rowCount ?? 0;
  const stats = { staled, soldMatched, pendingFlagged, rechecksEnqueued };
  log.info(stats, 'lifecycle tick');
  return stats;
}
```

- [ ] **Step 4: Wire into `crawl.ts`** — a `setInterval(…, env.LIFECYCLE_TICK_MS).unref()` beside the metrics loop, guarded try/catch; `zip_recheck` jobs need no driver change (the driver treats any `region_value` ZIP the same — its sold+pending passes are exactly the verification we need; confirm `claimNextJob()` doesn't filter `region_type`, adjust its WHERE to include `'zip_recheck'` if it does). Recheck-share cap: in `claimNextJob`'s ORDER BY, prefer normal jobs and only claim a `zip_recheck` when `random() < 0.2` — implement as the SQL comment in the file describes and keep the constant in env (`RECHECK_MAX_SHARE`).
- [ ] **Step 5: env knobs** in `env.ts` (`LIFECYCLE_TICK_MS` 6h, `STALE_AFTER_DAYS` 10, `PENDING_VERIFY_AFTER_DAYS` 7, `RECHECK_BATCH` 40, `RECHECK_MAX_SHARE` 0.2), typecheck + full worker suite green.
- [ ] **Step 6: Commit** — `feat(worker): listing lifecycle tick — stale reaper, sold matcher, capped zip rechecks`

---

## Task 4: Read surfaces respect the lifecycle

**Files:**
- Modify: `apps/one/src/app/api/properties/query/route.ts`, `apps/one/src/app/api/properties/route.ts`, `apps/one/src/lib/spotlight.ts` (+ its test), `apps/one/src/app/api/index snapshot job wherever it queries listings` (grep `FROM listings` under `apps/one/src/app` and `apps/worker/src/index-*`), create `infrastructure/migrations/2026_07_18_mv_market_grid_lifecycle.sql`.

- [ ] **Step 1: Spotlight (TDD)** — add to `spotlight.test.ts`: `expect(sql).toMatch(/listing_status\s*=\s*'active'/i);` → RED → add `AND listing_status = 'active'` to `buildSpotlightQuery` → GREEN.
- [ ] **Step 2: Query route** — in the SQL of `/api/properties/query`: default `AND listing_status NOT IN ('sold','stale','rental_misfiled')`; when the request body sets `includeSold: true`, relax to `NOT IN ('stale','rental_misfiled')`. Surface `listing_status`, `sold_price`, `sold_date` in the SELECT so cards can render a SOLD band.
- [ ] **Step 3: `/api/properties`** — same default filter; `?include_sold=1` opt-in.
- [ ] **Step 4: mv rebuild migration** — `DROP MATERIALIZED VIEW IF EXISTS mv_market_grid;` + recreate with `AND listing_status = 'active'` in the `top` CTE (copy the current definition from `2026_07_17_mv_market_grid.sql`), recreate the unique index, `REFRESH` once.
- [ ] **Step 5: SearchCard SOLD band** — when `listing_status === 'sold'`, render a `prov`-styled "SOLD {sold_date} · {usd(sold_price)}" ribbon over the mat and mute the CTA (small conditional in `SearchCard.tsx`; only reachable when the user opted into sold).
- [ ] **Step 6: Full app suite + typecheck green; commit** — `feat(app): lifecycle-aware search/spotlight/mv — sold opt-in, misfiles gone`

---

## Task 5: Deploy + prove it on the three real cases

- [ ] **Step 1:** Merge → run both migrations → deploy scraper file to side box + main (scp per runbook; both boxes) → rebuild worker + apps → restart `oper-worker`, `oper-app`, `oper-scraper` (both boxes).
- [ ] **Step 2: Bayshore/Bay Point gone from search** — `/api/properties/query` for Miami ratio≥1% must NOT return ids 4588 / 4226937; DB shows both `rental_misfiled`.
- [ ] **Step 3: Sun Ter path** — flag it `pending_verify` (it ages in naturally), confirm a `zip_recheck` job for 33613 appears within one lifecycle tick and, after the driver processes it, the sold pass upserts `sold_listings` and the next tick marks the listing `sold` with price/date. (If Realtor's 14-day sold window has passed for this specific address, verify the mechanism on any ZIP with a fresh sale instead and mark Sun Ter `stale` via aging — the honest outcome.)
- [ ] **Step 4: Clearer count sanity** — total 1%-clearers drops by ≈2,800 (the fakes) and the index/means shift accordingly; note the new number in the PR.
- [ ] **Step 5: Politeness proof** — `journalctl -u oper-worker`: endpoint metrics show no interval change; recheck jobs ≤20% of completions over an hour.

## Self-Review

**Spec coverage:** misfiled rentals truthfully classified at ingest (T2) + quarantined historically (T1) · genuine cheap sales unaffected (URL, not price, discriminates — Sun Ter stays) · sold detected via ledger match (T3) AND via targeted recheck for missed ones (T3/T5) · stale aging for vanished listings (T3) · data kept forever, hidden by default, opt-in visible with SOLD treatment (T4) · zero new load patterns on Realtor (recheck = normal pool jobs, share-capped) — the user's three explicit asks plus the politeness constraint. Covered.

**Placeholder scan:** every SQL/Python/TS block is complete; the two integration points described in prose (per-row call site passing `property_url`; claimNextJob share cap) name exact functions and the mechanism to use.

**Type consistency:** `LifecycleCfg/LifecycleStats` defined once (T3); lifecycle vocabulary identical across migration CHECK (T1), scraper (T2 routes, doesn't write status), worker SQL (T3), and reader filters (T4); `sold_price/sold_date` columns created in T1 and consumed in T3 (write) / T4 (read).
