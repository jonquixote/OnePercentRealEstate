# `past_days` Rollout Record

**Plan:** `docs/superpowers/plans/2026-08-07-incremental-crawl.md` Task 1
**Status:** Steps 1–3 complete. **Step 4 (unlimited) not yet taken.**

## Step 1 — baseline (`past_days=30`)

| metric | value |
|---|---|
| active for-sale | 550,907 |
| total listings | 1,345,749 |
| rent queue pending | 72 |
| ingest / 60 min | 1,021 |
| disk free | 41 G (72% used) |

## Step 2 — made configurable, deployed as a no-op

`SCRAPE_PAST_DAYS` now drives `ScrapeRequest.past_days`, defaulting to 30.
Contract verified across all six cases: unset→30, `30`→30, empty→`None`,
`90`→90, `0`→`None`, unparseable→30.

Emitted **explicitly** from `gen-env.sh` rather than left to the passthrough
filter, because that filter once prefix-matched `SCRAPER_URL` and silently
swallowed `SCRAPER_URLS`, killing the crawl for ten hours. It is also in the
deny-list so it is not emitted twice.

`${SCRAPE_PAST_DAYS-30}` uses a **single dash on purpose**: with `:-` an
explicitly empty value would be rewritten back to 30, making "no filter"
impossible to express.

Deployed with the default unchanged; active count and error rate flat. A no-op
deploy is the cheapest place to discover something is not a no-op.

## Step 3 — widened to 90 days

Set in the source `.env` (not `/etc/oper.env`, which `gen-env.sh` regenerates on
every deploy), regenerated, verified exactly one occurrence in the output, and
confirmed `SCRAPER_URLS` survived.

**Effect confirmed end-to-end**, not assumed — a live scrape of ZIP 33020 through
the deployed service:

| `past_days` | rows returned |
|---|---|
| 30 (Apollo I measurement) | 89 |
| **90 (deployed)** | **257** |

That single request inserted **36 listings we did not have** and updated 220, in
a ZIP the crawl already considered covered.

### Watched for ~20 minutes of sustained operation

| sample | rent queue | new / 5 min | ingest / 5 min |
|---|---|---|---|
| T+3 | 72 | 33 | 388 |
| T+6 | 72 | 5 | 139 |
| T+9 | 72 | 1 | 12 |

- **Rent queue flat at 72** while new listings arrived — the estimator drains as
  fast as ingest. This was the predicted failure point and it did not fail.
- Zero scraper errors (`500`/`DB Error`).
- Disk unchanged at 41 G free.
- Job durations 4.5 s – 8.6 s on low-yield ZIPs.

## Step 4 — not taken, deliberately

The plan gates unlimited on Step 3 being clean over **one full crawl cycle**,
which is ~6 days at current throughput. Twenty minutes is encouraging, not
sufficient: the ZIPs sampled in that window were mostly low-yield, and the
queue pressure from a dense ZIP at unlimited is exactly what has not been
observed yet.

**Recommendation:** let 90 soak for a full cycle, then re-read this table before
setting `SCRAPE_PAST_DAYS=` (empty). The revert is one env value and a scraper
restart.
