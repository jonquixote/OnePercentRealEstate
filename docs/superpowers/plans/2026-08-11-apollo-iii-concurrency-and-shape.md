# Apollo III — Concurrency, and the Shape That Confirms Fastest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find the two numbers that every remaining crawl decision depends on — how much concurrency the source tolerates, and which query shape confirms the most listings per unit of capacity — without getting blocked.

**Architecture:** Apollo I mapped the shapes. Apollo II measured fidelity, containment, and a serial rate ceiling. Both left the same gap: **every request either mission made was serial**, so the one axis that actually limits throughput was never touched. This mission tests concurrency deliberately and in small steps, then uses the answer to measure confirmation throughput per shape.

**Tech Stack:** Python 3, `homeharvest==0.8.18`, the Apollo I harness (`ops/probe/apollo/probe.py`), PostgreSQL 16 read-only.

## Why this mission, and why now

The freshness work (`2026-08-10`) ended at a hard number:

| | value |
|---|---|
| confirmations needed for a **7-day** sweep | **3,267 / hour** |
| confirmations achieved | **~1,898 / hour** |
| | **58% of required** |

Every cheap lever has now been tried and the remaining options are all
throughput. Specifically, three things are already ruled out:

- **Starving another stream is refused.** `for_sale` adds 9,419 rows/day,
  `rental_listings` 8,276, `sold_listings` 7,536 — all comparably productive.
  Rebalancing trades rent and sold comps for a freshness number.
- **Widening the window is refused.** The 10-day SLO now matches the reaper and
  reads 99.5%; the 7-day figure is retained precisely so this gap stays visible.
- **Lowering background load is done.** ~358 s/hour → ~180 s/hour. It bought
  headroom, not confirmations.

So throughput must come from the crawl itself, and there are exactly two
candidate levers — both unmeasured.

### Unknown 1: concurrency is the untested axis

Apollo II ramped 6 → 120 req/min and was never blocked, but the *achieved* rate
flattened at **~28 req/min from tier 3 onward** regardless of target, because
each call takes ~2 s and every request was serial.

**Apollo II found our limit, not the source's.** Whether ten concurrent requests
from one IP look different to the source than ten sequential ones is the single
question standing between us and a throughput plan — and `parallel=True` is
already supported by the library and passed through by our scraper.

### Unknown 2: which shape confirms fastest

Apollo I measured a full county sweep returning **5,354 listings in 72 s**
(≈4,462 listings/minute) against ZIP recheck's observed **~45 listings/minute** —
a ~100× difference in *listings touched per unit time*. But that was never
converted into confirmations/hour under realistic pacing, and county queries
carry two known defects: ~1% silent marginal loss, and **total silent
misresolution** where the name form is wrong (`East Baton Rouge Parish, LA`
returns 8% of the county with no error).

## Global Constraints

