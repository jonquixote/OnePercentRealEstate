# Compression Audit — the answer is "don't"

**Date:** 2026-07-26 · **Plan:** `2026-08-08-the-stash.md` Task 1
**Verdict: skip Task 1. Switching TOAST compression is not worth doing here.**

## What was proposed

Task 1 assumed a win: `raw_data` uses LZ4 while `images`, `description`,
`nearby_schools`, `agent_info` and `tax_history` still use the pglz default, and
TOAST (5,473 MB) is larger than the heap (4,418 MB). Switch the rest to LZ4.

## What the measurements say

Stored size per column, sampled and scaled to the whole table:

| column | stored | compression | achieved ratio |
|---|---|---|---|
| **`raw_data`** | **3,592 MB** | LZ4 | 2.27× |
| `description` | 1,298 MB | pglz | **1.04×** |
| `images` | 693 MB | pglz | **6.19×** |
| `agent_info` | 90 MB | pglz | — |
| `nearby_schools` | ~0 | — | (null) |
| `tax_history` | ~0 | — | (null) |

Three facts kill the proposal:

**1. `images` already compresses 6.19× under pglz.** Image URLs are highly
repetitive, which pglz exploits well. LZ4 trades ratio for decompression speed —
switching would very likely make this column *bigger*. It is read on every card,
so the speed argument has some merit, but the native `primary_photo` column
(backfilled 2026-07-26) already serves that path at 0.119 ms against the jsonb's
1.939 ms. The read-path problem is solved; re-solving it by growing the table is
a poor trade.

**2. `description` compresses 1.04× — the algorithm is not engaging at all.**
13 MB stored against 14 MB raw across 13,464 sampled rows. Descriptions average
about 1 KB, which is under the threshold at which Postgres bothers to compress
or externalise a value, so it is stored essentially verbatim inline. **Changing
the algorithm cannot help a value the algorithm never touches.** Reaching this
1,298 MB would mean tuning `toast_tuple_target`, which changes storage behaviour
for every column on the table — far more risk than the prize justifies.

**3. The bulk is already LZ4.** `raw_data` is 3,592 MB, 66% of all TOAST, and it
was switched to LZ4 in earlier work. There is nothing left to switch.

## What the audit did surface

`raw_data` averages **6,308 bytes per row** and **every sampled row carries an
`alt_photos` key** — the same photo URLs that also populate the `images` column
(693 MB) and, since 2026-07-26, the native `primary_photo` column.

So the photo URLs are stored up to three times. Pruning `alt_photos` and
`primary_photo` from `raw_data` would be a real reduction against the largest
column on the table — but it is a mutation of 1.34 M rows and it destroys the
raw payload's fidelity as a scrape record. **Worth a plan of its own, with a
rehearsal; not worth doing as a side effect of a compression task.**

## Recommendation

- **Skip `2026-08-08-the-stash.md` Task 1 entirely.** Record it as measured and
  declined, not deferred.
- Spend the effort on Task 2 onward — moving cold rows out is the real lever, and
  it reduces every column at once rather than arguing with one of them.
- Log the triple-stored photo URLs as a candidate for a future plan.
