# Apollo — HomeHarvest probe mission

Plan: `docs/superpowers/plans/2026-08-06-apollo-probe-homeharvest.md`

## Task 1 recon — answered offline, zero network requests

`homeharvest==0.8.18` (pinned to prod). `scrape_property(location, ...)`.

### `location` accepts three shapes
`"Dallas, TX"` · `"85281"` · `"2530 Al Lipscomb Way"` (an address, with `radius`).
County is **not documented** — whether `"Cuyahoga County, OH"` resolves is an
empirical question for Rung 2.

### The parameter surface is far richer than production uses

| Parameter | Default | Production passes | Why it matters |
|---|---|---|---|
| `limit` | **10000** | *not passed* | the result cap |
| `offset` | 0 | *not passed* | pagination beyond the cap |
| `updated_since` | None | *not passed* | **incremental crawl** |
| `updated_in_past_hours` | None | *not passed* | **incremental crawl** |
| `price_min` / `price_max` | None | *not passed* | target the price band where the 1% line clears |
| `beds_min` / `sqft_min` / `year_built_min` … | None | *not passed* | filter server-side instead of locally |
| `property_type` | None | *not passed* | skip land/farm — already `not_applicable` for rent |
| `exclude_pending` | False | *not passed* | |
| `sort_by` / `sort_direction` | None / desc | *not passed* | |
| `extra_property_data` | True | **False** | hard-disabled in 0.8.18 per our own note |
| `past_days` | None | **30** | |
| `parallel` | True | from request | |

**`updated_in_past_hours` is the headline.** The production crawler re-scrapes
whole ZIPs to discover changes, which is why 64% of scrapes return nothing. A
query for "what changed since X" would collapse that waste — if it works at
region scale.

**The price/property_type filters matter for deals specifically.** Deal rate is
5.3× higher in low-volume (cheap) markets; filtering `price_max` server-side
would concentrate the crawl on the band where the 1% rule is clearable, instead
of paying to retrieve metro listings that can never qualify.

### The real cost unit is HTTP requests, not library calls

`core/scrapers/realtor/__init__.py:425` — the GraphQL query pages at
**`limit: 200`** with `offset`. So one `scrape_property()` call costs
**ceil(rows / 200)** HTTP requests internally.

A state query returning 10,000 rows is **~50 HTTP requests**, not one. The
mission's risk ladder and budget are therefore denominated in *estimated HTTP
requests* (`rows / 200`), not in library calls.

### Block signals
`__init__.py:78` — `status_code == 403` raises `AuthenticationError` or a
retryable `Exception`. Transient 400s ("Required parameter is missing") also
raise. Our `classify_block()` in `services/scraper_service/main.py` is the
single definition of "blocked" and is reused here rather than duplicated.

## Safety rules (enforced in `probe.py`, tested in `probe_test.py`)
- Hard budget: **60 estimated HTTP requests** for the whole mission.
- **Abort everything on the first block.** No retry, no next rung.
- Serial only, `parallel=False`, ≥20 s between requests, ≥120 s between rungs.
- Every attempt is written to `results/*.jsonl` **before** analysis, so an abort
  still leaves evidence.
- Never run from the production scraper's IP.
