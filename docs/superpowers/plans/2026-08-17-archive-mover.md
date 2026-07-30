# Archive Mover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actually move cold rows into `listings_archive`. The table, its indexes and the read-through shipped on 2026-08-03 and **zero rows have ever moved**, because the code that moves them was never written.

**Architecture:** A batched, idempotent, resumable mover — a single SQL statement per batch (`DELETE … RETURNING` → `INSERT`) run in a loop by an ops script, mirroring the proven `_resurrect_sql` pattern in reverse. Rehearsed on a restored snapshot before it touches prod, exactly as the archive migration requires.

**Tech Stack:** PostgreSQL 16, bash ops scripts, `apps/one` read-through (already shipped).

## Why now, and what the numbers are

Measured on prod 2026-07-30:

| fact | value |
|---|---|
| `listings` total size | **11 GB** |
| rows, all statuses | 1,433,510 |
| **`stale` rows** | **724,288 (51%)** |
| `listings_archive` rows | **0** |
| disk | **83% used, 26 GB free** |
| rows whose `last_seen_at` is the July backfill seed | **647,646** |

Every user-facing query filters `stale` out; every sequential scan still reads it.

### The `last_seen_at` seed, and why it is safe to key on

608,253 rows share the identical `last_seen_at` of `2026-07-07 06:00`. This is **not**
clobbered crawler data. `last_seen_at` did not exist until
`2026_07_18_listing_lifecycle.sql` added it and backfilled
`last_seen_at = updated_at`; a bulk backfill (`2026_07_06_rent_zero_to_null.sql`
and friends) had mass-updated those rows on 6–8 July, so they inherited that
timestamp.

**Why keying archival on it is still sound:** the crawler's upsert advances
`last_seen_at` on every confirmation. A row still showing the July seed has
therefore **not been confirmed since at least 18 July**. The true last-seen may be
older, never newer — so the signal errs toward "staler than we think", which is
the safe direction for a reversible move.

Those 647,646 rows cross a 30-day threshold on **2026-08-05**.

## Global Constraints

- **Relabel/relocate, never delete.** A moved row stays fully readable via the read-through. Nothing in this plan destroys data.
- **`SELECT *` between these tables is a known outage.** `listings.rent_price_ratio` is `GENERATED ALWAYS`; `listings_archive` (built with `LIKE … INCLUDING DEFAULTS`, which does not copy generated-ness) holds it as a plain column. Inserting it raises `cannot insert a non-DEFAULT value into column rent_price_ratio` — this took the crawl down for **80 minutes** on 2026-07-26. Enumerate columns from `information_schema` with `is_generated = 'NEVER'`, exactly as `_resurrect_sql` does.
- **Rows move only after a rehearsal on a restored snapshot** — the archive migration's own stated gate. `ops/systemd/verify-backup.sh` already restores the latest dump into a scratch DB; reuse that mechanism.
- **Batched and bounded.** One unbounded `DELETE … RETURNING` over ~648k rows on an 11 GB table would hold locks and bloat WAL. Cap each batch and commit per batch so the job is interruptible and resumable.
- **Never archive a row the crawler may resurrect mid-flight.** The scraper's resurrection path reads `listings_archive` by `(address, listing_type)`; the mover must not race it into a duplicate. Rely on the existing unique constraint and `ON CONFLICT DO NOTHING`.
- **The crawl shares Postgres with both apps.** Watch `db-load-budget.sh` while the mover runs; `docs/perf/perf-budgets.md` binds.
- **Do not archive `active`, `pending_verify` or `sold`.** Only `stale`, and only past the age threshold. `sold` rows back the comps engine.

---

## Task 1: The mover

**Files:**
- Create: `ops/db/archive-cold-listings.sh`
- Create: `ops/db/archive-cold-listings.test.sh` (bats-style assertions on the generated SQL)

**Interfaces:**
- Produces: a resumable mover invoked as `archive-cold-listings.sh [--days N] [--batch N] [--max-batches N] [--dry-run]`.

- [ ] **Step 1: Enumerate columns from the live schema**, never by hand:

```sql
SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'listings'
   AND is_generated = 'NEVER';
```

- [ ] **Step 2: One batch is one statement**, so a crash cannot half-move a row:

```sql
WITH doomed AS (
  SELECT id FROM listings
   WHERE listing_status = 'stale'
     AND last_seen_at < now() - ($1 || ' days')::interval
   ORDER BY last_seen_at
   LIMIT $2
   FOR UPDATE SKIP LOCKED
), moved AS (
  DELETE FROM listings l USING doomed d WHERE l.id = d.id
  RETURNING <cols>
)
INSERT INTO listings_archive (<cols>) SELECT <cols> FROM moved
ON CONFLICT (id) DO NOTHING;
```

