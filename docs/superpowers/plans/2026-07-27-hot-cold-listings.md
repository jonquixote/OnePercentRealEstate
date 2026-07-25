# Hot/Cold Listings — 59% of the Table Is Dead Weight in Every Scan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `listings` is 9.6 GB across 1.3 M rows, but only **492,459 rows are `active`** — **727,528 (59%) are `stale`**, plus 65,949 `sold` and 2,877 `rental_misfiled`. Every user-facing query filters those out, yet every sequential scan still reads them: the homepage aggregate, the market-page rollups, search, the materialized-view refreshes, and the rent estimator all pay a ~2.6× tax on rows no one asked for. That single fact is behind most of the slow paths we have been fixing one at a time. This plan separates hot from cold so the working set is what the product actually serves — making every existing query faster without changing one line of product code.

**Architecture:** Keep `listings` as the single writable table (no application rewrite, no dual-write) and let Postgres do the separation, choosing between two proven options in Task 1 on measured evidence:

- **(A) Partition by lifecycle** — `PARTITION BY LIST (listing_status)` with an `active`/`pending_verify` hot partition and a cold partition for `sold`/`stale`/`rental_misfiled`. Every existing query that filters `listing_status` gets partition pruning **for free**, indexes shrink to the hot set, and the crawler's status updates become partition moves.
- **(B) Partial indexes + aggressive archival** — keep one table, but move rows older than N days into `listings_archive` and make every hot index partial on the lifecycle predicate.

(A) is the stronger outcome; (B) is the lower-risk fallback if partitioning the 9.6 GB table in place proves too disruptive on this box. **Never delete listing data** — cold rows stay queryable, matching the existing "relabel, never delete" rule.

**Tech Stack:** Postgres 16 (declarative partitioning, `CREATE INDEX CONCURRENTLY`, `pg_stat_statements`), the crawler's upsert path, `apps/worker` lifecycle tick.

## Global Constraints

- **Zero data loss, zero deletion.** Sold/stale/misfiled rows remain queryable (deal history, sold comps, and the `/sold/[id]` pages all depend on them). This plan moves rows, never drops them.
- **No product-code rewrite.** Success means existing queries get faster untouched. Any query that must change is a finding to record, not a licence to refactor the app.
- **The crawler must keep writing at full speed.** The upsert path (`ON CONFLICT`) and the lifecycle tick that flips `active → stale` must work identically; a status flip that becomes a cross-partition move must be measured, since that is the one operation partitioning makes *more* expensive.
- **Online migration.** A 9.6 GB table cannot be rewritten with the app down. Use `CREATE INDEX CONCURRENTLY`, batched moves, and a staged cutover; every step must be interruptible and resumable.
- **Snapshot before any structural change** (`upctl storage backup create …`) and verify the restore path is understood — this is the highest-risk change in the codebase.
- **Prove with `EXPLAIN (ANALYZE, BUFFERS)`**, not intuition: the win is fewer buffers read, and it must show up on the real hot queries.
- **Tests:** existing suites must pass untouched (that is the point); plus SQL-level verification of row counts before/after each batch.

## Current State (measured 2026-07-26 on prod)

| Status | Rows | Share |
|---|---|---|
| `stale` | 727,528 | **59%** |
| `active` | 492,459 | 40% |
| `sold` | 65,949 | 5% |
| `pending_verify` | 25,125 | 2% |
| `rental_misfiled` | 2,877 | <1% |

- `listings`: **9,625 MB table + 1,286 MB indexes**.
- Representative cost of reading the whole thing: the hero aggregate scanned 511,578 rows in **7.3 s** (Parallel Seq Scan) before we precomputed it; the market rollup is ~21 s; MV refreshes are 26 s and 33 s.
- Existing partial indexes already prove the pattern works — `idx_listings_last_seen` is partial on `listing_type='for_sale' AND listing_status IN ('active','pending_verify')`, and matching it took a probe from **8,435 ms → 0.134 ms**.
- Lifecycle values and their meanings are established (`docs/HANDOFF.md` §6); readers already filter them consistently.
- A weekly index-usage window (`oper-pg-stat.timer`) is running — Task 1 uses it so index decisions rest on measurement, not a post-reboot snapshot.

## File Structure

| File | Responsibility |
|---|---|
| `docs/perf/2026-07-hot-cold-decision.md` (create) | Task 1's measured comparison of (A) vs (B) and the decision. |
| `infrastructure/migrations/out-of-band/2026_07_27_listings_partition_*.sql` (create) | Staged, resumable partitioning/archival steps (CONCURRENTLY; run by hand). |
| `apps/worker/src/lifecycle.ts` (verify/modify) | Status flips still correct when they become partition moves. |
| `ops/monitoring/db-load-budget.sh` (unchanged) | The guard that tells us whether the change actually helped. |
| `documentation/operations/db-performance.md` (modify) | Before/after buffers + timings on the hot queries. |

