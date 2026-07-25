# Route latency budgets

**Enforced by:** `ops/monitoring/perf-budget.sh` (10-minute timer) reading `/api/admin/perf`.
**Alerts when:** a route's p95 exceeds its budget **and** the window holds ≥20 samples.

Every measured value below is real, taken on prod. Budgets are set above the
current value with headroom, so the alert means *regression*, not *aspiration*.

| Route (`withSpan` name) | Budget (p95) | Measured | How it got there |
|---|---|---|---|
| `api.stats` | 300 ms | **3 ms** (p95, prod) | precomputed `stats_summary` + SWR (was 18,500 ms) |
| `api.stats.median-rent` | 300 ms | **9 ms** | folded into the same precompute pass (was 7,100 ms) |
| `api.markets` | 300 ms | — | native `city`/`state` columns instead of TOASTed `raw_data` |
| `market.zip` | 1,000 ms | **~50 ms** | cached nationwide ZIP ranking (was 10,400 ms) |
| `property.id` | 1,000 ms | — | first instrumented in this change |

### `market.zip` samples rarely — by design, and it matters

Market pages are ISR-cached (`revalidate = 86400`, served with
`s-maxage=86400`). Verified on prod: three cold ZIPs (43701, 15201, 63104) all
returned in ~100 ms from cache and recorded **zero** samples, because the page
component never ran. `market.zip` therefore only samples on regeneration.

Consequence: it will usually sit below the 20-sample minimum and the budget will
not evaluate. That is not a bug, but it *is* a blind spot — a regression in the
market page shows up as slow regeneration, not as a p95 breach. Judge that route
by `[SLOW QUERY]` alerts and the regeneration timing, not by this table.

## What is deliberately NOT budgeted

A budget on an uninstrumented route never fires, so it reads as permanently
passing — strictly worse than having no entry. Only instrumented routes appear
above. Currently excluded:

- **`/search`** — the page component is client-rendered (`export default function
  SearchPage()`), so there is no server-side duration to time. Budget it when
  its data loading moves server-side.
- **`sitemap`** — generated cold, outside the request path. Its failure mode is
  *errors* (it 500'd on Next 16's `generateSitemaps`), not latency; the
  healthcheck covers that.

## When a budget alert fires

1. `curl -H "Authorization: Bearer $ADMIN_API_KEY" localhost:3001/api/admin/perf`
   — confirm which route and whether `live` or `window` is driving it.
2. Check the journal for `[SLOW QUERY]` around that time; a slow route is
   almost always one slow query (every case so far has been).
3. `EXPLAIN (ANALYZE, BUFFERS)` the query. The two causes seen repeatedly here:
   a predicate that does not match a partial index (a probe went 8,435 ms →
   0.134 ms once it matched), and reading `raw_data->>'…'` instead of a native
   column (TOAST decompression: 1.07 ms → 0.06 ms per row).
4. Fix at the source if it is request-path work; move it to a timer if it is
   not (that is what `stats_summary` and the ZIP ranking are).

**Do not** fix a budget alert by raising the budget. If the new value is
genuinely correct, change the row *and* record why in this table.
