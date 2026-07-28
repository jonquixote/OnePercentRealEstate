# Density-Normalised Crawl Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it possible to tell whether a crawl change helped. Right now it is not, and three conclusions have already been lost to the same confound.

**Architecture:** Add the two things missing from every crawl comparison so far — a normalised unit that is not a function of which ZIPs happened to be crawled, and a same-ZIP A/B harness for changes where normalisation is not enough. Then re-run the one open question that a bad measurement left unanswered.

**Tech Stack:** PostgreSQL 16, `apps/worker`, bash ops probes.

## Why this exists

Three conclusions this project reached from comparing crawl metrics across time
windows. Two are now known false, and the third is unverified:

| claim | status |
|---|---|
| "County sweeps are ~100× more efficient than ZIP recheck" | **false** — compared a raw scrape rate to an end-to-end job rate |
| "Raising WORKER_CONCURRENCY doubled job duration, cancelling the parallelism" | **false** — an 11→18 rows/job density shift between windows |
| "WORKER_CONCURRENCY=2 helps / does not help" | **unknown** — never measured density-normalised |

The mechanism, measured 2026-07-28:

| rows returned by a job | n | p50 duration |
|---|---|---|
| 0 | 140 | 6,934 ms |
| 1–49 | 371 | 12,099 ms |
| 50–199 | 99 | **52,375 ms** |
| 200+ | 2 | **144,795 ms** |

**A dense ZIP takes ~20× longer than an empty one.** Any two time windows differ
in ZIP mix, so any duration or throughput delta between them is dominated by
that mix rather than by whatever was changed.

Worse, this is not merely academic: a second uvicorn worker was added to the
scraper on the strength of one of these false conclusions, and only reverted
because the box was checked afterwards and found 75% idle.

## Global Constraints

- **No metric may be reported that is a function of ZIP mix.** If it cannot be normalised, it must be same-ZIP.
- **The normalised unit must be cheap to compute.** A probe that costs more than what it protects is a mistake already made here (9.65 s seq scan, twice an hour).
- **Do not remove the raw counters.** Confirmations/hour and jobs/hour stay — they answer "is the crawl alive". The normalised unit answers "did the change help". Different questions.
- **A/B must not reduce coverage.** The harness reuses ZIPs that were due anyway; it must not spend budget crawling ZIPs twice for measurement's sake.
- Latency budgets in `docs/perf/perf-budgets.md` bind.

---

## Task 1: A unit that is not a function of ZIP mix

**Files:**
- Modify: `ops/monitoring/crawl-throughput.sh`
- Create: `docs/perf/2026-08-normalised-crawl-units.md`

**Interfaces:**
- Produces: `ms_per_row` and `rows_per_job_hour`, reportable per window and comparable across windows.

- [ ] **Step 1: Establish the candidate units and check each against the confound.**

  - `ms_per_row` = `sum(duration_ms) / sum(rows_returned)` — the cost of doing
    work, independent of how much work a ZIP happened to hold.
  - `zips_per_hour` — already added; density-independent by construction.
  - **Rejected:** `avg(duration_ms)`, `confirmations/hour`, `jobs/hour` — all
    move with ZIP mix.

- [ ] **Step 2: Verify the unit is actually stable across density bands.** This
      is the test of whether the normalisation works:

```sql
SELECT CASE WHEN rows_returned = 0 THEN '0'
            WHEN rows_returned < 50 THEN '1-49'
            WHEN rows_returned < 200 THEN '50-199' ELSE '200+' END AS band,
       count(*) n,
       round(sum(duration_ms)::numeric / NULLIF(sum(rows_returned),0), 1) AS ms_per_row
  FROM crawl_jobs
 WHERE finished_at > now()-interval '24 hours' AND duration_ms IS NOT NULL
 GROUP BY 1 ORDER BY 1;
```

**If `ms_per_row` varies wildly across bands, it has not removed the confound** —
there is a fixed per-job cost that dominates sparse ZIPs. In that case model it
as `duration = fixed + per_row × rows` and report the two coefficients instead.
**Do not ship a unit that has not been shown to be stable.**

- [ ] **Step 3: Add the stable unit to `crawl-throughput.sh`**, alongside the
      existing lines rather than replacing them.

- [ ] **Step 4: Write the units doc** stating which metrics are comparable across
      windows and which are not, so the next person does not repeat this. Commit —
      `feat(monitoring): density-normalised crawl units`

---

## Task 2: A same-ZIP A/B harness

**Files:**
- Create: `ops/db/crawl-ab.sh`

**Interfaces:**
- Produces: before/after measurements over an identical ZIP set.

Normalisation handles cost-per-row. It does not handle changes whose effect is
*non-linear* in density — concurrency being the obvious one, since contention
appears only when several dense ZIPs coincide.

- [ ] **Step 1: Pick a fixed, representative ZIP panel** spanning the density
      bands from Task 1 Step 2 — a few dozen ZIPs, recorded to disk so every run
      uses the same set. **A panel drawn fresh each run reintroduces the
      confound.**

- [ ] **Step 2: Crawl the panel under configuration A**, recording per-ZIP
      duration and rows.

- [ ] **Step 3: Change one variable, crawl the same panel**, record again.

- [ ] **Step 4: Compare per ZIP, not in aggregate** — paired, so each ZIP is its
      own control. Report the distribution of per-ZIP deltas, not just a mean.

- [ ] **Step 5: Confirm the harness does not waste budget** — it should crawl
      ZIPs that were due anyway, and its jobs should be tagged so they can be
      excluded from throughput accounting.

- [ ] **Step 6: Commit** — `feat(ops): same-ZIP A/B harness for crawl changes`

---

## Task 3: Answer the question the bad measurement left open

**Files:**
- Create: `docs/perf/2026-08-concurrency-ab-result.md`

`WORKER_CONCURRENCY=2` with a 10 s gate is live in production and **nobody knows
whether it helps.** The claim that it was cancelled out has been withdrawn; no
replacement measurement exists.

- [ ] **Step 1: Run the Task 2 harness** with `WORKER_CONCURRENCY` at 1 and at 2,
      same panel, same day, alternating order to cancel time-of-day effects.

- [ ] **Step 2: Report the paired per-ZIP result** and state plainly whether
      concurrency 2 helps, hurts, or is neutral.

- [ ] **Step 3: Act on the answer.** If neutral or harmful, revert to 1 — a
      setting that does not help is not free, because it raises block exposure
      (the source blocks at 3, so 2 sits closer to the edge than 1).

- [ ] **Step 4: Re-examine the two withdrawn conclusions** with the harness if
      they still matter, particularly whether a county-shaped sweep confirms
      faster than ZIP recheck on the same panel.

- [ ] **Step 5: Commit** — `docs(perf): concurrency A/B — the measured answer`

---

## Self-Review

**Spec coverage:** the confound is addressed both ways it manifests — linear cost
differences via normalisation (T1) and non-linear contention via same-ZIP pairing
(T2) — and the open question that motivated the work is then answered (T3). T1
Step 2 can reject its own unit, which matters: shipping a normalisation that does
not normalise would be worse than the current state, because it would look
trustworthy.

**Placeholder scan:** every step names files, exact SQL, and a stop condition.
The panel size and composition are deliberately derived from T1's density bands
rather than asserted here.

**Type consistency:** no new runtime contracts; both additions are ops scripts
reading `crawl_jobs`, whose `rows_returned` / `duration_ms` / `rows_confirmed`
columns already exist from the observability work.