- **Concurrency rises one step at a time, and the mission aborts on the first block.** This is the axis most likely to trigger one; treat every step as potentially the last.
- **Runs only from an operator-confirmed disposable IP**, never the production egress (`209.50.61.64`). Verify both before starting — Apollo II's Step 1 exists because blocking prod's egress would take the crawl down entirely.
- **Never grep for `403`/`429` to detect blocks.** ZIP codes contain those digits; that mistake produced a false "725 blocks" reading. Use structured status codes and exception types.
- **Hard budget: 1,200 estimated HTTP requests** for the whole mission (~1.7% of one day's production volume).
- **Reuse the Apollo I harness** (`Budget`, `Mission`, `run_probe`) — its rails are already tested. Concurrency is added *around* it, not by loosening it.
- **Record every attempt to JSONL before analysis**, so an abort still leaves evidence.
- **Read-only against prod Postgres.**

---

## Task 1: How much concurrency does the source tolerate?

**Files:**
- Create: `ops/probe/apollo3/concurrency.py`
- Create: `ops/probe/apollo3/results/concurrency.jsonl`

**Interfaces:**
- Produces: the maximum safe concurrency level, and what failure looks like when exceeded.

- [ ] **Step 1: Confirm the egress IP is disposable and is not production's.**

```bash
curl -s https://api.ipify.org
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 "curl -s https://api.ipify.org"
```

**If these match, stop.**

- [ ] **Step 2: Establish the serial baseline again on today's conditions**, so
      the concurrency numbers have a same-session comparison rather than being
      compared to Apollo II's figures from a different day: 20 ZIP scrapes,
      serial, record wall time and achieved req/min.

- [ ] **Step 3: Ramp concurrency one step at a time**, 20 scrapes at each level,
      with a 60 s cooldown between levels:

```
level 1 (serial baseline)
level 2
level 3
level 5
level 8
```

At each level record: achieved req/min, wall time, error count and **type**,
and whether success resumes after a pause. **Stop at the first structured block
signal** — that level minus one is the answer.

- [ ] **Step 4: Distinguish a throttle from a ban.** If blocked, retry a single
      serial request every 5 min for up to 2 h and record when it recovers. A
      30-second throttle and a 24-hour ban demand completely different crawl
      designs.

- [ ] **Step 5: Check production was unaffected throughout.** If prod's crawl
      degraded while only this IP pushed, the limit is account- or
      fingerprint-level rather than per-IP, **and every multi-node plan in the
      backlog is wrong**:

```bash
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 \
  "/opt/onepercent/ops/monitoring/crawl-health.sh"
```

- [ ] **Step 6: State the safe operating concurrency** as the highest clean level
      minus one, and convert it to confirmations/hour. Compare against the 3,267
      requirement. Commit — `probe(apollo3): source concurrency tolerance`

---

## Task 2: Which shape confirms the most listings per unit capacity?

**Files:**
- Create: `ops/probe/apollo3/shape_throughput.py`

**Interfaces:**
- Consumes: the safe concurrency from Task 1.
- Produces: confirmations/hour per shape, at safe concurrency.

- [ ] **Step 1: Define the unit honestly.** Not "listings returned" but
      **listings confirmed per hour of crawl capacity** — a listing is confirmed
      when a scrape returns it and the upsert bumps `last_seen_at`. A shape that
      returns 5,000 rows but takes 72 s must be compared against one returning
      250 rows in 3 s **on the same axis**.

- [ ] **Step 2: Measure each shape at safe concurrency**, 10 samples each:

| shape | what to record |
|---|---|
| ZIP `for_sale`, current params | rows, wall time, rows/minute |
| county full | rows, wall time, rows/minute, distinct ZIPs |
| county `updated_in_past_hours=24` | rows, wall time — *changes only, not confirmations* |

**The third is not a confirmation mechanism** — Apollo II established that an
incremental sweep never re-sees the unchanged, so it cannot advance
`last_seen_at` for a stable listing. Record it for completeness and label it
clearly, so nobody later mistakes change-detection throughput for confirmation
throughput.

- [ ] **Step 3: Compute the national picture for each shape.** Given 548,811
      active listings across ~24,000 ZIPs and ~3,143 counties, how many hours
      does one full confirmation sweep take at safe concurrency? Report as a
      table with the 7-day requirement (3,267/hr) marked.

- [ ] **Step 4: Fold in the county defects from Apollo II.** County shapes lose
      ~1% silently and misresolve entirely on ~1 in 5 names. **A shape that is
      faster but loses listings is not faster** — state the effective rate after
      accounting for the ZIP backstop those defects require.

- [ ] **Step 5: Recommend one architecture**, with the measurement that supports
      it and the risk that argues against it. Commit —
      `docs(probe): apollo3 findings — confirmations per hour by shape`

---

## Task 3: Does `past_days` unlimited change the arithmetic?

**Files:**
- Create: `ops/probe/apollo3/past_days_cost.py`

Production currently runs `SCRAPE_PAST_DAYS=90`. The rollout record
(`2026-08-past-days-rollout.md`) gates unlimited on a full crawl cycle, and that
decision is still open.

- [ ] **Step 1: Measure rows and cost at 30 / 90 / unlimited** for the same ten
      ZIPs. Apollo I measured ZIP 33020 at 89 (30 d) → 567 (unlimited); 90 d
      measured 257 in production. Establish the curve properly.

- [ ] **Step 2: Convert to requests.** More rows means more 200-row pages, so
      unlimited costs proportionally more requests per ZIP. Compute
      requests-per-confirmed-listing at each setting — **the cost that actually
      matters is per confirmation, not per ZIP.**

- [ ] **Step 3: Answer the open question with a number.** Does unlimited improve
      or worsen confirmations/hour? It adds inventory (good for coverage) while
      costing more requests per ZIP (bad for sweep rate). **Both effects are
      real and they oppose each other**; the rollout decision has been waiting on
      exactly this arithmetic.

- [ ] **Step 4: Commit** — `probe(apollo3): past_days cost per confirmed listing`

---

## Self-Review

**Spec coverage:** the mission answers precisely what the freshness work ran out
of road on — concurrency tolerance (T1), confirmations per hour by shape (T2),
and whether unlimited `past_days` helps or hurts the sweep rate (T3). Each was
left open by an earlier mission or plan, and each is a number rather than a
judgement.

**Placeholder scan:** every task names files, the exact ramp, and what to record.
T2 Step 1 defines the unit before measuring, because "listings returned" and
"listings confirmed per hour" differ by two orders of magnitude between shapes
and conflating them is how a county sweep gets mistaken for a confirmation
engine.

**Type consistency:** no new runtime contracts — the Apollo I harness
(`Budget`, `Mission`, `run_probe`, `ProbeResult`) is reused unchanged, so results
from all three missions share one schema and remain directly comparable.
