# Crawl Productivity SLOs — Alert on Work Done, Not Just Processes Alive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On 2026-07-24 the crawl produced **zero listings for ~10 hours** and nothing alerted. Every monitor was green the entire time, because every monitor asks *"is the process alive?"* — and `oper-worker` was alive, dutifully failing 100% of its scrapes (290 consecutive errors, 0 ok) and re-pending the same job forever. The gap is categorical: we monitor **liveness**, never **productivity**. This plan adds the missing half — data-freshness, throughput, and endpoint-health SLOs that alert on *work not being done* — plus a self-healing scraper pool so a single dead endpoint can never again take the whole crawl down, and restores the second scraper IP that the backlog needs.

**Architecture:** Extend the existing `healthcheck.sh` (2-min timer → deduped Telegram) with productivity probes that read the DB and the worker's own metrics rather than `systemctl is-active`: listings-seen freshness, crawl-job completion rate, pending-backlog trend, and per-endpoint scraper health. The worker's AIMD pool gains **fail-away**: an endpoint with a sustained 100% error rate is dropped from rotation (and reported) so a healthy endpoint keeps serving; the pool refuses to end up empty by falling back to the local scraper. `preflight.sh` gains a scraper-pool reachability check so a dead pool can't ship. Finally, the detached scraper box — currently locked out (no SSH key, same failure as the main box) — is rescued to restore the 2-IP pool.

**Tech Stack:** bash + systemd timers, the existing `notify-telegram.sh`, Postgres (`listings`, `crawl_jobs`), `apps/worker/src/crawl.ts` (AIMD pool), `ops/ci/preflight.sh`, UpCloud `upctl` for the box rescue.

## Global Constraints

- **Alert on symptoms users would feel, not on every wobble.** A freshness alert fires only after a sustained gap (default 45 min) so ordinary between-job quiet does not page. Every alert reuses the existing dedup/cooldown (`notify-telegram.sh --key`).
- **Scraper politeness is inviolable.** Nothing here raises request rate, shortens `CRAWL_JOB_MIN_INTERVAL_MS`, or removes jitter/cool-off. Throughput improves only by restoring the second IP, never by crawling harder per IP.
- **The pool must never be empty.** Fail-away may drop unhealthy endpoints but must always leave at least one (falling back to the local scraper), and must log/alert when it degrades.
- **No new alert transport** — the existing alertmanager/Telegram path only.
- **Thresholds live in one place** (env-overridable) and are documented, so tuning does not mean editing logic.
- **Every alert must be provable**: each task ends by *causing* the condition and observing the Telegram message.
- **Tests:** `pnpm --filter @oper/worker test` for pool logic; shell checks via `ops/ci/ops-lint.sh`.

## Current State (verified 2026-07-24/25 on prod `209.50.61.64`)