`FOR UPDATE SKIP LOCKED` keeps the mover off rows the crawler is upserting.
`ORDER BY last_seen_at` moves the coldest first, so an interrupted run still
did the most valuable work.

- [ ] **Step 3: `--dry-run` must print the count it WOULD move and exit non-destructively.** Run it first; record the number.

- [ ] **Step 4: Loop with a cap**, logging per batch: rows moved, elapsed, cumulative. Stop on the first batch that moves 0 rows, or at `--max-batches`.

- [ ] **Step 5: Verify the read-through still serves a moved row.** Take an id from a moved batch and fetch its page — it must render 200, not 404. This is the single most important correctness check in the plan; the property page test already pins the code path, but this proves it against real moved data.

- [ ] **Step 6: Commit** — `feat(db): batched cold-listing archive mover`

---

## Task 2: Rehearse on a restored snapshot

**Files:**
- Create: `ops/db/rehearse-archive-move.sh`

- [ ] **Step 1: Restore the latest dump into a scratch DB**, reusing `verify-backup.sh`'s mechanism (`createdb` + `pg_restore -Fc … --no-owner --no-privileges`).

- [ ] **Step 2: Run the mover against the scratch DB** with the real threshold and batch size.

- [ ] **Step 3: Assert the invariants on the scratch DB:**

```sql
-- no row lost
SELECT (SELECT count(*) FROM listings) + (SELECT count(*) FROM listings_archive) AS total;
-- nothing hot moved
SELECT count(*) FROM listings_archive WHERE listing_status <> 'stale';
-- no id in both tables
SELECT count(*) FROM listings l JOIN listings_archive a USING (id);
```

Expected: total equals the pre-move total, and **both other counts are 0**.

- [ ] **Step 4: Record the reclaimed size**, before and after, remembering that
`DELETE` alone does not shrink a heap — report `pg_total_relation_size` plus
whether a `VACUUM` was needed to make the space reusable.

- [ ] **Step 5: Drop the scratch DB.** Commit — `feat(db): archive move rehearsal on a restored snapshot`

---

## Task 3: Run it on prod, in daylight

- [ ] **Step 1: Snapshot the before-state** — row counts by status, `pg_total_relation_size` for both tables, disk free.

- [ ] **Step 2: Run one batch only.** Verify the invariants from Task 2 Step 3 against prod, and fetch a moved listing's page (Task 1 Step 5).

- [ ] **Step 3: Then run to completion with `--max-batches`**, watching `db-load-budget.sh` and the crawl between batches. Abort if either degrades.

- [ ] **Step 4: `VACUUM (ANALYZE) listings`** so the freed space is reusable and the planner's stats match the smaller table. **Not `VACUUM FULL`** — it takes an ACCESS EXCLUSIVE lock and rewrites 11 GB, which would stop the crawl and both apps.

- [ ] **Step 5: Record the outcome** in `docs/perf/2026-08-archive-move-results.md`: rows moved, size before/after, disk before/after, and query latency for the property page and search. Commit.

---

## Task 4: Keep it running, and prove it stays honest

**Files:**
- Create: `ops/systemd/oper-archive-cold.{service,timer}`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Schedule the mover weekly**, off-peak, with a conservative
      `--max-batches` so a single run can never move an unbounded amount.

- [ ] **Step 2: Add the split to an existing probe** rather than writing a new
      one: report `listings` vs `listings_archive` counts so a mover that has
      silently stopped is visible. A new timer for a number that moves weekly is
      not worth its own alert.

- [ ] **Step 3: Prove a moved listing still renders** as part of the probe —
      sample one archived id and assert its page returns 200. That is the
      failure that would actually hurt users.

- [ ] **Step 4: Update `docs/HANDOFF.md` §7** and commit —
      `feat(db): weekly cold-listing archival + read-through assertion`

---

## Self-Review

**Spec coverage:** the gap is that no code moves rows (T1), the migration's own
precondition of a snapshot rehearsal (T2), the prod execution with the
`VACUUM`-not-`VACUUM FULL` distinction that keeps the site up (T3), and
recurrence plus a read-through assertion so archival cannot silently break the
property page (T4).

**Placeholder scan:** every task names files, exact SQL and what to record. The
column list is deliberately derived at runtime from `information_schema` rather
than written out — writing it by hand is precisely what caused the 80-minute
outage.

**Type consistency:** no new runtime contracts. The read-through
(`loadPropertyRow`) and the resurrection path already exist and are unchanged;
this plan only supplies the rows they were built to handle.
