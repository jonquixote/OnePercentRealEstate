# Deploy & Config Safety — Catch It Before Prod

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In one session, three separate deploy/config bugs reached production — and one hid for hours. (1) `systemd-run --scope -p Nice=10` is invalid; it aborted the build step of **every** deploy silently, so the app ran stale code for hours while "deploys" appeared to run. (2) `gen-env.sh` pointed `DATABASE_URL` at PgBouncer `:6432` while PgBouncer was down → **app db-down on prod**. (3) The smoke gate raced app startup and mis-classified the scraper's normal `404` as down. Green unit tests + a clean `git merge` said nothing about any of these — they are deploy-time and config-time failures. This plan builds the safety net that would have caught all three before they touched prod: shellcheck + a systemd-unit/config linter in CI, a deploy **preflight** that validates the environment against reality (does `DATABASE_URL`'s port actually listen?), and a readiness-gated, self-verifying deploy that fails loud and early.

**Architecture:** CI gains a `ops-lint` job — `shellcheck` every `ops/**/*.sh`, `systemd-analyze verify` every unit file, and a `pgbouncer -R`/config parse — so an invalid `-p Nice=` or a malformed unit fails the PR, not the box. The deploy script gains a `preflight()` that runs before any build/restart: it validates that each service's resolved `DATABASE_URL` host:port is actually listening, that `systemd-run` accepts the build scope's properties (a dry `--scope true`), and that required env keys exist — aborting with a clear message instead of half-deploying. The existing smoke gate (already hardened this session with a readiness wait + honest scraper check) is documented as the last gate. Nothing changes about what the app does.

**Tech Stack:** GitHub Actions, `shellcheck`, `systemd-analyze verify`, bash, the existing `deploy-systemd.sh` + `gen-env.sh`. No app code.

## Global Constraints

- **CI must fail on a real ops defect** — a shellcheck error (not just style), an unverifiable unit, or an invalid systemd property fails the PR. Warnings are surfaced but a curated set is errors (e.g. SC2086 in a destructive path).
- **Preflight is fail-closed and runs BEFORE mutation** — it aborts the deploy before `gen-env`/build/restart if config is inconsistent with the running system (the class of the `:6432`-with-pgbouncer-down bug).
- **No false confidence** — preflight validates against *reality* (is the port listening? does the scope property parse?), not just that a variable is non-empty.
- **Idempotent + local-runnable** — every check runs the same locally (`ops/ci/ops-lint.sh`) as in CI, so contributors catch it pre-push.
- **No secrets in CI logs** — config checks print keys/ports, never values.
- **Don't block on transient** — preflight distinguishes "misconfigured" (abort) from "a dependency is briefly restarting" (retry a bounded number of times).
- **Tests:** the lint/preflight scripts have shell test fixtures (a known-bad unit fails, a known-good passes).

## Current State (verified 2026-07-24)

- `ops/systemd/deploy-systemd.sh`: builds under a memory-capped `systemd-run --scope` (the `-p Nice=` bug — now fixed), restarts units, runs a fail-closed `smoke_test()` (health/sitemap/robots/two/scraper/property) — hardened this session with an app-readiness wait + honest scraper check.
- `gen-env.sh`: generates `/etc/oper.env` + role env files from `.env`; no validation that the URLs it emits point at live services (the `:6432` bug).
- CI has `test` (vitest) + `migrations-dry-run` + Vercel preview. **No shell/unit linting** — the `-p Nice=` and shell-quoting bugs sail through.
- ~10 `ops/**/*.sh` scripts (deploy, harden-memory, healthcheck, snapshot, persist-ssh-key, rescue, pgbouncer setup, gen-env, gen-alertmanager) + ~20 systemd unit files, none linted in CI.
- Deploys are manual (`ssh … deploy-systemd.sh`); a silently-failing build produced no alert (the smoke gate now catches a bad *outcome*, but not a build that never restarted).

## File Structure

| File | Responsibility |
|---|---|
| `ops/ci/ops-lint.sh` (create) | shellcheck all `ops/**/*.sh` + `systemd-analyze verify` all units + parse pgbouncer.ini; local-runnable. |
| `.github/workflows/ops-lint.yml` (create) | CI job running `ops-lint.sh` on any `ops/**` or `.github/**` change. |
| `ops/systemd/deploy-systemd.sh` (modify) | Add `preflight()` (config-vs-reality validation) before build; assert build never silently skips restart. |
| `ops/ci/preflight.sh` (create) | The reusable checks: URL host:port listening, systemd-run props parse, required env keys present. |
| `ops/ci/fixtures/` (create) | A known-bad unit + a known-bad script so the linter's own behavior is tested. |
| `documentation/operations/deploy-safety.md` (create) | What each gate catches, how to run locally, the incident→control map. |

