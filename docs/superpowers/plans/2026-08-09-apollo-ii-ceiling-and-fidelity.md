# Apollo II — The Ceiling and the Fidelity of Incremental

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the two questions that gate the incremental crawl — *does `updated_in_past_hours` actually capture the changes we care about*, and *where does the source start blocking* — before restructuring a crawl around either assumption.

**Architecture:** Two independent investigations, both cheap, run in ascending risk order as before. Fidelity first (correctness — it can invalidate the whole design and costs almost nothing to test). Ceiling second (safety — it deliberately provokes the failure we most want to avoid, so it runs last, from a disposable IP, with an abort at the first sign).

**Tech Stack:** Python 3, `homeharvest==0.8.18`, the Apollo I harness (`ops/probe/apollo/probe.py`), PostgreSQL 16 read-only.

## Why Apollo I was not enough

Apollo I answered *what shapes exist and what they cost*. It did not answer the
two things that decide whether `2026-08-07-incremental-crawl.md` is safe to
build.

**1. Fidelity is untested.** Apollo I showed `updated_in_past_hours=24` returns
212 rows for Cuyahoga in 3.7 s, and that ZIP-level updates were contained within
county-level updates (0 missing). But it never asked **what "updated" means**.

If the filter captures new listings but not price cuts, an incremental crawl
silently loses `price_cut_pct` — one of the strongest deal signals the product
has, and the reason long-days-on-market inventory matters. If it captures price
changes but not status transitions, listings go to `pending`/`sold` without us
noticing, and "active" becomes a lie again in a new way. **The entire incremental
architecture rests on an assumption nobody has tested.**

**2. The ceiling is unknown, and we are about to walk toward it.** Apollo I ran
~60 requests over several hours and was never blocked. That establishes almost
nothing about production, which makes ~22,700 requests a day.

Worse, removing `past_days` — the highest-value change identified — **increases
request volume by itself**. A ZIP returning 89 rows costs 1 HTTP request; the
same ZIP returning 567 rows costs 3 (the library pages at 200). Roughly a 3×
increase in requests for the same ZIP coverage, before any scheduling change.

Restructuring a crawl to run harder against a source whose limits we have never
measured is the one move that can cost us everything. A ban does not degrade the
product — it stops it.

## Global Constraints

- **Fidelity before ceiling.** Task 1–2 are read-only observation at trivial volume. Task 3 deliberately provokes a block and therefore runs last, after everything else has been learned.
- **The ceiling probe runs from a disposable IP that is never used for production crawling**, and never from the production scraper node. If it succeeds in finding the limit, that IP may be burned — that is the accepted cost.
- **Abort at the first hard block in Tasks 1–2.** In Task 3 a block is the *result*, not a failure — but it still ends the task immediately.
- **Never grep for `403`/`429` to detect blocks.** ZIP codes contain those digits; that mistake produced a false "725 blocks" reading in the throughput audit. Use structured status codes and exception types.
- **Reuse the Apollo I harness** (`Budget`, `Mission`, `run_probe`) rather than writing a second one — its safety rails are already tested.
- **Read-only against prod Postgres.**
- **Record every attempt to JSONL before analysis**, so an abort still leaves evidence.

---

## Task 1: What does "updated" actually mean?

**Files:**
- Create: `ops/probe/apollo2/fidelity.py`
- Create: `ops/probe/apollo2/results/fidelity.jsonl`

**Interfaces:**
- Produces: the set of change types `updated_in_past_hours` does and does not capture.

**This is the task that can invalidate `2026-08-07-incremental-crawl.md`.** If
the filter misses price changes, the incremental design must be redrawn.

- [ ] **Step 1: Establish a same-instant baseline.** For one mid-size county,
capture both sets within the same minute so the comparison is not confounded by
listings changing between calls:

```python
full   = scrape("Cuyahoga County, OH", limit=10000)
inc24  = scrape("Cuyahoga County, OH", limit=10000, updated_in_past_hours=24)
```

Record `property_id`, `list_price`, `status`, `last_sold_date`, `days_on_market`
for both.

- [ ] **Step 2: Snapshot, wait, re-snapshot.** The only way to see what the
filter reacts to is to observe real changes over time:

```python
# t0: full county snapshot -> disk
# wait 24h
# t1: full county snapshot + updated_in_past_hours=24 snapshot
```

Diff `t0` against `t1`'s full snapshot to compute the **true** change set:
listings whose `list_price` moved, whose `status` moved, that appeared, that
disappeared.

- [ ] **Step 3: Score the filter against the truth.** For each change class,
report how many the incremental query caught:

| change class | true count (t0→t1 diff) | caught by `updated_in_past_hours=24` | recall |
|---|---|---|---|
| price decreased | | | |
| price increased | | | |
| status → pending/contingent | | | |
| status → sold | | | |
| newly listed | | | |
| disappeared from results | | | |

**Recall below 100% on "price decreased" or "newly listed" is disqualifying for
a pure incremental architecture** — those are the deal signal and the discovery
path respectively. Say so plainly if it happens.

