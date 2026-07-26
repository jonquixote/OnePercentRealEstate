# Apollo II Task 3 — The Ceiling

**Date:** 2026-07-26 · **Plan:** `2026-08-09-apollo-ii-ceiling-and-fidelity.md` Task 3
**Egress:** 76.86.178.245 (disposable, operator-confirmed). Prod egress is 209.50.61.64 — **not** used.

## Result: no ceiling was found

| target rate | duration | requests sent | succeeded | failures | **actual rate** |
|---|---|---|---|---|---|
| 6 req/min | 5 min | 30 | 30 | 0 | 6.0/min |
| 12 req/min | 5 min | 60 | 60 | 0 | 12.0/min |
| 30 req/min | 5 min | 126 | 126 | 0 | 25.2/min |
| 60 req/min | 5 min | 139 | 139 | 0 | 27.8/min |
| 120 req/min | 10 min | 282 | 282 | 0 | **28.2/min** |

**637 requests, zero failures, no throttling, no block, no CAPTCHA.** The IP was
not burned.

## The finding is a latency bound, not a policy bound

Note the actual rate flattening at ~28/min from tier 3 onward, regardless of the
target. Each `scrape_property` call for a small ZIP takes roughly two seconds
round-trip, and the mission ran **strictly serially** by design. So beyond ~30
requests/minute the pacing loop was never the constraint — request latency was.

**We did not find the source's rate limit. We found ours.**

That distinction matters for what can be concluded:

- **Safe:** a single serial worker can sustain ~28 req/min ≈ **40,000
  requests/day** without any sign of adverse response. Production currently makes
  ~22,700/day, comfortably inside that.
- **Unknown:** where the source actually starts refusing. Reaching it would
  require concurrency, which this mission deliberately forbade — parallel probing
  is exactly how a reconnaissance run turns into the ban it was meant to avoid.

## What this means for `2026-08-07-incremental-crawl.md`

Removing `past_days` was estimated to roughly triple request volume, to about
**68,000/day** — because a ZIP returning 567 rows costs 3 paged HTTP requests
where 89 rows cost 1.

68,000/day is **~47 req/min sustained**, which exceeds the ~28/min a single
serial worker can achieve. So:

1. **The volume increase is not blocked by a known rate limit** — nothing in this
   data suggests 47/min would be refused.
2. **But it cannot be reached serially on one node.** It needs either
   `parallel=True` (which the scraper already supports and production already
   passes through) or the idle nodes.
3. **Concurrency is the untested axis.** Every request in this mission was
   serial. Whether ten concurrent requests from one IP look different to the
   source than ten sequential ones is exactly the question this mission could not
   answer without risking the ban.

**Recommendation:** proceed with the staged `past_days` rollout, but treat the
concurrency increase as the risky variable rather than the request count. Raise
parallelism one step at a time and watch for the block signals — using structured
status codes, never by grepping for `403`/`429`, which matches ZIP codes.

## Method note

The tier summaries are in `ops/probe/apollo2/results/ceiling.jsonl`. Block
detection covered 403/forbidden/authentication/429/captcha/challenge on the
exception text; zero matched. Ten small ZIPs were cycled so each call cost about
one HTTP request, keeping req/min the controlled variable rather than result
size.
