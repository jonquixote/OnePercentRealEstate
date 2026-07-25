# Photo Coverage — Audit

**Date:** 2026-07-25 · **Plan:** `docs/superpowers/plans/2026-07-29-every-listing-has-a-photo.md` Task 1

## The gap, measured

Prod (`209.50.61.64`, database `postgres`), active for-sale listings:

| Metric | Count | Share |
|---|---|---|
| Active for-sale listings | 449,654 | — |
| …with a non-empty `images` jsonb | 446,437 | **99.3%** |
| …with the native `primary_photo` column set | **140** | **0.03%** |
| …genuinely imageless | 3,215 | 0.7% |

### Correction to this audit's original evidence

The first version of this document led with:

```
GET /api/properties/viewport?…&zoom=11
  rows: 293
  with primary_photo: 0 / 293
```

**That measurement was wrong**, and it is worth recording why rather than
quietly deleting it. At `zoom < 14` the viewport route deliberately serves
*clusters* from `mv_cluster_tiles`, not individual listings — those 293 "rows"
were cluster aggregates, which have no photo by design. The probe was measuring
the wrong thing and happened to produce a number that confirmed the hypothesis.

Re-measured at listing-level zoom after the fix:

```
GET /api/properties/viewport?north=27.99&south=27.94&east=-82.44&west=-82.50&zoom=15
  103 / 103 rows have a photo
```

The underlying defect was still real, and the column evidence below is what
actually establishes it: `primary_photo` was set on 140 of 449,654 active
listings, so before the fix a zoom-15 request would have returned essentially
no photos. But the headline number in the first draft did not show that.

Not a data acquisition problem — a read-path problem plus a backfill that
never ran.

## `PHOTO_EXPR` — confirmed, not assumed

The one assumption that would corrupt 446k rows if wrong:

```
 images_type |  count
-------------+---------
 array       | 1329529

 elem0_type |  count
------------+---------
 string     | 1321571
```

`images` is a JSON **array of plain URL strings**. Element 0 is the URL itself,
not an object needing a key lookup. Sample:

```
https://ap.rdcpix.com/6a8811530418e526fd591437dbc571bcl-m2431837128od-w480_h360_x2.webp?w=…
```

**`PHOTO_EXPR = images->>0`** — safe. (7,958 rows hold an empty array; the
backfill's `jsonb_array_length(images) > 0` guard excludes them.)

## The backfill is also a performance win

`images` is TOASTed, so every extraction decompresses the whole document:

| Read | Time | Buffers |
|---|---|---|
| `images->>0` | **1.939 ms** | 94 (12 from disk) |
| `primary_photo` | **0.119 ms** | 58 (0 from disk) |

**16× faster, zero disk reads.** Same pattern already proven on this database
with `raw_data->>'city'` (1.074 ms → 0.061 ms).

This is why the fix is "backfill the column *and* keep a COALESCE fallback",
not "just COALESCE everywhere": the fallback is the safety net for rows the
crawler inserts between backfill runs, but the native column is the fast path
that should serve ~100% of reads.

## Read paths

**Broken — select the bare (empty) column:**

| File | Line | User-facing |
|---|---|---|
| `apps/one/src/app/api/properties/viewport/route.ts` | 192 | yes — search/map cards |
| `apps/one/src/app/api/properties/route.ts` | 72 | yes |
| `apps/one/src/app/api/v1/listings/route.ts` | 158 | yes — public API |
| `apps/one/src/app/api/alerts/route.ts` | 30 | yes — alert emails |
| `apps/one/src/app/api/featured/route.ts` | 58 | yes — homepage |
| `apps/one/src/app/market/[zip]/page.tsx` | 219 | yes — market pages |
| `apps/one/src/lib/queries/property.ts` | 19 | yes — property page |

**Already correct — coalesce to the jsonb:**

| File | Line |
|---|---|
| `apps/one/src/app/api/properties/query/route.ts` | 167 |
| `apps/one/src/app/api/saved-properties/route.ts` | 24, 32 |
| `apps/one/src/lib/spotlight.ts` | 40, 49 |

## The part worth remembering

`query/route.ts:152` carries this comment:

> `primary_photo is ~0.3% populated; photos live in the images jsonb`

Someone diagnosed this correctly, fixed their own query, wrote the reason
down — and it stopped there. Three files got the workaround; seven did not, and
the empty column was never filled. The knowledge existed in the repo the whole
time while the homepage, the map, the market pages, the public API and the
alert emails all rendered imageless.

That is the argument for Task 5's probe: a correct diagnosis in a code comment
is not a fix, and nothing measured whether the product actually showed a photo.
