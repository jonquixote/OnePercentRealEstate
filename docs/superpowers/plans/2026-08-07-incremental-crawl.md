# Incremental Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** See the whole market instead of 16% of it, and detect daily change for a quarter of the request budget — by removing one parameter and restructuring the recheck around county-scoped incremental sweeps.

**Architecture:** Three changes in strict dependency order, each independently valuable and independently revertible. Remove `past_days=30` so the crawl can see inventory listed more than 30 days ago. Add incremental county sweeps for change detection. Keep full ZIP sweeps as the completeness backstop, because county queries provably miss listings.

**Tech Stack:** `services/scraper_service` (FastAPI + `homeharvest==0.8.18`), `apps/worker` crawl orchestration, PostgreSQL 16, bash ops probes.

## What the Apollo mission established

Full findings: `docs/perf/2026-08-apollo-findings.md`. The four that drive this plan:

**1. Production sees 16% of available inventory.** Same ZIP, one parameter:

| query | rows |
|---|---|
| `scrape_property("33020", "for_sale")` | **567** |
| with `past_days=30` — what production sends | **89** |

`past_days` filters by *list date*, so everything listed 31+ days ago and still
for sale is structurally invisible. Long days-on-market is precisely where price
cuts and motivated sellers concentrate — the crawl is blind to the inventory
most likely to contain deals, by construction.

**2. It also explains the 64% empty-scrape rate.** A ZIP with no *newly listed*
property in 30 days returns nothing even when it holds hundreds of active ones.

**3. Incremental county sweeps are ~13× cheaper than full ones:**

| query | rows | wall | est. HTTP |
|---|---|---|---|
| Cuyahoga County — full | 5,354 | 72.2 s | 27 |
| **Cuyahoga — `updated_in_past_hours=24`** | **212** (44 ZIPs) | **3.7 s** | **2** |

~3,143 US counties × ~2 requests = **~6,300 requests for a complete national
daily sweep**, against ~22,700 requests/day currently buying a *six-day* sweep of
*16%* of inventory.

**4. But full county queries silently miss listings.** Cuyahoga, *under* the
10,000 cap at 5,354 rows, omitted a listing ZIP 44120 returned — a $115,000
CONTINGENT Cleveland property, genuinely in-county. **County shapes cannot be
trusted for completeness**, though incremental containment held (0 missing).

## Global Constraints

- **Ingest volume will rise roughly 6× when `past_days` is removed.** Every downstream consumer — the rent estimator queue, the dedupe path, disk, the rent-band backfill — must be watched during rollout. This is the single riskiest part of the plan and it is why Task 1 is staged rather than flipped.
- **Never trust a county query for completeness.** Full ZIP sweeps remain the backstop. Removing them because incremental sweeps look complete would lose deals we can never know we lost.
- **Truncation is silent.** Any query approaching `limit` must be treated as incomplete; log and paginate rather than assume.
- **The crawl shares Postgres with both apps.** Watch `db-load-budget.sh` and `perf-budget.sh` throughout; `docs/perf/perf-budgets.md` binds.
- **`SCRAPER_URLS` is a known trap.** `gen-env.sh`'s deny-list once matched `^SCRAPER_URL` and swallowed it, killing the crawl for ten hours. Verify the generated env after any change touching it.
- **Watch for blocks using structured fields, never by grepping for `403`/`429`** — ZIP codes contain those digits, and that mistake already produced a false "725 blocks" reading.

---

## Task 1: Remove `past_days`, staged

**Files:**
- Modify: `services/scraper_service/main.py` (the `ScrapeRequest` default and `scrape_kwargs`)
- Modify: whatever sets `past_days` in `apps/worker`
- Create: `docs/perf/2026-08-past-days-rollout.md`

**Interfaces:**
- Produces: full-inventory visibility, and the measured downstream impact of ~6× ingest.

- [ ] **Step 1: Establish the baseline that proves the change worked**, before touching anything:

```sql
SELECT count(*) FILTER (WHERE listing_status='active' AND listing_type='for_sale') AS active,
       count(*) AS total,
       max(last_seen_at) AS newest
  FROM listings;
SELECT count(*) FROM listings WHERE rent_calc_status='pending';
```

Record all four, plus current disk (`df -h /`) and the rent queue depth.

- [ ] **Step 2: Make `past_days` configurable rather than hardcoded**, defaulting to the current value, so the rollout is a config change and the revert is instant:

```python
past_days: int | None = int(os.getenv("SCRAPE_PAST_DAYS", "30")) or None
```

Deploy this with the default unchanged. **Nothing should change** — verify ingest
rate and active count are flat before proceeding. A no-op deploy that turns out
not to be a no-op is the cheapest possible place to discover a mistake.

- [ ] **Step 3: Widen to 90 days on a subset first.** Do not go straight to
unlimited. Set `SCRAPE_PAST_DAYS=90` and watch for one full crawl cycle:

```bash
watch -n 300 '/opt/onepercent/ops/monitoring/db-load-budget.sh; \
              /opt/onepercent/ops/monitoring/crawl-health.sh; \
              df -h / | tail -1'
```

Record: ingest rate, rent queue depth, disk delta, and whether any route breached
its p95 budget.

- [ ] **Step 4: Go unlimited only if Step 3 was clean.** `SCRAPE_PAST_DAYS=` (empty → `None`).

