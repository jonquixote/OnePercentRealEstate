# Cold Listings Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop making every scan of `listings` read the 58.5% of rows nobody queries, without breaking the URLs, comps, and crawler upserts that legitimately depend on cold data.

**Architecture:** The riskiest change in this codebase, executed in the order that makes it safe: prove the read-through fallback works *before* moving a single row, move rows in bounded batches with the fallback already live, and keep the crawler's idempotent upsert correct throughout. This plan finally executes the piece that `docs/perf/2026-07-hot-cold-decision.md` specced and deliberately gated.

**Tech Stack:** PostgreSQL 16 + PostGIS, `apps/one` (Next 16), `services/scraper_service`, `apps/worker`, bash ops scripts.

## The measured problem

Prod, 2026-07-26:

| Lifecycle | Rows | Share |
|---|---|---|
| `stale` | **772,904** | **58.5%** |
| `active` | 446,270 | 33.8% |
| `sold` | 77,198 | 5.8% |
| `pending_verify` | 41,237 | 3.1% |
| `rental_misfiled` | 2,877 | 0.2% |

`listings`: **4,418 MB heap + 1,428 MB indexes = 11 GB total** (the balance is
TOAST — `raw_data` and `images`).

Every user-facing query filters the cold statuses out. Every sequential scan
still reads them. Every index still carries them. The background passes that now
run on timers — stats refresh, the two MV refreshes, the counter table — all
walk rows that no product surface will ever show.

## Why now, and what has changed since the decision was deferred

`docs/perf/2026-07-hot-cold-decision.md` ruled out LIST partitioning (it would
have required weakening `listings_addr_type_saletype_uniq`, the conflict target
the crawler's upsert depends on — a correctness loss no performance gain
justifies) and chose partial indexes plus archival, with archival **gated**
because:

> `/property/[id]` must still render a stale listing (old links, shared URLs,
> search-engine traffic). Moving rows without a read-through fallback turns
> every stale listing's page into a 404 — a large SEO regression on a site that
> just published a 33k-URL sitemap.

Two things have changed:

1. **Disk headroom exists.** The box was at 86% (21 GB free) on 2026-07-25;
   reclaiming dead Docker build cache took it to 71% (**42 GB free**). A
   rehearsal that temporarily doubles the table is now affordable — it was not
   before.
2. **The lifecycle is trustworthy.** Recent work made statuses mean what they
   say (`done` implies an estimate; non-rentable rows are `not_applicable`), so
   partitioning behaviour on `listing_status` no longer inherits a lie.

The gating conditions in that document were "background passes become a load
problem again, or table growth pushes the box toward its limits." **Growth is
the trigger**: the crawl adds ~25,000 listings a day, and the stale share only
climbs.

## Global Constraints

- **Relabel and move, never delete.** No row leaves the database. Archival means a different table, not disposal.
- **`/property/[id]` must render an archived listing.** This is the plan's hard requirement, not a nice-to-have. Old links, shared URLs and search traffic depend on it, and the sitemap publishes 33k of them.
- **The crawler's upsert must resurrect an archived listing that returns to market**, or `ON CONFLICT (address, listing_type, sale_type)` will violate on re-insert. This is the single most likely way to corrupt data here.
- **Never weaken `listings_addr_type_saletype_uniq`.** It enforces one row per (address, listing_type, sale_type) and is the crawler's conflict target. Ruled out once already; still ruled out.
- **Rehearse on a restored snapshot before touching prod.** UpCloud Simple Backup (`0430,dailies`) is the restore source.
- **Bounded batches, paced, resumable** — the same discipline as the photo and rent-band backfills, watching `db-load-budget.sh` and `crawl-health.sh` throughout.
- **No step is irreversible without a tested reverse.** Every move needs a demonstrated way back.

---

## Task 1: Prove the read-through fallback with zero rows moved

**Files:**
- Create: `infrastructure/migrations/2026_08_03_listings_archive.sql`
- Modify: `apps/one/src/lib/queries/property.ts`
- Create: `apps/one/src/lib/queries/property.test.ts`

**Interfaces:**
- Produces: an empty `listings_archive` with `listings`' exact shape, and a property loader that reads through to it.

