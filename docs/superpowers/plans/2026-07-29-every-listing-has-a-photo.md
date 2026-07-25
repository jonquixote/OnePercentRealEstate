# Every Listing Shows Its Photo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ~446,000 active listings that already have images actually render one, instead of the 0.03% that do today.

**Architecture:** The data is already there and has been all along — it lives in the `images` jsonb column, not the native `primary_photo` column that most read paths select. Backfill the native column from `images` (batched, paced, resumable, through the same discipline as the rent-band backfill), fix the read paths that select the empty column, and add a coverage probe so this class of gap announces itself instead of surviving for months.

**Tech Stack:** PostgreSQL 16, Next 16 (`apps/one`), TypeScript, vitest, bash ops scripts + systemd timers.

## The measured problem

Taken on prod (`209.50.61.64`, database `postgres`) on 2026-07-25:

| Metric | Count |
|---|---|
| Active for-sale listings | 449,654 |
| …with a non-empty `images` jsonb | **446,437 (99.3%)** |
| …with the native `primary_photo` column set | **140 (0.03%)** |
| …genuinely imageless (no column, no jsonb, no `raw_data`) | 3,215 (0.7%) |

And the effect on the primary card-rendering path:

```
GET /api/properties/viewport?north=28.1&south=27.8&east=-82.3&west=-82.7&zoom=11
  rows: 293
  with primary_photo: 0 / 293
```

**Zero of 293.** Every one of those listings has images. This is not a data
acquisition problem; it is a read-path problem plus an un-run backfill.

Exactly one route already knows — `apps/one/src/app/api/properties/query/route.ts:152`
carries the comment *"primary_photo is ~0.3% populated; photos live in the images
jsonb"* and works around it with `COALESCE(primary_photo, images->>0)`. That
workaround was never applied to the other read paths, and the underlying column
was never backfilled. One person found the bug, patched their own query, and the
knowledge stopped there.

## Global Constraints

- **Relabel/repair, never delete.** The backfill only fills `primary_photo` where it is NULL. It must never overwrite a non-NULL value and never touch `images`.
- **Batched, paced, resumable.** Follow `ops/db/backfill-rent-bands.sh`: bounded batch size, a pause between batches, and safe to re-run after interruption. It must not starve the crawler — check crawl throughput while it runs.
- **Prefer native columns over `raw_data`/jsonb extraction in read paths.** Measured on this database: reading `raw_data->>'city'` cost 1.074 ms / 41 buffers versus 0.061 ms / 4 buffers for the native column, because `raw_data` is TOASTed and every extraction decompresses the whole document.
- **Verify equivalence before switching a read path**, on real rows, and state the row counts. Two plan premises have already been proven wrong by measurement in this codebase; assume nothing.
- **No new unbounded background work.** Any probe added here must be O(index), not a full scan of `listings` — the postgres-exporter once consumed 79% of all database time doing exactly that.
- Budgets and instrumentation conventions live in `docs/perf/perf-budgets.md`; new routes touched here keep their existing p95 budgets.

---

## Task 1: Establish exactly which read paths are broken

**Files:**
- Create: `docs/perf/2026-07-photo-coverage-audit.md`
- Read: `apps/one/src/app/api/properties/viewport/route.ts:192`, `apps/one/src/app/api/properties/route.ts:72,93`, `apps/one/src/app/api/v1/listings/route.ts:158`, `apps/one/src/app/api/alerts/route.ts:30`, `apps/one/src/app/api/properties/query/route.ts:152-167`, `apps/one/src/app/api/spotlight/route.ts`

**Interfaces:**
- Produces: the audit document, and the definitive list of read paths to fix in Task 3.

- [ ] **Step 1: Enumerate every read path that selects a photo.**

```bash
grep -rn "primary_photo\|images" apps/one/src apps/two/src packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\."
```

For each hit, record in the audit: file:line, whether it selects the bare
native column or already coalesces, and whether it is user-facing.

- [ ] **Step 2: Measure the real coverage per path.** Run each endpoint on prod and count how many returned rows carry a usable photo. Use the viewport call above as the template. Record actual numbers, not impressions.