The expected effect is ~6× inventory. **The rent estimator queue is the most
likely thing to break**: it drains at a finite rate and a 6× ingest step will
back it up. Watch `rent_calc_status='pending'` depth specifically — if it grows
monotonically for an hour, pause the rollout and size the estimator before
continuing.

- [ ] **Step 5: Record the rollout** — before/after active count, ingest rate, queue depth, disk, and the freshness probe. Commit — `feat(crawl): see the whole market — past_days is now configurable and unset`

---

## Task 2: Incremental county sweeps

**Files:**
- Create: `infrastructure/migrations/2026_08_07_county_sweep_state.sql`
- Modify: `apps/worker` crawl orchestration
- Modify: `services/scraper_service/main.py` (accept `updated_in_past_hours`)

**Interfaces:**
- Produces: `county_sweep_state(fips_code, county, state, last_swept_at, last_change_count, consecutive_empty)`

- [ ] **Step 1: Pass `updated_in_past_hours` through the scraper service.** Add it to `ScrapeRequest` and `scrape_kwargs`, defaulting to `None` so existing callers are unaffected.

- [ ] **Step 2: Write the failing test** for the sweep window calculation — the part that will be wrong if anyone is careless:

```python
def test_window_covers_the_gap_since_last_sweep():
    """A 25h window after a 24h gap — never a 24h window, which would
    lose anything that changed during the sweep itself."""
    assert window_hours(last_swept_hours_ago=24) >= 25

def test_window_has_a_floor_for_a_never_swept_county():
    assert window_hours(last_swept_hours_ago=None) >= 24

def test_window_is_capped_so_a_stale_county_does_not_request_everything():
    assert window_hours(last_swept_hours_ago=10_000) <= MAX_WINDOW_HOURS
```

The overlap in the first test is the important one: a window exactly equal to the
gap drops anything that changed while the previous sweep was running.

- [ ] **Step 3: Build the county list** from `listings.county` + `state`, plus the FIPS reference already used by `market-series`. Record which counties we have never swept.

- [ ] **Step 4: Sweep, serially, with the same care as Apollo** — record rows, wall time, distinct ZIPs, and **whether the result approached `limit`** (truncation means the window was too wide; halve it and retry).

- [ ] **Step 5: Measure against Task 1's baseline.** Requests/day, listings re-seen/day, and the freshness probe. The target is the Apollo estimate: complete national daily coverage at roughly a quarter of the current request budget.

- [ ] **Step 6: Commit** — `feat(crawl): incremental county sweeps for change detection`

---

## Task 3: Keep the ZIP backstop, and prove it is still needed

**Files:**
- Modify: `apps/worker` crawl orchestration
- Create: `ops/monitoring/crawl-completeness.sh`
- Create: `ops/systemd/oper-crawl-completeness.{service,timer}`

- [ ] **Step 1: Keep full ZIP sweeps running at a reduced cadence.** Incremental sweeps handle *change*; ZIP sweeps handle *completeness*. Apollo showed a county query missing an in-cap, in-county listing — that is the gap this closes.

- [ ] **Step 2: Write the completeness probe.** It samples a ZIP, queries it directly, and compares against what the incremental path has recorded, reporting listings the incremental path missed.

**This probe is the evidence for whether Step 1 is still necessary.** If it
reports zero misses over weeks, the backstop cadence can drop further. If it
reports misses, the backstop is load-bearing and must not be removed.

- [ ] **Step 3: Prove it fires and resolves**, by the established method.

- [ ] **Step 4: Commit** — `feat(crawl): completeness probe for the incremental path`

---

## Task 4: Close the ZIP coverage gap

**Files:**
- Modify: `apps/worker` crawl orchestration
- Modify: `docs/HANDOFF.md` §5

- [ ] **Step 1: Harvest ZIPs from county sweeps.** Every county sweep returns `zip_code` values; any not already known is a new market. This is the one thing ZIP-shaped scheduling structurally cannot do, since its queue is built from ZIPs we already have.

- [ ] **Step 2: Measure the gap closing.** We hold 27,475 ZIPs against ~33,000 standard US delivery ZIPs. Record how many new ZIPs each sweep round discovers, and whether the count converges.

- [ ] **Step 3: Report the deal impact, not the ZIP count.** New ZIPs are worth something only if they contain deals. Report deals found in newly discovered ZIPs — and note that deal *rate* is highest in the lowest-volume markets (37.5% vs 7.1%), which is exactly where undiscovered ZIPs are likely to sit.

- [ ] **Step 4: Update `docs/HANDOFF.md` §5** with the crawl architecture: incremental county sweeps for change, ZIP sweeps for completeness, county sweeps for discovery, and why each exists. Commit — `feat(crawl): discover unknown ZIPs from county sweeps`

---

## Self-Review

**Spec coverage:** all four Apollo findings are acted on — the `past_days`
blindness (T1), the incremental cost collapse (T2), the county completeness gap
(T3), and the ZIP coverage gap (T4). The riskiest change is staged across three
deploys with an instant revert, because a 6× ingest step has more ways to go
wrong than any other change here.

**Placeholder scan:** every step names files, commands and what to record. The
sweep window arithmetic is specified by test before implementation because an
off-by-one there silently loses listings rather than failing loudly.

**Type consistency:** `window_hours(last_swept_hours_ago: int | None) -> int` is
the only new pure contract; `updated_in_past_hours` threads through
`ScrapeRequest` with the same name and type the library uses, so there is one
name for this concept from the worker to the API.