- [ ] **Step 1: Create the archive table as a structural clone**, so a row can move without transformation:

```sql
-- Structural clone, including defaults. No constraints that would fight a
-- moved row: the archive is a destination, not a second source of truth.
CREATE TABLE IF NOT EXISTS listings_archive (LIKE listings INCLUDING DEFAULTS INCLUDING STORAGE);

-- Only two access patterns: fetch one by id (the property page) and find one
-- by the crawler's conflict key (resurrection).
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_archive_pkey ON listings_archive (id);
CREATE INDEX IF NOT EXISTS idx_listings_archive_conflict
  ON listings_archive (address, listing_type, sale_type);
```

Note what is deliberately **absent**: the geometry index, the lifecycle partial
indexes, the rent-status indexes. Archived rows are not searched, mapped, or
ranked. Adding those indexes would rebuild the cost the archival exists to
remove.

- [ ] **Step 2: Write the failing test for the loader**, covering the three cases that decide whether this plan is safe:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...(a as [])) } }));

beforeEach(() => { query.mockReset(); });

describe('property loader read-through', () => {
  it('returns a live listing without touching the archive', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '1', address: 'live' }] });
    const { getProperty } = await import('./property');
    expect((await getProperty('1'))?.address).toBe('live');
    expect(query).toHaveBeenCalledTimes(1); // no second query
  });

  it('falls through to the archive when the live table misses', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: '2', address: 'archived' }] });
    const { getProperty } = await import('./property');
    expect((await getProperty('2'))?.address).toBe('archived');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns null only when BOTH miss — never a false 404', async () => {
    query.mockResolvedValue({ rows: [] });
    const { getProperty } = await import('./property');
    expect(await getProperty('3')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not let an archive failure hide a live row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '4', address: 'live' }] });
    query.mockRejectedValueOnce(new Error('archive down'));
    const { getProperty } = await import('./property');
    expect((await getProperty('4'))?.address).toBe('live');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**, then implement the fallback in the loader. Live table first, archive only on miss — so the common path costs exactly what it costs today.

