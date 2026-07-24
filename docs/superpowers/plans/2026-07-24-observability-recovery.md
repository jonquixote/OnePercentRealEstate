# Observability & Automated Recovery — We Notice Before the User Does

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On 2026-07-24 prod OOM'd and went fully dark, and the first signal was the **user noticing the site was down** — there was no alert, no health check, no automated snapshot cadence, and the deploy left broken features live (the sitemap 500'd in prod despite green unit tests). This plan closes the observability gap so incidents page us, not the user: host + service health with Telegram alerts (the alertmanager/Telegram credentials already exist in `.env`), a public health endpoint that actually exercises the DB, automated daily UpCloud snapshots with a monthly restore drill, and a post-deploy smoke gate that would have caught the sitemap regression before it counted as "done."

**Architecture:** A lightweight `oper-healthcheck` timer probes host memory/disk + every `oper-*` unit + the live HTTP surfaces, and pushes to the existing alertmanager → Telegram path (`TELEGRAM_BOT_TOKEN`, `ALERTMANAGER_TELEGRAM_CHAT_ID` are already in `.env`) on threshold breach or service-down. A `upctl storage backup` cron gives daily snapshots with retention. The deploy script gains a `--smoke` post-step that curls the real surfaces (`/api/health`, `/sitemap.xml` is-XML, `/robots.txt`, a property title) and fails loudly, so a green unit suite can never again mask a prod-500.

**Tech Stack:** systemd timers, bash, `upctl`, the existing alertmanager config (`ops/systemd/gen-alertmanager.sh`), Telegram Bot API, Postgres. No app rewrite; one small `/api/health` hardening.

## Global Constraints

- **Reuse the existing alert transport** — `gen-alertmanager.sh` + the Telegram creds already in `.env`; do NOT introduce a new paging vendor.
- **Alerts must be actionable + deduped** — every alert names the box, the failing check, and the value vs threshold; a flapping check must not spam (cooldown).
- **Health checks are cheap and safe** — read-only, short-timeout, never a heavy aggregation (a health probe must not itself cause load).
- **Snapshots never delete the newest N** — retention prunes oldest only, and never drops below 3 kept.
- **The smoke gate is fail-closed** — a failed post-deploy smoke marks the deploy failed (non-zero exit), but does not auto-rollback (human decides).
- **No secrets in git** — Telegram token stays in `.env`/`/etc/oper.env`; scripts read it from the environment.
- **Verification is behavioral** — trip each alert on purpose and confirm the Telegram message arrives; break a surface and confirm the smoke gate fails.

## Current State (verified 2026-07-24)

- `.env` already carries `TELEGRAM_BOT_TOKEN` and `ALERTMANAGER_TELEGRAM_CHAT_ID`; `ops/systemd/gen-alertmanager.sh` regenerates alertmanager config on deploy. Alertmanager is configured but **nothing feeds it host/service health** — the OOM produced no alert.
- No host healthcheck unit; no automated snapshots (the only snapshot exists because it was taken by hand during the rescue).
- `/api/health` + `/api/healthz` exist (return 200) — confirm whether they actually touch the DB or just return static OK.
- The deploy script (`ops/systemd/deploy-systemd.sh`) ends at "Deploy complete" with a unit-status list — no functional smoke test. The sitemap 500'd in prod while unit tests were green (fixed in #68/#69) — exactly the gap a smoke gate closes.
- `documentation/operations/wave-7-open-items.md` still lists "pg_dump → B2 offsite not wired" and "first DR drill" as open.

## File Structure

| File | Responsibility |
|---|---|
| `ops/monitoring/healthcheck.sh` (create) | Probe mem/disk/units/HTTP; emit alerts on breach. |
| `ops/systemd/oper-healthcheck.service` + `.timer` (create) | Run the probe every 2 min. |
| `ops/monitoring/notify-telegram.sh` (create) | Dedup'd Telegram push (reads token from env). |
| `apps/one/src/app/api/health/route.ts` (modify) | Health actually runs `SELECT 1` + reports DB/redis reachability + build id. |
| `ops/monitoring/snapshot-cron.sh` (create) + `oper-snapshot.timer` (create) | Daily `upctl storage backup` + retention prune. |
| `ops/systemd/deploy-systemd.sh` (modify) | Add a fail-closed `smoke_test()` post-step. |
| `documentation/operations/monitoring.md` (create) | What's watched, thresholds, how to silence, restore-drill steps. |

---

## Task 1: Health endpoint that tells the truth

**Files:** modify `apps/one/src/app/api/health/route.ts` (+ test).

- [ ] **Step 1: Failing test** — `/api/health` returns `{ status, db, redis, buildId, uptimeMs }`; `db` is `'up'` only when a `SELECT 1` succeeds within a short timeout, `'down'` (and overall `status: 'degraded'`, HTTP 503) when the query throws; a healthy mock → 200 `status: 'ok'`.
- [ ] **Step 2: RED → implement.** Cheap `SELECT 1` with a 2s timeout, a redis PING (best-effort), read `NEXT_PUBLIC_*`/BUILD_ID for `buildId`. Never throw — always return a JSON verdict + correct status code.
- [ ] **Step 3: Suite + typecheck; commit** — `feat(health): /api/health exercises DB+redis, 503 on degraded`