- [ ] **Step 4: Test the window boundary.** Does `updated_in_past_hours=24`
reliably include something that changed 23 h ago? 25 h ago? The sweep design
depends on an overlap that actually overlaps:

```python
for h in (1, 6, 12, 24, 48, 72):
    scrape(county, updated_in_past_hours=h)
```

Record the row count at each. It should increase monotonically; a plateau means
the filter is not doing what the name implies.

- [ ] **Step 5: Check whether disappearance is observable at all.** A listing
that leaves the market simply stops appearing — no query returns "this is gone".
That is what the reaper infers from `last_seen_at`, and an incremental crawl
**never re-sees the unchanged**, so it can never confirm continued existence.

**This is a structural consequence worth stating explicitly**: incremental
sweeps alone cannot drive the lifecycle. Full sweeps remain the only way a
listing gets confirmed present, which is exactly why
`2026-08-07-incremental-crawl.md` Task 3 keeps the ZIP backstop.

- [ ] **Step 6: Write the verdict.** Either "incremental is safe for change
detection, with these caveats", or "incremental misses X and the design must
change". Commit — `probe(apollo2): fidelity of updated_in_past_hours`

---

## Task 2: Containment, systematically

**Files:**
- Create: `ops/probe/apollo2/containment.py`

**Interfaces:**
- Consumes: Apollo I's single-sample finding (1 listing missing from Cuyahoga).

Apollo I found a county query missing an in-cap, in-county listing — **on one
sample**. One sample establishes that it *can* happen, not how often, nor
whether it worsens with size.

- [ ] **Step 1: Sample across the size range.** Pick 6 counties spanning small to
large by our own listing counts. For each, take the county set and one
constituent ZIP's set, and compute `in_zip_not_in_county`.

- [ ] **Step 2: Report the rate, not an anecdote.** Miss rate per county, plotted
against county size. If it rises with size, the backstop cadence must scale with
county size rather than being uniform.

- [ ] **Step 3: Characterise what gets missed.** Apollo I's missing listing was
`CONTINGENT`. If misses cluster in a status, the backstop can target that status
specifically instead of re-sweeping everything.

- [ ] **Step 4: Commit** — `probe(apollo2): containment miss rate across county sizes`

---

## Task 3: Find the ceiling — deliberately, last, from a burnable IP

**Files:**
- Create: `ops/probe/apollo2/ceiling.py`
- Create: `docs/perf/2026-08-apollo2-ceiling.md`

**This task exists to get blocked.** It runs after everything else, because once
it succeeds the IP may be unusable.

- [ ] **Step 1: Confirm the IP is disposable and is not the production scraper's.**
Record the egress IP so the result can be attributed:

```bash
curl -s https://api.ipify.org
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 "curl -s https://api.ipify.org"
```

**If these match, stop.** Blocking the production egress IP would take the crawl
down entirely.

- [ ] **Step 2: Ramp request rate geometrically, recording everything.** Start
well below production's observed rate and climb:

```
tier 1:  6 req/min for 5 min
tier 2: 12 req/min for 5 min
tier 3: 30 req/min for 5 min
tier 4: 60 req/min for 5 min
tier 5: 120 req/min until blocked
```

At each tier record: requests sent, successes, first failure, failure type
(status code / exception class), and whether success resumes after backoff.

- [ ] **Step 3: Characterise the block when it comes.** The operationally
important questions are not "were we blocked" but:
  - Is it a hard ban or a temporary throttle?
  - How long until requests succeed again? (Retry every 5 min, up to 2 h.)
  - Is it per-IP, or did it affect the production node too? **Check the
    production crawl's health immediately** — if prod degrades while only this
    IP was pushing, the limit is account- or fingerprint-level, not per-IP, and
    that changes everything about multi-node plans.

- [ ] **Step 4: Derive the safe operating rate.** Take the tier below the first
failure and halve it. State it as requests/minute and as requests/day, and
compare against both current production (~22,700/day) and the post-`past_days`
estimate (~68,000/day).

**If the safe rate is below the post-`past_days` estimate, that plan's Task 1
must be re-scoped** — perhaps to a subset of ZIPs, or paired with the
incremental sweep so total volume falls rather than rises.

- [ ] **Step 5: Write the decision record**, including the recovery time, since
that determines how bad a mistake is and therefore how much headroom the
production rate should keep. Commit — `docs(probe): apollo2 — measured source ceiling and safe operating rate`

---

## Self-Review

**Spec coverage:** the two assumptions that `2026-08-07-incremental-crawl.md`
rests on are tested before it is built — what the incremental filter captures
(T1) and how hard we may push (T3) — plus the single-sample containment finding
is turned into a rate (T2). T1 Step 5 states a structural consequence the
implementation plan already assumes but never justified: incremental sweeps
cannot drive the lifecycle, because nothing reports a disappearance.

**Placeholder scan:** every task names files, the exact calls, and what to
record. T1's 24-hour wait is inherent — the filter can only be scored against
changes that actually happened — and is called out rather than hidden.

**Type consistency:** no new runtime contracts; the Apollo I harness (`Budget`,
`Mission`, `run_probe`, `ProbeResult`) is reused unchanged, so results from both
missions share one schema and can be compared directly.
