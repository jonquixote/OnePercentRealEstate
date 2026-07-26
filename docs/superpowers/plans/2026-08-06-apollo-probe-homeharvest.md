# Apollo: Probing HomeHarvest for the Optimal Crawl Unit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out empirically whether ZIP-by-ZIP is the right unit of crawl work, or whether city / county / state queries return more inventory per request — without getting the source IP blocked while finding out.

**Architecture:** A strictly ascending ladder of risk. Every rung is gated on the previous rung completing unblocked, with cooldowns between requests and a hard budget for the whole mission. Offline reconnaissance first — the library's own source answers several questions without touching the network at all. Findings are recorded per rung so an abort at any point still leaves usable knowledge.

**Tech Stack:** Python 3, `homeharvest==0.8.18` (pinned to match prod), a local venv, PostgreSQL 16 read-only for comparison.

## Why this exists

Two measurements make the current crawl unit suspect.

**1. Two thirds of the work returns nothing.** Over 24 hours to 2026-07-26:
14,562 of 22,697 ZIP scrapes (**64%**) returned no results, while the crawler
was healthy and unblocked (34 errors, all census geocoding). Per-ZIP job
duration ran 14 s – 378 s regardless of yield — an empty ZIP costs nearly as
much as a full one.

**2. Coverage is incomplete.** We hold listings in **27,475** ZIPs (23,989 with
active inventory). USPS publishes ~42,000 ZIP codes, of which roughly 33,000 are
standard delivery areas. Several thousand residential ZIPs have never been
crawled, and ZIP-by-ZIP scheduling cannot find them because the queue is built
from ZIPs we already know.

If a county query returns the same listings in one request that 30 ZIP queries
return in 30, the entire scheduling problem changes shape — and so does the
coverage gap, because a county enumerates its own ZIPs whether we knew them or
not.

## What we are actually optimising for — and why yield is the wrong target

The product exists to surface **deals**: properties whose rent-to-price ratio
clears the underwriting line (the 1% rule as the primordial case, and the
per-property-type `target_ratio` rules generally). Not listings. Deals.

Measured on prod, active standard for-sale listings with a rent estimate,
bucketed into deciles by how many listings each ZIP has:

| ZIP volume decile | ZIPs | listings | deals (≥1%) | **deal rate** |
|---|---|---|---|---|
| 1 (fewest listings) | 2,271 | 2,271 | 851 | **37.5%** |
| 2 | 2,271 | 3,020 | 1,090 | 36.1% |
| 5 | 2,271 | 13,399 | 3,089 | 23.1% |
| 8 | 2,271 | 48,649 | 6,597 | 13.6% |
| 10 (most listings) | 2,270 | 186,046 | 13,210 | **7.1%** |

**Deal rate falls monotonically as listing volume rises — a 5.3× spread.**
Cheap, thin, rural markets are where the 1% line is clearable; dense expensive
metros are where it is not.

So a scheduler that prioritises *listing yield* would systematically steer the
crawler toward the deal-poorest markets. That is the opposite of the product's
purpose, and it is why `2026-08-04-crawl-yield-scheduling.md` **must be rewritten
before it is executed** — its central metric is wrong.

But the inverse rule is wrong too. Per ZIP scraped, decile 10 still yields
**5.82 deals** against decile 1's **0.37** — sixteen times more deals per unit of
crawl cost, because the rate is lower but the base is enormously larger. Neither
"crawl the dense markets" nor "crawl the thin markets" is right on its own.

**The metric that actually matters is new deals discovered per unit of crawl
cost**, and nobody has measured it, because the crawl has never recorded deals
per scrape. This mission establishes the *cost* side of that ratio: what a
request costs and what it returns, per unit shape.

## Global Constraints

- **Ascending risk, always.** No rung is attempted before the previous rung has completed unblocked. Rungs are ordered by request count and result-set size, both of which correlate with block probability.
- **Abort the entire mission on the first hard block** (403, 429, challenge page, or `classify_block` returning true). Record it and stop. A block costs more than the information.
- **Hard budget: 60 network requests total across the whole mission.** The current production crawler makes ~22,700 a day, so this is under 0.3% of one day's normal traffic from a different IP.
- **Serial only. Never `parallel=True`.** Minimum 20 s between requests, 120 s between rungs.
- **Never run against the production scraper node or its IP.** This runs locally, on an IP the operator has designated disposable, or on a dedicated side server.
- **Read-only against prod Postgres.** The mission compares results to what we already hold; it writes nothing.
- **Record every probe's raw outcome to disk before analysis**, so an abort still leaves the evidence.
- **`classify_block()` already exists** in `services/scraper_service/main.py` — reuse it rather than inventing a second definition of "blocked".