---

## Task 1: Decide (A) or (B) on evidence

- [ ] **Step 1:** Measure the true cost of the cold rows: `EXPLAIN (ANALYZE, BUFFERS)` the five hottest full-table queries (hero aggregate, market rollup, both MV refreshes, the rent-estimator backlog scan) and record buffers read and rows discarded by the lifecycle filter.
- [ ] **Step 2:** Inventory every query that would need a partition key present. Any query filtering `listing_status` prunes automatically; list the ones that do **not** filter it (these read all partitions and must be justified or fixed).
- [ ] **Step 3:** Verify the constraint that decides it: a `PARTITION BY LIST (listing_status)` table requires `listing_status` in the **primary key / unique constraints**. Check `listings`' PK and every unique index (notably `listings_addr_type_saletype_uniq`) and record whether that is acceptable — if a unique constraint cannot include the partition key, (A) is off the table and (B) wins.
- [ ] **Step 4:** Write the decision doc with the measurements and pick. Commit — `docs(perf): hot/cold decision for listings, measured`

## Task 2: Snapshot + rehearsal

- [ ] **Step 1:** `upctl storage backup create <boot-disk> --title "oper-pre-hotcold-<date>"` and record the UUID in the migration header.
- [ ] **Step 2:** Rehearse the chosen path on a **copy** (`CREATE TABLE listings_rehearsal (LIKE listings INCLUDING ALL)` + a representative sample, or a restored snapshot on a temporary box if quota allows). Record wall-clock for each step at full scale.
- [ ] **Step 3:** Write the rollback for each step explicitly (how to get back to one plain table). Commit — `docs(ops): hot/cold rehearsal results + rollback`

## Task 3: Execute the split (staged, resumable)

- [ ] **Step 1:** Create the target structure (partitions or `listings_archive`) with matching indexes built `CONCURRENTLY`.
- [ ] **Step 2:** Move cold rows in **bounded batches** (e.g. 25k) with progress logging, so the migration can be paused and resumed and never holds a long lock. Verify row counts per status match the pre-move census after every batch.
- [ ] **Step 3:** Cut over reads (for (A) this is automatic; for (B) point historical readers — `/sold/[id]`, sold comps — at the archive). Verify `/sold/[id]` and sold-comps still work in a browser, not just in SQL.
- [ ] **Step 4:** Commit — `perf(db): split hot/cold listings (59% of rows left the hot path)`

## Task 4: Verify the crawler and lifecycle still behave

- [ ] **Step 1:** Confirm the scraper upsert still inserts/updates at the same rate — compare crawl-job completion counts and `listings seen` over a 15-minute window against the pre-change baseline.
- [ ] **Step 2:** Force a lifecycle transition (`active → stale`) and verify the row moves correctly, the count census stays consistent, and the worker logs no errors. Measure the cost of the flip — this is the operation the split makes more expensive.
- [ ] **Step 3:** Confirm the productivity SLOs (`crawl-freshness`, `crawl-throughput`) still evaluate correctly against the new structure. Commit — `test(db): crawler + lifecycle verified against the hot/cold split`

## Task 5: Prove the win

- [ ] **Step 1:** Re-run the Task 1 `EXPLAIN (ANALYZE, BUFFERS)` set. Record **buffers read** and **execution time** before/after for each of the five hot queries; the target is a reduction roughly proportional to the 59% of rows removed from the hot path.
- [ ] **Step 2:** Re-time the surfaces users feel: the stats refresh pass, the market refresh pass, and both MV refreshes.
- [ ] **Step 3:** Confirm `pg_size_pretty(pg_table_size(...))` and index sizes on the hot set, and that `db-load-budget.sh` reports a smaller top consumer.
- [ ] **Step 4:** Update `db-performance.md` and `docs/HANDOFF.md` with the measured outcome. Commit — `docs(db): hot/cold before/after — buffers, timings, sizes`

## Self-Review

**Spec coverage:** the 59%-dead-weight fact is measured, not assumed (T1) · the highest-risk change in the codebase is snapshotted and rehearsed before it touches prod (T2) · the move is staged, resumable, and lock-light (T3) · the two things most likely to break — the crawler's write path and lifecycle transitions — are explicitly verified, including the operation partitioning makes *worse* (T4) · the win is proven in buffers and seconds on the same queries measured at the start (T5). Covered.

**Placeholder scan:** the one genuine open question (partition-by-list vs archival) is a *task with a decision criterion* — the unique-constraint check in T1 Step 3 can settle it definitively — rather than hand-waving. Batch sizes, targets, and the exact queries to measure are named.

**Type consistency:** no application types change — that is the success criterion. The only new schema objects are partitions or `listings_archive`, both mirroring `listings` exactly (`INCLUDING ALL`), so every existing query and type keeps working untouched.