- [ ] **Step 4: Deploy with the archive still EMPTY and verify nothing changed.** This is the point of doing it first: the fallback is exercised in production against zero rows, where being wrong is free.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/property/877
curl -H "Authorization: Bearer $ADMIN_API_KEY" localhost:3001/api/admin/perf
```

Expected: `200`, and `property.id` p95 unchanged against its 1,000 ms budget.

- [ ] **Step 5: Commit** — `feat(listings): archive table + read-through property loader (no rows moved)`

---

## Task 2: Make the crawler resurrect an archived listing

**Files:**
- Modify: `services/scraper_service/main.py` (the upsert around line 437)
- Test: alongside the existing scraper tests

**Interfaces:**
- Consumes: `listings_archive` and its conflict-key index from Task 1.

- [ ] **Step 1: Establish what breaks today.** With a row in the archive and none in `listings`, the crawler's `ON CONFLICT (address, listing_type, sale_type)` sees no conflict and inserts a *second* row. When that row is later archived, `idx_listings_archive_conflict` has duplicates — the constraint the decision record refused to weaken, defeated by the back door.

  Write a test that demonstrates exactly this before fixing it.

- [ ] **Step 2: Implement resurrection.** Before the upsert, move any archived row matching the conflict key back into `listings`, inside the same transaction:

```sql
WITH resurrected AS (
  DELETE FROM listings_archive
   WHERE address = %s AND listing_type = %s AND sale_type = %s
  RETURNING *
)
INSERT INTO listings SELECT * FROM resurrected
ON CONFLICT (address, listing_type, sale_type) DO NOTHING;
```

`DELETE … RETURNING` then `INSERT` is atomic within the transaction, so a row is
never in both tables and never in neither.

- [ ] **Step 3: Prove the round trip on the rehearsal database** (Task 3): archive a listing, re-crawl it, confirm exactly one row exists in `listings`, zero in the archive, and that its `id` is unchanged — a changed id breaks every saved property, alert, and shared URL.

- [ ] **Step 4: Commit** — `fix(crawl): resurrect archived listings instead of inserting duplicates`

---

## Task 3: Rehearse on a restored snapshot

**Files:**
- Create: `ops/db/archive-cold-listings.sh`
- Create: `docs/perf/2026-08-archival-rehearsal.md`

- [ ] **Step 1: Restore the most recent UpCloud Simple Backup to a scratch server** and confirm it is a real copy — row counts for each lifecycle state matching prod within a day's drift. **Do not skip this.** Every subsequent step is destructive by design.

- [ ] **Step 2: Write the archival script**, following `ops/db/backfill-primary-photo.sh` — bounded batches, pacing, resumable, progress that does not cost more than the work:

```sql
WITH batch AS (
  SELECT id FROM listings
   WHERE listing_status = 'stale'
     AND last_seen_at < now() - interval '90 days'
   ORDER BY id LIMIT ${BATCH}
), moved AS (
  DELETE FROM listings WHERE id IN (SELECT id FROM batch) RETURNING *
)
INSERT INTO listings_archive SELECT * FROM moved;
```

The `last_seen_at` floor is deliberate: `stale` alone is not sufficient
justification to move a row that the crawler might re-confirm next week.

- [ ] **Step 3: Run the full archival on the rehearsal box** and record: rows moved, wall-clock time, table size before and after, and index sizes before and after.

- [ ] **Step 4: Verify the product against the rehearsal database.** The checks that matter:
  - `/property/[id]` renders for an archived listing (pick 10 ids at random from the archive)
  - sold comps still resolve
  - the sitemap still generates without error
  - search, map viewport, and market pages return the same counts as before

- [ ] **Step 5: Test the way back.** Write and run the reverse migration that moves everything from `listings_archive` back into `listings`, and confirm the row counts and a sample of ids match the pre-archival state exactly. **A move you cannot reverse is not a move, it is a deletion with extra steps.**

- [ ] **Step 6: Write the rehearsal record** with all measurements and a go/no-go recommendation. Commit — `docs(listings): archival rehearsal on a restored snapshot`

---

## Task 4: Execute on prod, gated on Task 3

**Files:**
- Modify: `docs/HANDOFF.md` §4 and §6

- [ ] **Step 1: Take a fresh backup immediately before starting**, and verify it exists rather than assuming:

```bash
upctl storage backup create <boot-disk-uuid> --title "oper-pre-archival-$(date +%F)"
```

- [ ] **Step 2: Run the archival in batches**, watching between each: `db-load-budget.sh`, `crawl-health.sh`, and `/api/admin/perf`. Stop at the first sign of degradation — the job is resumable by design.

- [ ] **Step 3: Verify the product on prod** with the same checklist as Task 3 Step 4, plus a real archived-listing URL fetched over HTTPS from outside the box.

- [ ] **Step 4: Measure and record the win** — table size, index size, and the runtime of the background passes (stats refresh, MV refreshes) before and after. If the win is smaller than the rehearsal predicted, say so.

- [ ] **Step 5: `VACUUM (ANALYZE)` the table** and re-measure. A `DELETE` of 700k rows leaves dead tuples; the space is not returned until vacuum, and the numbers before it are not the real numbers.

- [ ] **Step 6: Update `docs/HANDOFF.md`** — the archive table, the read-through, the resurrection path, and the one thing a future engineer must not do (query `listings` directly for a property page). Commit — `feat(listings): archive cold inventory` with the measured before/after.

---

## Self-Review

**Spec coverage:** every gating condition from `2026-07-hot-cold-decision.md` is
discharged before rows move — the read-through fallback ships and is verified in
production against an empty archive (T1), the crawler's resurrection path is
built and round-trip tested (T2), and the whole thing is rehearsed on a restored
snapshot with a tested reverse (T3) before prod sees it (T4). Partitioning
remains ruled out for the reason already recorded.

**Placeholder scan:** every step names files, exact SQL, and what to verify.
The one number left open — the `last_seen_at` interval for what counts as
archivable — is set to 90 days here and justified inline; the rehearsal will
show whether that is right, and it is trivially tunable.

**Type consistency:** no new runtime contracts. `listings_archive` is a
structural clone (`LIKE listings INCLUDING DEFAULTS INCLUDING STORAGE`), so any
row moves between the tables without transformation and `getProperty` returns
the same shape from either source — which is precisely what makes the
read-through invisible to every caller.
