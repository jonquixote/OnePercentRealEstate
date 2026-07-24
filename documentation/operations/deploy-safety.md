# Deploy Safety Net

Green unit tests and a clean merge say **nothing** about deploy-time correctness.
On 2026-07-24 four ops/config defects reached production while CI stayed green —
one of them hid for hours. This document describes the gates that now stand
between a commit and a broken production box.

## 1. Incident → control map

| # | What went wrong (2026-07-24) | Blast radius | Control that now catches it | Where |
|---|---|---|---|---|
| 1 | `systemd-run --scope -p Nice=10` — `Nice` is an exec property, invalid on a transient scope. systemd answered `Unknown assignment: Nice=10` and the build step aborted. | **Every deploy silently failed to rebuild for hours**; the app served stale code while deploys reported success. | **ops-lint** scope-property allowlist (static, CI) **+ preflight** dry `systemd-run --scope` (runtime) **+ rebuild assertion** (would have failed the deploy). | `ops/ci/ops-lint.sh`, `ops/ci/preflight.sh`, `assert_rebuilt_and_restarted()` |
| 2 | `gen-env.sh` wrote `DATABASE_URL=…:6432` (PgBouncer) while PgBouncer was **not installed**. | **App down**: health 503, `db: down`, empty sitemap. | **preflight** — every `DATABASE_URL`/`DATABASE_URL_DIRECT`/`REDIS_URL` port must actually be listening, checked *before* any build or restart. Plus the fail-safe cutover in `gen-env.sh` (writes `:6432` only when the pooler answers). | `ops/ci/preflight.sh`, `ops/systemd/gen-env.sh` |
| 3 | Smoke gate curled the scraper's `/` and read FastAPI's normal `404` as "down"; health check raced app startup. | False deploy failures; noise that trains people to ignore the gate. | Scraper check accepts any HTTP status (only a connection failure is down); a 30s readiness wait precedes the health check. | `smoke_test()` in `ops/systemd/deploy-systemd.sh` |
| 4 | `/sitemap.xml` regenerated per request (~20s, disk-spilling sort). | Crawler-driven DB load / OOM risk. | Redis-cached (1h) + trimmed; smoke gate asserts the sitemap is XML with a realistic timeout. | `apps/one/src/app/sitemap.ts`, `smoke_test()` |

## 2. Gate order on every deploy

```
gen-env.sh  →  gen-alertmanager.sh
      ↓
  PREFLIGHT            ← fail-closed, NOTHING mutated yet
      ↓
  build (memory-capped systemd scope)
      ↓
  restart units
      ↓
  ASSERT rebuilt + restarted   ← catches silent no-op builds
      ↓
  SMOKE GATE           ← health / sitemap / robots / two / pgbouncer / scraper / property
      ↓
  Deploy complete
```

Any gate failing exits non-zero and (where configured) sends a Telegram alert.

## 3. Running the checks yourself

```bash
# Static — same command CI runs. Run before pushing ops changes.
bash ops/ci/ops-lint.sh

# Prove the linter still catches known-bad fixtures (it cannot silently rot)
bash ops/ci/ops-lint.sh --self-test

# Runtime config validation against the live box (safe, read-only)
bash ops/ci/preflight.sh

# Validate a hypothetical env file without touching the real one
ENV_FILE=/tmp/candidate.env bash ops/ci/preflight.sh
```

CI runs `ops-lint` automatically on any change under `ops/**`
(`.github/workflows/ops-lint.yml`).

## 4. What each check actually asserts

**ops-lint.sh**
- `shellcheck -S error -x` over every `ops/**/*.sh` (errors only; warnings are advisory).
- `systemd-analyze verify` over every `ops/systemd/*.service|*.timer`, filtering
  environment noise (binaries/users that exist only on prod) so only real syntax
  defects fail.
- **Scope-property allowlist**: any `systemd-run --scope -p NAME=` where `NAME` is
  not a cgroup resource-control property is rejected. Comments are stripped first,
  so documentation mentioning `-p Nice=` is not flagged.

**preflight.sh** (fail-closed, run before mutation)
- Every DB/Redis URL in `/etc/oper.env` **and** each `/etc/oper-role-*.env` resolves
  to a host:port that is genuinely listening (bounded retry, so a service that is
  mid-restart is not mistaken for a misconfiguration).
- The build scope's systemd properties parse (dry `systemd-run --scope … /bin/true`).
- Required keys present and not placeholders (`CHANGEME`, `your_`, `TODO`, …).
- Never echoes credentials — URLs are reduced to host:port before printing.

**assert_rebuilt_and_restarted()**
- Each standalone `server.js` must have an mtime ≥ the deploy's start time.
- Each restarted unit's `ActiveEnterTimestamp` must be ≥ the deploy's start time.
- Failure alerts Telegram and exits non-zero *before* the smoke gate.

## 5. Extending it

Add a new gate where the failure class lives:

- **Statically detectable in ops code** → add a check to `ops-lint.sh` and a
  matching fixture under `ops/ci/fixtures/` (the self-test enforces it is caught).
- **Only knowable against the running system** → add it to `preflight.sh`
  (must be read-only and fail-closed).
- **Only observable in the deployed app** → add it to `smoke_test()`.

Rule of thumb: if an incident could have been caught before traffic hit it, it
belongs in preflight; if it could have been caught before the box was touched at
all, it belongs in ops-lint.