## Task 2: Telegram notifier (deduped)

**Files:** create `ops/monitoring/notify-telegram.sh`.

- [ ] **Step 1:** Script reads `TELEGRAM_BOT_TOKEN`/`ALERTMANAGER_TELEGRAM_CHAT_ID` from env, POSTs a message to the Bot API; a `--key <id>` + a state file (`/run/oper-alerts/<key>`) suppresses re-sending the same firing alert within a cooldown (e.g. 30 min) and sends a single "RESOLVED" when the key clears.
- [ ] **Step 2: Verify** — `notify-telegram.sh --key test "hello from prod"` delivers to the chat; a second immediate call with the same key is suppressed; commit — `feat(monitoring): deduped Telegram notifier reading existing creds`

## Task 3: Host + service healthcheck timer

**Files:** create `ops/monitoring/healthcheck.sh`, `ops/systemd/oper-healthcheck.service` + `.timer`.

- [ ] **Step 1:** `healthcheck.sh` checks: memory available < 10% (the OOM signal), swap used > 75%, disk `/` > 85%, each `oper-*` unit `is-active`, `curl -m5 http://127.0.0.1:3001/api/health` status==ok, and `oper-two`/scraper reachability. Each breach → `notify-telegram.sh --key <check> "<box>: <check> <value> vs <threshold>"`; recovery clears the key.
- [ ] **Step 2:** `.timer` every 2 min (`OnUnitActiveSec=120`), `.service` `Type=oneshot`, `EnvironmentFile=/etc/oper.env`; install into the deploy's unit list + `ALL_UNITS`.
- [ ] **Step 3: Prove it** — stop a non-critical unit (`oper-worker-media`) → within one tick a Telegram alert fires naming it; start it → a RESOLVED message. Simulate memory pressure → the mem-available alert fires. Commit — `feat(monitoring): host+service healthcheck timer → Telegram (OOM would now page us)`

## Task 4: Automated snapshots + retention

**Files:** create `ops/monitoring/snapshot-cron.sh`, `ops/systemd/oper-snapshot.service` + `.timer`.

- [ ] **Step 1:** `snapshot-cron.sh` runs `upctl storage backup create <prod-bootdisk> --title oper-auto-$(date +%F)`; then prunes backups titled `oper-auto-*` older than N days but always keeps ≥3 newest. On failure → Telegram alert.
- [ ] **Step 2:** `.timer` daily off-peak; `.service` oneshot with the `upctl` config available (reads the account token from a root-only file — never git).
- [ ] **Step 3: Verify** — a manual run creates a dated backup (`upctl storage list` shows it) and prunes correctly on a seeded set; commit — `feat(monitoring): daily UpCloud snapshots + retention (keep ≥3)`

## Task 5: Post-deploy smoke gate

**Files:** modify `ops/systemd/deploy-systemd.sh`.

- [ ] **Step 1:** Add `smoke_test()` run after restarts: assert `curl -m5 127.0.0.1:3001/api/health` → `status:ok`; `/sitemap.xml` returns `content-type: *xml* + <urlset`; `/robots.txt` 200 with `Disallow`; a known `/property/<id>` title is non-generic; `oper-two` `/` 200. Any failure → non-zero exit + a Telegram alert; print which check failed.
- [ ] **Step 2: Prove it** — temporarily break a surface (e.g. point the sitemap check at a bad path) → the deploy exits non-zero and alerts; restore → deploy passes. (This is exactly the sitemap-500 class of bug that shipped green.) Commit — `feat(ops): fail-closed post-deploy smoke gate (catches prod-only regressions)`

## Task 6: Restore drill + docs

**Files:** create `documentation/operations/monitoring.md`; update `wave-7-open-items.md`.

- [ ] **Step 1: Monthly restore drill** — documented steps to restore the latest `oper-auto-*` snapshot to a throwaway box, verify `SELECT count(*) FROM listings`, and delete it — proving backups are actually restorable (the DR-drill open item).
- [ ] **Step 2: Docs** — `monitoring.md`: every check + threshold, how to silence during maintenance, the snapshot cadence/retention, and the smoke-gate surfaces. Tick off the "DR drill" + "offsite backup cadence" open items.
- [ ] **Step 3:** Commit — `docs(ops): monitoring reference + monthly restore-drill runbook`

## Self-Review

**Spec coverage:** an OOM/service-down now pages us via the existing Telegram path before the user notices (T1–T3) · backups happen automatically and are proven restorable (T4, T6) · a prod-only regression like the sitemap 500 is caught at deploy, not by users (T5). Each task trips its own alarm to prove it works. Covered.

**Placeholder scan:** every task names exact files, thresholds, and a behavioral proof (trip the alert, break a surface, restore a snapshot). Reuses the existing alertmanager/Telegram creds rather than inventing transport.

**Type consistency:** `/api/health` returns one `{ status, db, redis, buildId, uptimeMs }` shape consumed by the healthcheck probe (T3) and the smoke gate (T5); alert keys are the shared dedup identifier across notifier/healthcheck/snapshot.