---

## Task 1: Offline reconnaissance — answer what the source already knows

**Files:**
- Create: `ops/probe/apollo/README.md`
- Create: `ops/probe/apollo/00-recon.py`

**Interfaces:**
- Produces: the exact accepted shapes of `location`, the parameter surface, and any built-in result caps — all without a network request.

- [ ] **Step 1: Create an isolated venv pinned to prod's version.** A version drift here would make every finding inapplicable:

```bash
python3 -m venv /tmp/apollo && /tmp/apollo/bin/pip install -q homeharvest==0.8.18
/tmp/apollo/bin/python -c "import homeharvest; print(homeharvest.__file__)"
```

- [ ] **Step 2: Enumerate the API surface offline.**

```bash
/tmp/apollo/bin/python - <<'PY'
import inspect, homeharvest
from homeharvest import scrape_property
print("signature:", inspect.signature(scrape_property))
print("---- docstring ----")
print(inspect.getdoc(scrape_property))
PY
```

Record every parameter, its default, and what the docstring says `location`
accepts. **This is free information and it may make whole rungs unnecessary** —
if the library documents a hard result cap, we know the ceiling before spending
a single request.

- [ ] **Step 3: Find the result cap and pagination in the source**, not by experiment:

```bash
grep -rn "limit\|offset\|LIMIT\|page_size\|total\|count" \
  /tmp/apollo/lib/python*/site-packages/homeharvest/core/scrapers/realtor/__init__.py | head -40
```

A hard cap (commonly 10,000 for this API shape) decides whether state-level
queries can ever be complete or are only useful for discovery. **Record the
number and the line it appears on.**

- [ ] **Step 4: Find how the library signals a block**, and confirm `classify_block()` in our scraper covers those cases:

```bash
grep -rn "raise\|status_code\|403\|429\|captcha\|challenge" \
  /tmp/apollo/lib/python*/site-packages/homeharvest/core/scrapers/realtor/__init__.py | head -20
```

- [ ] **Step 5: Write `ops/probe/apollo/README.md`** recording all of the above, plus the mission's safety rules, so a future engineer can resume without re-deriving them. Commit — `docs(probe): apollo recon — homeharvest API surface and result caps`

---

## Task 2: The probe harness (still no network)

**Files:**
- Create: `ops/probe/apollo/probe.py`
- Create: `ops/probe/apollo/probe_test.py`

**Interfaces:**
- Produces: `run_probe(location, listing_type, **kw) -> ProbeResult` writing one JSON line per attempt to `ops/probe/apollo/results/`.

- [ ] **Step 1: Write the failing tests** for the safety rails. These are the parts that must not be wrong, and they are all testable without a network:

```python
def test_budget_is_enforced():
    """The mission must stop at the hard request budget."""
    b = Budget(max_requests=3)
    for _ in range(3): b.spend()
    with pytest.raises(BudgetExhausted): b.spend()

def test_block_aborts_the_mission():
    """A single block ends everything — no retry, no next rung."""
    m = Mission(); m.record(ProbeResult(blocked=True))
    assert m.aborted is True

def test_results_are_written_before_analysis():
    """An abort must still leave the evidence on disk."""
    ...

def test_minimum_delay_between_requests():
    assert Mission(min_delay_s=20).next_delay() >= 20
```

- [ ] **Step 2: Run them, watch them fail, then implement** `probe.py`. Every probe records: location, shape (zip/city/county/state), wall time, row count, distinct ZIPs returned, whether blocked, exception text, and the raw first row — appended as JSON Lines **before** any analysis runs.

- [ ] **Step 3: Dry-run the harness with a stubbed scraper** to prove the budget, the delay, and the abort path work end to end without a single network call.

- [ ] **Step 4: Commit** — `feat(probe): apollo harness with budget, cooldown, and abort-on-block`

---

## Task 3: Rung 1 — a single small ZIP (baseline, 3 requests)

**Files:**
- Create: `ops/probe/apollo/results/rung1.jsonl`

**Interfaces:**
- Produces: the per-request cost baseline every later rung is compared against.

- [ ] **Step 1: Pick three ZIPs from three different states** that we already hold, of low, medium and high inventory, so the baseline spans the range. Take them from prod:

```sql
SELECT zip_code, count(*) FROM listings
 WHERE listing_status='active' AND listing_type='for_sale' AND zip_code ~ '^\d{5}$'
 GROUP BY 1 HAVING count(*) BETWEEN 5 AND 900
 ORDER BY random() LIMIT 3;
```

