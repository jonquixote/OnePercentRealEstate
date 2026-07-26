# Apollo II Task 2 — Containment, and a silent misresolution trap

**Date:** 2026-07-26 · **Plan:** `2026-08-09-apollo-ii-ceiling-and-fidelity.md` Task 2

Apollo I found one listing missing from one county — on a single sample. This
task turned that into a rate, and found something considerably worse.

## The sample

Five counties spanning our own size range. For each: the county query's set
against one constituent ZIP's set.

| county | county rows | ZIP rows | in both | **missed** | status of missed |
|---|---|---|---|---|---|
| Brazoria County, TX | 4,416 | 623 | 612 | **6** | FOR_SALE, PENDING |
| **East Baton Rouge Parish, LA** | 273 | 408 | **0** | **406** | FOR_SALE, PENDING |
| Chemung County, NY | 551 | 109 | 108 | 0 | — |
| Jackson County, WV | 121 | 34 | 32 | 0 | — |
| Franklin County, MA | 320 | 46 | 46 | 0 | — |

Two distinct failure modes, and they need different responses.

## Failure mode 1 — marginal, quiet misses

Brazoria missed 6 of 623 (~1%). Jackson missed 2 (34 vs 32 in both). Apollo I's
Cuyahoga missed 1 of 245 (0.4%). The misses are `FOR_SALE` and `PENDING` — live
inventory, not edge-case statuses.

**Roughly a 1% silent loss** is the baseline cost of trusting a county query.
Small, but non-zero and unbounded in principle, which is why the ZIP backstop
exists.

## Failure mode 2 — total, silent misresolution

East Baton Rouge returned **273 rows with ZERO overlap** with its own ZIP 70791's
408 listings. Not a truncation. Not a marginal miss. A completely different
result set, returned confidently.

The cause:

| query | rows | ZIPs | contains 70791? | cities returned |
|---|---|---|---|---|
| `East Baton Rouge Parish, LA` | 273 | 8 | **No** | Baton Rouge |
| `East Baton Rouge County, LA` | **3,329** | **26** | **Yes** | Baker, Baton Rouge, Central |
| `East Baton Rouge, LA` | 295 | 5 | No | Baton Rouge |
| `Zachary, LA` (city in that parish) | 408 | 3 | Yes | — |
| `70791` | 408 | 1 | Yes | — |

**Louisiana has parishes, not counties — and the API only resolves the
geographically incorrect "County" form.** Asking for the correct "Parish"
returns a plausible 273 rows covering 8 ZIPs instead of the true 3,329 across
26. It does not error. It does not return empty. It returns **8% of the
county, silently**.

The same class of trap exists wherever the naming convention diverges from
"X County, ST": Louisiana's 64 parishes, Alaska's boroughs and census areas,
and Virginia's independent cities.

## Consequences for `2026-08-07-incremental-crawl.md`

That plan's Tasks 2 and 4 are built on county-scoped queries. This does not sink
them, but it adds a hard prerequisite:

1. **The county list must be validated, not generated.** Building it by
   formatting `county || ' County, ' || state` from our own data would silently
   under-crawl every Louisiana parish and Alaskan borough — and the symptom
   would be "those areas just have less inventory", which is indistinguishable
   from the truth without this test.

2. **Every county must be containment-verified once before it is trusted**:
   query the county, query its densest known ZIP, and confirm the ZIP's
   listings appear. A county failing that check is misresolving and must fall
   back to ZIP-shaped crawling.

3. **The ~1% marginal miss rate stands**, so the ZIP backstop remains
   load-bearing even for counties that resolve correctly.

## Recommendation

Add a validation task to the incremental-crawl plan ahead of its Task 2: build
and containment-verify the county list, record which counties resolve and which
do not, and make the crawl fall back to ZIPs for the failures. Roughly 1 in 5 of
our sample misresolved — the check is not optional.