- [ ] **Step 3: Check whether `images` is TOASTed**, because it decides whether the backfill is also a performance win:

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT images->>0 FROM listings WHERE listing_status='active' LIMIT 200;
EXPLAIN (ANALYZE, BUFFERS)
  SELECT primary_photo FROM listings WHERE listing_status='active' LIMIT 200;
```

Record both buffer counts and both execution times in the audit.

- [ ] **Step 4: Confirm the shape of `images`** before writing any backfill that indexes into it. Do not assume element 0 is the primary photo:

```sql
SELECT jsonb_typeof(images) AS t, count(*)
  FROM listings WHERE images IS NOT NULL GROUP BY 1;

SELECT jsonb_typeof(images->0) AS elem0_type, count(*)
  FROM listings WHERE images IS NOT NULL AND jsonb_array_length(images) > 0
  GROUP BY 1;

SELECT images->>0 FROM listings
  WHERE images IS NOT NULL AND jsonb_array_length(images) > 0 LIMIT 5;
```

If `images->0` is an **object** rather than a string, the extraction expression
is not `images->>0` — find the URL key and use it. Write the confirmed
expression into the audit as `PHOTO_EXPR`; every later task uses that exact
expression.

- [ ] **Step 5: Commit** — `docs(photos): coverage audit — where the photos are and which paths miss them`

---

## Task 2: Backfill the native column

**Files:**
- Create: `ops/db/backfill-primary-photo.sh`
- Reference: `ops/db/backfill-rent-bands.sh` (pattern to follow — batching, pacing, resumability, progress logging)

**Interfaces:**
- Consumes: `PHOTO_EXPR` from Task 1 Step 4.
- Produces: `listings.primary_photo` populated for ~446k active rows.

- [ ] **Step 1: Add a partial index so the backfill can find its work in O(index), not a full scan each batch.**

Create `infrastructure/migrations/2026_07_29_primary_photo_backfill_idx.sql`:

```sql
-- Lets the backfill locate remaining work without re-scanning 1.3M rows per
-- batch. Partial: only rows that still need filling are of interest, so the
-- index shrinks to nothing as the backfill completes and costs almost no
-- maintenance afterwards.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_photo_backfill
  ON listings (id)
  WHERE primary_photo IS NULL;
```

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and the migration
runner wraps each file in a single `BEGIN`/`COMMIT` — so this file goes in
`infrastructure/migrations/out-of-band/` and is applied by hand, exactly like
`2026_06_21_create_unique_index_concurrently.sql`.

- [ ] **Step 2: Write the backfill script.**

```bash
#!/usr/bin/env bash
# Backfill listings.primary_photo from the images jsonb.
#
# 446,437 active listings have images; 140 have the native column. Every read
# path that selects the bare column therefore renders an imageless card. The
# data was always present — only the column was empty.
#
# Batched/paced/resumable, same discipline as backfill-rent-bands.sh: this runs
# against the live database while the crawler is writing to the same table.
set -uo pipefail

TARGET="${1:-500000}"      # max rows to fill this run
BATCH="${2:-5000}"         # rows per statement
PAUSE="${3:-20}"           # seconds between batches — leaves headroom for the crawl

if [[ -f /etc/oper.env ]]; then set -a; . /etc/oper.env; set +a; fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[photo-backfill] no DATABASE_URL" >&2; exit 1; }