- **The incident:** `SCRAPER_URLS` never reached `/etc/oper.env` (gen-env's deny-list matched `^SCRAPER_URL` as a prefix), so the pool fell back to the single `SCRAPER_URL` = the detached box, unreachable since the rescue. Result: 0 ok / 290 errors, ~10h of zero listings, 44,470 jobs pending. Fixed (PR #82) by emitting `SCRAPER_URLS` explicitly with a local-scraper default.
- **What monitoring covered:** `healthcheck.sh` checks exactly `disk-root, http-app, http-scraper, http-two, mem-available, swap-used` + `systemctl is-active` per unit. **Nothing observes listings, crawl jobs, or scraper success rate.** `oper-worker` stayed `active` throughout, so no alert fired.
- **Post-fix throughput (single endpoint):** 13 crawl jobs / 10 min (~78/hr), 273 listings / 10 min (~1,640/hr). Backlog: **44,464 pending** → ~24 days to drain at this rate.
- **The second IP is gone:** the detached scraper box (`152.44.44.224` / mesh `10.8.3.41`, UUID `003b3b44`) is running and pingable but nothing listens on `:80`, and it **rejects the deploy SSH key** — the same lockout the main box had; it was never rescued. Trial account is at its 24GB memory cap, so a rescue needs the stop→create dance.
- The worker already implements per-endpoint AIMD (`ok/blocked/error`, `interval_ms`, `ready_in_ms`) and logs `scraper endpoint metrics` every 30s — the signal exists, nothing consumes it.
- `preflight.sh` validates DB/Redis ports but not the scraper pool.

## File Structure

| File | Responsibility |
|---|---|
| `ops/monitoring/crawl-health.sh` (create) | Productivity probes: freshness, completion rate, backlog trend, endpoint health → Telegram. |
| `ops/systemd/oper-crawl-health.service` + `.timer` (create) | Run the probes every 10 min. |
| `apps/worker/src/crawl.ts` (modify) | Pool fail-away + never-empty guarantee + a degraded-pool log line. |
| `apps/worker/src/crawl.test.ts` (modify/create) | Unit tests for fail-away and the never-empty invariant. |
| `ops/ci/preflight.sh` (modify) | Assert every `SCRAPER_URLS` endpoint answers before deploying. |
| `documentation/operations/crawl-runbook.md` (create) | The SLOs, thresholds, what each alert means, and how to respond. |

---

## Task 1: Crawl productivity probes

**Files:** create `ops/monitoring/crawl-health.sh`, `ops/systemd/oper-crawl-health.service` + `.timer`.

- [ ] **Step 1:** Probes (each a `notify-telegram.sh --key` alert with a RESOLVED on recovery), thresholds env-overridable:
  - **Freshness** — `SELECT max(last_seen_at) FROM listings`; alert if older than `CRAWL_FRESH_MAX_MIN` (default 45). *This is the check that would have caught the 10-hour outage.*
  - **Completion rate** — crawl jobs whose `updated_at`/status moved to `completed` in the last hour; alert if `0` while `pending > 0` (work available but none done).
  - **Backlog trend** — `pending` count; alert if it grows for 3 consecutive probes while completions are 0 (distinguishes "busy" from "stuck").
  - **Endpoint health** — parse the worker's `scraper endpoint metrics` journal lines; alert when an endpoint shows `ok=0` with `error>0` over the window (per-endpoint key so a single dead endpoint is named).
- [ ] **Step 2:** `.timer` every 10 min; add both units to the deploy `ALL_UNITS` + `install.sh`.
- [ ] **Step 3: Prove each alert** — stop `oper-scraper` (or point the pool at a dead port) and confirm within two probes that Telegram receives the freshness + endpoint alerts naming the endpoint; restore and confirm the RESOLVED. Commit — `feat(monitoring): crawl productivity SLOs — freshness, throughput, backlog, endpoint health`

## Task 2: Self-healing scraper pool

**Files:** modify `apps/worker/src/crawl.ts` (+ tests).

- [ ] **Step 1: Failing tests** — given a pool of two endpoints where one returns errors on every attempt: after `POOL_FAILAWAY_STREAK` (default 10) consecutive failures the endpoint is skipped for `POOL_FAILAWAY_COOLOFF_MS`, all traffic goes to the healthy one, and a `scraper pool degraded` line names the dropped endpoint. Given a pool where **every** endpoint is unhealthy: the pool still returns an endpoint (never empty) and logs that it is running degraded — the crawl must keep trying, not deadlock.
- [ ] **Step 2: RED → implement** in the existing AIMD structure (it already tracks per-endpoint `ok/error`): add the consecutive-failure counter, the skip window, and the never-empty fallback to the local scraper. Do **not** change pacing/politeness for healthy endpoints.
- [ ] **Step 3:** Worker suite + typecheck; commit — `feat(crawl): pool fails away from dead endpoints and can never be empty`

## Task 3: Preflight covers the scraper pool

**Files:** modify `ops/ci/preflight.sh`.

- [ ] **Step 1:** Read `SCRAPER_URLS` (falling back to `SCRAPER_URL`) from the env file, split on commas, and for each endpoint assert it answers HTTP (any status — a 404 on `/` is fine, a connection failure is not). **FAIL if none answer**; **WARN (not fail) if some do**, naming the dead ones — a partially-degraded pool should still be deployable.
- [ ] **Step 2: Prove it** — point `SCRAPER_URLS` at a dead endpoint only and confirm preflight aborts the deploy; restore and confirm it passes. Commit — `feat(ops): preflight asserts the scraper pool has a reachable endpoint`

## Task 4: Restore the second scraper IP

- [ ] **Step 1: Decide + record** — the detached box (`003b3b44`) is locked out exactly like the main box was. Rescue it with the proven snapshot procedure (`documentation/operations/prod-rescue-runbook.md`): snapshot its disk → (user, via `!`) stop it → `upctl server create --os <snapshot> --enable-metadata --ssh-keys …` at its 4GB plan → verify SSH + the scraper service → re-add its mesh address to `SCRAPER_URLS`. Note the trial memory cap: the replacement can only be created after the old one stops.
- [ ] **Step 2:** Once reachable, ensure the scraper unit is enabled (`systemctl enable --now`) so a reboot restores it without hands, and run `ops/resilience/persist-ssh-key.sh` on it so this lockout cannot recur.
- [ ] **Step 3: Verify** — `SCRAPER_URLS` holds both endpoints, the worker's metrics show `ok>0` on both, and crawl-job throughput measurably rises vs the single-endpoint baseline (78 jobs/hr). Commit — `ops(crawl): restore the second scraper IP (2-endpoint pool) + key persistence`

## Task 5: Runbook + backlog expectations

**Files:** create `documentation/operations/crawl-runbook.md`.

- [ ] **Step 1:** Document each SLO, its threshold and env var, what the alert means, and the first three things to check (endpoint metrics → pool config in `/etc/oper.env` → scraper service on each box). Include the 2026-07-24 incident as the worked example.
- [ ] **Step 2:** Record the measured drain math: at ~78 jobs/hr a 44k backlog takes ~24 days on one endpoint; state what the 2-IP pool measures at, and note that the answer to a growing backlog is **more IPs, never a faster per-IP rate**.
- [ ] **Step 3:** Commit — `docs(ops): crawl runbook — SLOs, thresholds, incident response, drain math`

## Self-Review

**Spec coverage:** the exact 10-hour silent outage is now caught within ~45 min by a freshness SLO, with throughput/backlog/endpoint alerts naming the cause (T1) · a single dead endpoint can no longer stall the crawl (T2) · a dead pool cannot ship (T3) · the lost second IP — the actual throughput constraint — is restored and made reboot-durable (T4) · responders get thresholds and drain math instead of guesswork (T5). Covered.

**Placeholder scan:** every task names exact files, concrete thresholds with defaults, and a behavioral proof that *causes* the alert. The one operator-gated step (stopping a server, trial-quota constrained) is called out with the exact `upctl` flow and its `!` requirement.

**Type consistency:** probe alert keys are the shared identifier across `crawl-health.sh` and `notify-telegram.sh` dedup; `SCRAPER_URLS` (comma-separated, local-scraper default) is the single pool definition consumed by the worker, preflight, and the runbook — no second source of endpoint truth.