- [ ] **Step 2: Probe each, serially, 20 s apart**, `listing_type="for_sale"`, no extra data, `parallel=False`.

- [ ] **Step 3: Record and compare against what we already hold** for those ZIPs. If the probe returns materially *more* than our database has, the current crawl is losing listings — a finding in its own right, independent of crawl shape.

- [ ] **Step 4: Stop if blocked.** Otherwise wait 120 s. Commit the results file — `probe(apollo): rung 1 — per-ZIP baseline`

---

## Task 4: Rung 2 — city, then county (6 requests)

- [ ] **Step 1: Choose a county we hold well**, and the city that dominates it, so the comparison is against known ground truth:

```sql
SELECT county, state, count(DISTINCT zip_code) AS zips, count(*) AS listings
  FROM listings WHERE listing_status='active' AND listing_type='for_sale' AND county IS NOT NULL
 GROUP BY 1,2 ORDER BY listings DESC LIMIT 5;
```

- [ ] **Step 2: Probe `"<City>, <ST>"`** (3 cities, 20 s apart). Record rows, distinct ZIPs, wall time.

- [ ] **Step 3: Wait 120 s. Probe `"<County> County, <ST>"`** (3 counties).

- [ ] **Step 4: The decisive comparison.** For one county, compare:
  - rows from the single county query
  - rows from summing that county's ZIPs in our database
  - **distinct ZIPs returned by the county query that we have never seen**

  That last number is the coverage answer. If a county query surfaces ZIPs
  absent from our 27,475, county-shaped crawling closes the coverage gap that
  ZIP-shaped crawling structurally cannot.

- [ ] **Step 5: Check for truncation.** If a county returns exactly the cap found in Task 1 Step 3, it is truncated and **cannot** be treated as complete. Record which counties truncate.

- [ ] **Step 6: Commit** — `probe(apollo): rung 2 — city and county shapes`

---

## Task 5: Rung 3 — state (2 requests, highest risk)

**Only attempted if rungs 1 and 2 completed entirely unblocked.**

- [ ] **Step 1: Probe one small state** (e.g. `"Delaware"` or `"Rhode Island"`) — small enough that a complete answer is plausible, large enough to be informative.

- [ ] **Step 2: Wait 300 s.** Probe one medium state.

- [ ] **Step 3: Record truncation, wall time, and distinct ZIP coverage.** A state query that truncates at the cap tells us the ceiling; one that does not tells us the crawl could be restructured entirely.

- [ ] **Step 4: Commit** — `probe(apollo): rung 3 — state shape`

---

## Task 6: The verdict, with deals as the unit

**Files:**
- Create: `docs/perf/2026-08-apollo-findings.md`

- [ ] **Step 1: Build the comparison table** — for each shape (zip / city / county / state): requests needed for national coverage, wall time per request, rows per request, distinct ZIPs per request, and whether results truncate.

- [ ] **Step 2: Score by deals, not rows.** Join the probe's returned listings against our rent model where possible, or fall back to the deal-rate-by-volume-decile table above, to estimate **deals discovered per request** for each shape. This is the number that decides the crawl architecture.

- [ ] **Step 3: Answer the coverage question explicitly.** How many of the ~5,500 ZIPs we have never seen would each shape reach, and at what cost?

- [ ] **Step 4: Recommend one crawl architecture.** Not a menu — a recommendation, with the measurement that supports it and the risk that argues against it.

- [ ] **Step 5: State explicitly what must change in `2026-08-04-crawl-yield-scheduling.md`.** That plan schedules by listing yield; the deal-rate inversion measured here already invalidates its metric, and this mission may invalidate its unit of work as well. **It must be rewritten, not executed, before any scheduling change ships.**

- [ ] **Step 6: Commit** — `docs(probe): apollo findings and the recommended crawl architecture`

---

## Self-Review

**Spec coverage:** the mission answers the three questions that decide the crawl
architecture — what a request costs by shape, whether larger shapes truncate,
and whether they reach ZIPs that ZIP-shaped crawling structurally cannot — while
never exceeding 60 requests or continuing past a block. Task 6 converts the
findings into the deal-denominated metric the product actually cares about,
rather than the row counts that are easy to measure.

**Placeholder scan:** every rung names its request count, its delay, its abort
condition, and what to record. The one deliberately open value — the result cap
— is produced by Task 1 Step 3 from the library source before any network
request depends on it.

**Type consistency:** `run_probe(location, listing_type, **kw) -> ProbeResult`
and the `Budget` / `Mission` guards are the only new contracts, all local to
`ops/probe/apollo/` and never imported by the application. Nothing in this
mission can affect production behaviour.