---

## Task 1: Ops lint in CI (shell + units)

**Files:** create `ops/ci/ops-lint.sh`, `.github/workflows/ops-lint.yml`, `ops/ci/fixtures/*`.

- [ ] **Step 1: Failing fixture** — add `ops/ci/fixtures/bad.service` (invalid directive) + `ops/ci/fixtures/bad.sh` (a shellcheck-error, e.g. unquoted `rm $x`); assert the linter exits non-zero on them.
- [ ] **Step 2: Implement `ops-lint.sh`** — `shellcheck -x` every `ops/**/*.sh` (error-level curated); `systemd-analyze verify` every `ops/systemd/*.service` + `*.timer`; `pgbouncer -R` or an ini parse for `pgbouncer.ini`. Non-zero on any error; runs locally + in CI identically.
- [ ] **Step 3:** `ops-lint.yml` triggers on `ops/**` / `.github/**` changes. Verify it FAILS on the fixtures, PASSES on the real (now-fixed) scripts — proving it would have caught the `-p Nice=` bug (add a regression fixture that includes an invalid `systemd-run` property parse). Commit — `feat(ci): ops-lint — shellcheck + systemd-analyze verify (would have caught the Nice= build bug)`

## Task 2: Deploy preflight — config vs reality

**Files:** create `ops/ci/preflight.sh`; modify `ops/systemd/deploy-systemd.sh`.

- [ ] **Step 1: `preflight.sh` checks** (each prints PASS/FAIL + reason):
  - For every generated env file, the `DATABASE_URL` (and `_DIRECT`) host:port is actually `LISTEN`ing (`ss -tln`) — the check that would have caught `:6432`-with-pgbouncer-down.
  - `REDIS_URL` port listening.
  - The build scope's systemd properties parse: `systemd-run --scope -p MemoryMax=6G -p MemoryHigh=5G true` succeeds (dry) — catches an invalid `-p`.
  - Required env keys present + non-placeholder (`STRIPE_*` optional, `POSTGRES_PASSWORD`/`AUTH_SECRET` required).
- [ ] **Step 2:** `deploy-systemd.sh` calls `preflight` right after `gen-env` and BEFORE `build_node`/restarts; a FAIL aborts with a non-zero exit and a clear message — no half-deploy. A dependency mid-restart gets a bounded retry (not an instant abort).
- [ ] **Step 3: Prove it** — temporarily point `DATABASE_URL` at a dead port → preflight aborts the deploy with "DATABASE_URL localhost:6432 not listening"; restore → deploy proceeds. Commit — `feat(ops): deploy preflight validates config against the running system (fail-closed)`

## Task 3: Build-actually-restarted assertion

**Files:** modify `ops/systemd/deploy-systemd.sh`.

- [ ] **Step 1:** After `build_node`, assert the standalone server bundle was freshly written (mtime newer than deploy start) AND, after restart, each target unit's `ActiveEnterTimestamp` is newer than deploy start — so a build that silently produces nothing (or a restart that no-ops) FAILS loudly. (The `-p Nice=` bug produced "deploys" that never restarted; this makes that impossible to miss.)
- [ ] **Step 2:** On failure → Telegram alert (reuse `notify-telegram.sh`) + non-zero exit.
- [ ] **Step 3: Verify** — a normal deploy passes; a simulated no-op build (skip the build) trips the assertion. Commit — `feat(ops): assert build rebuilt + units actually restarted (catch silent-noop deploys)`

## Task 4: Document the safety net

**Files:** create `documentation/operations/deploy-safety.md`.

- [ ] **Step 1:** The incident→control map: for each 2026-07-24 failure (`-p Nice=`, `:6432`-down, smoke race, scraper-404), the gate that now catches it. How to run `ops-lint.sh` + `preflight.sh` locally. The deploy's full gate order (preflight → build → restart-assert → smoke).
- [ ] **Step 2:** Commit — `docs(ops): deploy-safety net + incident→control map`

## Self-Review

**Spec coverage:** the invalid systemd property is caught in CI (T1) · a config-vs-reality mismatch (URL at a dead port) aborts before mutation (T2) · a build that silently doesn't restart fails loud (T3) · every 2026-07-24 failure maps to a control (T4). The three bugs that reached prod this session each have a gate. Covered.

**Placeholder scan:** every task names exact files + a behavioral proof (bad fixture fails, dead-port aborts, no-op build trips the assert); no "add validation" hand-waves — the specific checks are enumerated.

**Type consistency:** N/A (ops/CI); `ops-lint.sh` and `preflight.sh` are the shared entry points, invoked identically in CI and locally, and by the deploy script for preflight.
