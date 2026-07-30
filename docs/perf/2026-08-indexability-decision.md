# Indexability decision — how we tell crawlers what to trust

**Date:** 2026-07-30 · Executes `2026-08-05-indexability-and-honest-urls`

## What shipped

| surface | behaviour |
|---|---|
| `/property/<missing-id>` | renders the not-found UI + **`noindex`**; HTTP **200** (see below) |
| `/property/<stale-id>` (unconfirmed > 10 d) | renders normally + **`robots: noindex, follow`** |
| `/property/<fresh-id>` | `index, follow` — unchanged |
| `sitemap.xml` | advertises only listings confirmed within **10 days** |

One freshness threshold — `SEO_FRESHNESS_DAYS = 10` in `@/lib/freshness` — drives
both the sitemap filter and the page `robots` tag, so they can never give a
crawler contradictory signals. Ten days is the SLO / reaper window
(`STALE_AFTER_DAYS`), so "advertised and indexable" means exactly "still active
by the crawler's own definition."

## The one place reality overrode the plan: 404 vs 200

The plan (Task 1 Step 5) expected `/property/<missing-id>` to return **HTTP 404**.
It returns **200 with a `noindex` meta tag** instead, and this is not a bug we
can cheaply fix — it is documented Next.js behaviour:

> Once streaming begins, HTTP response headers and status codes cannot be
> changed. If `notFound()` triggers mid-stream, Next.js cannot alter the HTTP
> status code to 404 and instead injects a `noindex` meta tag so search engines
> do not index the page.
> — Next.js App Router docs, "Streaming › The HTTP contract"

`notFound()` **is** called (the page renders the not-found boundary), but only
after `await getProperty(id)`, and on this app streaming has already begun by
then — confirmed empirically: `/playbook/<bad-slug>` and `/market/<bad-zip>`,
which also call `notFound()` after an await, likewise return 200. So this is
app-wide, not specific to the property route, and not caused by the request-id
middleware (which re-throws and does not touch status).

**Why we accept it.** The purpose of Task 1 was to stop search engines indexing
listings that do not exist. `noindex` achieves exactly that — Google drops a
`noindex` page from the index regardless of its status code. A true 404 would be
marginally better for *crawl budget* (it says "stop asking", where `noindex`
only says "don't index"), but obtaining one would require the existence check to
run before any Suspense boundary across the whole app — restructuring the root
render path — for a marginal gain on a URL space crawlers already learn to
de-prioritise once pages carry `noindex`. That cost is disproportionate.

**If we ever want the real 404:** do a fast existence check (`SELECT 1 FROM
listings WHERE id = $1`, then archive) at the very top of the page component,
before any `await` that feeds a streamed subtree and before the route's
`loading.tsx` shell can flush — per the Next "trigger before Suspense" guidance.
Deferred deliberately.

## Task 3 options and choice

The three options the plan framed:
- **(a) index normally** — keeps stale listings in results. Rejected.
- **(b) `noindex` past the freshness cutoff** — page still renders for anyone
  with the link, search engines stop surfacing it, reversible the moment the
  crawler re-confirms. **Chosen.**
- **(c) 410 past a longer cutoff** — wrong under relabel-never-delete; the
  listing may return. Rejected.

(b) is the right call and matches the sitemap rule exactly. It also composes with
the archival work: an archived listing still renders 200 and is not 404'd — the
page test pins this so archival cannot regress into false 404s.

The population this affects is now small: with the sweep fixed, 99.8% of active
listings are confirmed within 10 days, so `noindex` applies to a fraction of a
percent — versus the 23.7% the plan measured before the crawl was healthy.