filled=0
while (( filled < TARGET )); do
  n=$(psql "$DB" -tA -c "
    WITH batch AS (
      SELECT id FROM listings
       WHERE primary_photo IS NULL
         AND images IS NOT NULL
         AND jsonb_array_length(images) > 0
       ORDER BY id
       LIMIT ${BATCH}
    )
    UPDATE listings l
       SET primary_photo = PHOTO_EXPR_GOES_HERE
      FROM batch b
     WHERE l.id = b.id
       AND l.primary_photo IS NULL
    RETURNING 1;" 2>/dev/null | grep -c 1)

  [[ -z "$n" || "$n" -eq 0 ]] && { echo "[photo-backfill] no rows left to fill"; break; }
  filled=$(( filled + n ))

  remaining=$(psql "$DB" -tA -c "
    SELECT count(*) FROM listings
     WHERE primary_photo IS NULL AND images IS NOT NULL
       AND jsonb_array_length(images) > 0;" 2>/dev/null)
  echo "[photo-backfill] filled ${n} (run total ${filled}/${TARGET}); remaining: ${remaining:-?}"
  sleep "$PAUSE"
done
echo "[photo-backfill] finished this run. filled ${filled}."
```

Replace `PHOTO_EXPR_GOES_HERE` with the expression confirmed in Task 1 Step 4.
The `AND l.primary_photo IS NULL` in the UPDATE is not redundant with the CTE —
it prevents clobbering a value the crawler wrote between the SELECT and the
UPDATE.

- [ ] **Step 3: Dry-run on 100 rows and eyeball the result.**

```bash
bash ops/db/backfill-primary-photo.sh 100 100 1
```

Then confirm the values are real URLs, not `null` strings or JSON fragments:

```sql
SELECT primary_photo FROM listings
 WHERE primary_photo IS NOT NULL ORDER BY updated_at DESC LIMIT 10;
```

Expected: 10 rows, each an `http(s)://…` URL. If any row is the four-character
text `null`, the extraction expression is wrong — stop and fix it before
continuing, then null out the bad rows you just wrote.

- [ ] **Step 4: Run the full backfill and watch the two things that can go wrong.**

```bash
nohup bash ops/db/backfill-primary-photo.sh 500000 5000 20 > /tmp/photo-backfill.log 2>&1 &
```

While it runs, check both, and stop the backfill if either degrades:

```bash
/opt/onepercent/ops/monitoring/db-load-budget.sh   # must not report a new top query
/opt/onepercent/ops/monitoring/crawl-health.sh     # crawl throughput must hold
```

- [ ] **Step 5: Verify coverage reached the floor established in Task 1.**

```sql
SELECT count(*) FILTER (WHERE primary_photo IS NOT NULL) AS with_photo,
       count(*) FILTER (WHERE primary_photo IS NULL
                         AND images IS NOT NULL
                         AND jsonb_array_length(images) > 0) AS fillable_left,
       count(*) AS total
  FROM listings WHERE listing_status='active' AND listing_type='for_sale';
```

Expected: `fillable_left` = 0, `with_photo` ≈ 446,400. Any shortfall must be
**explained in the audit doc**, not rounded away.

- [ ] **Step 6: Commit** — `feat(photos): backfill primary_photo from the images jsonb`

---

## Task 3: Fix the read paths

**Files:**
- Modify: `apps/one/src/app/api/properties/viewport/route.ts:192`
- Modify: `apps/one/src/app/api/properties/route.ts:72`
- Modify: `apps/one/src/app/api/v1/listings/route.ts:158`
- Modify: `apps/one/src/app/api/alerts/route.ts:30`
- Test: `apps/one/src/app/api/properties/viewport/route.test.ts`

**Interfaces:**
- Consumes: the populated `primary_photo` column from Task 2.

- [ ] **Step 1: Write the failing test first.** The bug is "the API returns rows whose photo is null even though the listing has images", so assert on the API's output shape:

```ts
import { describe, it, expect, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...(a as [])) } }));

describe('GET /api/properties/viewport', () => {
  it('returns a photo when the listing has one', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: '1', primary_photo: 'https://img.example/a.jpg', latitude: 28, longitude: -82 },
    ] });
    const { GET } = await import('./route');
    const res = await GET(new Request(
      'http://x/api/properties/viewport?north=28.1&south=27.8&east=-82.3&west=-82.7&zoom=11',
    ));
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.properties ?? body.items ?? body.data ?? []);
    expect(rows[0].primary_photo).toBe('https://img.example/a.jpg');
  });

  it('falls back to the images jsonb for a row the backfill has not reached', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: '2', primary_photo: 'https://img.example/b.jpg', latitude: 28, longitude: -82 },
    ] });
    const { GET } = await import('./route');
    const res = await GET(new Request(
      'http://x/api/properties/viewport?north=28.1&south=27.8&east=-82.3&west=-82.7&zoom=11',
    ));
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.properties ?? body.items ?? body.data ?? []);
    expect(rows[0].primary_photo).toBe('https://img.example/b.jpg');
    // The SQL must contain the fallback, not just the bare column.
    expect(String(query.mock.calls[0]?.[0])).toMatch(/COALESCE\(\s*primary_photo/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @oper/one test --run src/app/api/properties/viewport
```

Expected: FAIL on the `COALESCE` assertion, because the route selects the bare column.

- [ ] **Step 3: Change each SELECT to coalesce.** In every file listed above, replace the bare selection:

```sql
      primary_photo,
```

with the same expression the query route already uses:

```sql
      COALESCE(primary_photo, images->>0) AS primary_photo,
```

Use the `PHOTO_EXPR` confirmed in Task 1 Step 4 if it is not `images->>0`.

Keep the fallback even though Task 2 backfilled the column: new listings arrive
continuously from the crawler, and a listing inserted between backfill runs
would otherwise render imageless. The native column is the fast path; the
jsonb is the safety net.

- [ ] **Step 4: Run the tests and the typecheck.**

```bash
pnpm --filter @oper/one test --run
pnpm --filter @oper/one exec tsc --noEmit
```

Expected: all pass, no TS errors.

- [ ] **Step 5: Commit** — `fix(photos): read paths coalesce to the images jsonb instead of returning null`

---

## Task 4: Make the crawler fill the column on the way in

**Files:**
- Modify: the scraper's listing upsert (find it with `grep -rn "ON CONFLICT (address, listing_type, sale_type)" services/ apps/`)
- Test: alongside the existing upsert tests in that service

**Interfaces:**
- Produces: newly crawled listings that arrive with `primary_photo` already set, so the backfill never needs running again.

- [ ] **Step 1: Find the upsert and confirm what it writes today.**

```bash
grep -rn "ON CONFLICT (address, listing_type, sale_type)" services/ apps/ | grep -v node_modules
```

Read the column list. Confirm whether `primary_photo` is in it and, if it is,
what value it receives — the audit says only 140 rows ever got one, so either
it is absent from the insert or it is being fed something that is almost always
null.

- [ ] **Step 2: Write the failing test** asserting that ingesting a listing whose payload carries photos results in a non-null `primary_photo`. Match the existing test style in that service — do not introduce a new framework.

- [ ] **Step 3: Run it and watch it fail.**

- [ ] **Step 4: Set the column in the upsert** from the same source that populates `images`. On conflict, only fill it when it is currently NULL, so a manual correction is never clobbered:

```sql
  primary_photo = COALESCE(listings.primary_photo, EXCLUDED.primary_photo)
```

- [ ] **Step 5: Run the tests.** Expected: pass.

- [ ] **Step 6: Commit** — `fix(crawl): populate primary_photo at ingest so the column stops drifting empty`

---

## Task 5: A probe, so this cannot silently rot again

**Files:**
- Create: `ops/monitoring/photo-coverage.sh`
- Create: `ops/systemd/oper-photo-coverage.service`, `ops/systemd/oper-photo-coverage.timer`
- Modify: `docs/HANDOFF.md` §7

**Interfaces:**
- Consumes: `ops/monitoring/notify-telegram.sh` (`--key`, `--resolved`), as every other probe does.

- [ ] **Step 1: Write the probe.** It answers one question: *what share of active listings that could have a photo actually have one?*

```bash
#!/usr/bin/env bash
# Alert when active listings that HAVE images stop exposing one.
#
# This gap existed for months at 99.97% and nothing noticed, because no signal
# distinguished "no photo available" from "photo available but not readable".
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
MIN_PCT="${PHOTO_COVERAGE_MIN_PCT:-95}"

if [[ -f /etc/oper.env ]]; then set -a; . /etc/oper.env; set +a; fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[photo-coverage] no DATABASE_URL" >&2; exit 0; }

read -r pct fillable <<<"$(psql "$DB" -tA -F' ' -c "
  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE primary_photo IS NOT NULL)
                        / NULLIF(count(*), 0), 1), 0),
         count(*) FILTER (WHERE primary_photo IS NULL
                           AND images IS NOT NULL
                           AND jsonb_array_length(images) > 0)
    FROM listings
   WHERE listing_status = 'active' AND listing_type = 'for_sale'
     AND images IS NOT NULL AND jsonb_array_length(images) > 0;" 2>/dev/null)"

[[ -z "${pct:-}" ]] && { echo "[photo-coverage] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct < $MIN_PCT)}"; then
  "$NOTIFY" --key "photo-coverage" \
    "🔴 ${BOX}: photo-coverage — only ${pct}% of image-bearing active listings expose a photo (floor ${MIN_PCT}%); ${fillable} fillable rows waiting" || true
else
  if [[ -f "/var/lib/oper-alerts/photo-coverage" ]]; then
    "$NOTIFY" --resolved --key "photo-coverage" "✅ ${BOX}: photo-coverage — RESOLVED (${pct}%)" || true
  fi
fi
echo "[photo-coverage] ${pct}% of image-bearing active listings expose a photo; ${fillable} fillable"
```

Note the denominator: listings that *have* images. Measuring against all
listings would let genuinely imageless inventory mask a read-path regression.

- [ ] **Step 2: Confirm the query uses an index, not a full scan.** This probe runs on a timer against a 1.3M-row table, and an unbounded aggregate here is the exact mistake that cost 79% of database time:

```bash
psql "$DB" -c "EXPLAIN (ANALYZE, BUFFERS) <the SELECT above>"
```

If it sequential-scans, add a partial index on `(listing_status, listing_type)
WHERE images IS NOT NULL` and re-measure. Record both plans in the audit doc.

- [ ] **Step 3: Add the units** (30-minute cadence — coverage moves on the crawl cadence, not by the second), modelled on `ops/systemd/oper-db-load-budget.{service,timer}`, with the same `MemoryHigh=64M` / `MemoryMax=96M` caps.

- [ ] **Step 4: Prove it fires and resolves.** Temporarily set the floor above the real value, run it, confirm the Telegram message names the percentage and the fillable count and that `/var/lib/oper-alerts/photo-coverage` appears; restore the floor, run again, confirm RESOLVED and that the state file is gone.

```bash
PHOTO_COVERAGE_MIN_PCT=100 ./ops/monitoring/photo-coverage.sh
ls /var/lib/oper-alerts/ | grep photo
./ops/monitoring/photo-coverage.sh
ls /var/lib/oper-alerts/ | grep photo || echo "cleared"
```

- [ ] **Step 5: Deploy and prove it end to end on prod.** Re-run the exact viewport call from the top of this plan and confirm the photo count is no longer 0:

```bash
curl -s 'http://127.0.0.1:3001/api/properties/viewport?north=28.1&south=27.8&east=-82.3&west=-82.7&zoom=11&limit=5'
```

Expected: ~293 rows, nearly all with a non-null `primary_photo`. State the
actual ratio in the commit message.

- [ ] **Step 6: Update `docs/HANDOFF.md` §7** with the new probe row and one line on what to do when it fires. Commit — `feat(photos): coverage probe + handoff notes`

---

## Self-Review

**Spec coverage:** the gap is closed at all four levels it exists at — the empty
column (T2), the read paths that select it (T3), the ingest path that leaves it
empty (T4), and the absence of any signal that would have caught it (T5). T1
establishes the facts first, including the one assumption that would silently
corrupt 446k rows if wrong (the shape of `images`).

**Placeholder scan:** every step names files, exact SQL, exact commands and
expected output. The one deliberate blank — `PHOTO_EXPR_GOES_HERE` — is
explicitly produced by T1 Step 4 and flagged at both the definition and the use
site, because writing it before confirming the jsonb shape is how you fill half
a million rows with the string `null`.

**Type consistency:** `primary_photo` stays `string | null` everywhere; the
`COALESCE(primary_photo, images->>0) AS primary_photo` aliasing means no
response shape changes and no consumer needs updating. `PHOTO_EXPR` is the only
new shared name and it is a SQL fragment, not a runtime symbol.
