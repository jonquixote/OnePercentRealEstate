# Wave 0 — Stop the Bleeding: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production stops losing data and starts healing itself: tested backups exist, the ML service stays up, the rent worker actually drains its 784K-row backlog instead of mass-failing, Postgres is tuned for the hardware, and no unknown writer interferes.

**Architecture:** Ops + surgical code fixes, no schema changes. Two real bugs get fixed in `apps/worker/src/rent-estimator.ts` (one-shot drain → continuous drain loop; transient ML errors → stay `pending` behind a circuit breaker) and one in `services/ml/main.py` (per-request PG connection leak). Everything else is server configuration executed over SSH, verified with exact commands.

**Tech Stack:** TypeScript (Node 20, `apps/worker`), vitest, Python/FastAPI (`services/ml`), Postgres 16 + PostGIS (docker), docker compose, bash.

**Spec:** `docs/superpowers/specs/2026-07-05-full-upgrade-v2-design.md` (Wave 0 section).

## Global Constraints

- Server: `ssh root@209.94.61.108`; repo deployed at `/opt/onepercent` (rsync target, NOT a git checkout).
- Deploy pattern: rsync repo → `docker compose build <svc> && docker compose up -d --no-deps <svc>`. **Never** `docker compose down` on prod. Compose lives at `/opt/onepercent/infrastructure/docker-compose.yml` and reads `../.env`.
- Postgres restart only AFTER a verified backup exists (Task 1 gates Task 6).
- No schema migrations in this wave. The only prod SQL is the idempotent re-pend sweep (Task 5).
- Local checks before any deploy: `pnpm --filter @oper/worker typecheck && pnpm --filter @oper/worker test && pnpm --filter @oper/worker build`.
- Branch: `wave/0-bleed-stop`. Commit per task. `apps/worker/dist/` is tracked — regenerate with build and commit alongside src changes.
- The n8n freeze (Task 7) must not stop ingestion for weeks — it is an audited, tested *switch*, thrown only during sensitive windows (see task).

---

### Task 0: Branch, pre-flight reconciliation, baseline capture

**Files:**
- Create: `docs/superpowers/plans/2026-07-05-wave-0-baseline.md`
- No code changes.

**Interfaces:**
- Consumes: nothing.
- Produces: branch `wave/0-bleed-stop`; baseline numbers all later tasks' acceptance checks compare against; a decision record for the `dist/*` modifications.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/johnny/Code/OnePercentRealEstate
git checkout -b wave/0-bleed-stop
```

- [ ] **Step 2: Reconcile the modified `apps/worker/dist/*` files (spec pre-flight)**

`rent_estimator_v2.py` + `services/ml_rent_estimator/` are already tracked in git and wired via `services/ml/Dockerfile` — no ghost file there. The only ambiguity is the locally modified build artifacts. Resolve by regenerating from source:

```bash
pnpm --filter @oper/worker build
git diff --stat apps/worker/dist/
```

Expected: after a fresh build, remaining diff (if any) reflects the current committed `src/`. Whatever the diff shows now becomes irrelevant — later tasks rebuild and commit `dist/` with their src changes. Revert any residual noise so the branch starts clean:

```bash
git checkout -- apps/worker/dist/
git status --short   # expect: empty
```

- [ ] **Step 3: Verify the server's ML image matches git (closes the pre-flight acceptance)**

```bash
md5 -q services/rent_estimator_v2.py
ssh root@209.94.61.108 'docker exec infrastructure-ml-1 md5sum /app/rent_estimator_v2.py'
```

Expected: hashes match → v2 is "committed to git and wired" (spec pre-flight satisfied, no graveyard needed). If they DIFFER: copy the server version down (`scp` via `docker cp` to host first), diff against git, and stop for owner review before proceeding — do not overwrite either side silently.

- [ ] **Step 4: Read deploy.sh so deploy steps use the right invocation**

```bash
ssh root@209.94.61.108 'head -60 /opt/onepercent/infrastructure/deploy.sh'
```

Record in the baseline file whether it accepts service names. If it does, later tasks may substitute it for the explicit compose commands; the compose commands below always work regardless.

- [ ] **Step 5: Capture baseline metrics**

```bash
ssh root@209.94.61.108 'docker inspect infrastructure-ml-1 --format "RestartCount={{.RestartCount}}"; docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT rent_calc_status, count(*) FROM listings GROUP BY 1;" -c "SELECT count(*) AS audit_rows_6h FROM rent_predictions_audit WHERE created_at > now() - interval '\''6 hours'\'';"'
```

Write the output into `docs/superpowers/plans/2026-07-05-wave-0-baseline.md` with a timestamp, plus the 2026-07-05 reference values: RestartCount=2472, pending=613,433, failed=171,245, done=151,728, audit_rows_6h=453.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-05-wave-0-baseline.md
git commit -m "wave0: preflight reconciliation + baseline metrics"
```

---

### Task 1: Stopgap nightly backups + tested restore

**Files:**
- Create: `infrastructure/scripts/pg-backup.sh` (committed to repo, installed on host)
- Modify: none.

**Interfaces:**
- Consumes: nothing.
- Produces: `/opt/onepercent/backups/pg_<stamp>.dump` nightly on the server; `backup.log` with `ok`/`FAIL` lines (Wave 8 alerting will tail this). Task 6 (PG restart) is gated on this task's restore test passing.

- [ ] **Step 1: Write the backup script**

Create `infrastructure/scripts/pg-backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly logical backup of the production Postgres (runs on the HOST).
# Writes a compressed custom-format dump, verifies its TOC is readable,
# rotates 7 days. Wave 8 wires backup.log FAIL lines into alerting.
set -euo pipefail

DIR=/opt/onepercent/backups
LOG="$DIR/backup.log"
mkdir -p "$DIR"
trap 'echo "$(date -Is) FAIL" >> "$LOG"' ERR

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$DIR/pg_${STAMP}.dump"

docker exec infrastructure-postgres-1 pg_dump -U postgres -d postgres -Fc -Z 6 > "$OUT"

# Integrity gate: a dump whose table of contents can't be listed is garbage.
docker exec -i infrastructure-postgres-1 pg_restore -l < "$OUT" > /dev/null

find "$DIR" -name 'pg_*.dump' -mtime +7 -delete
echo "$(date -Is) ok $OUT $(du -h "$OUT" | cut -f1)" >> "$LOG"
```

- [ ] **Step 2: Install on the server and run the first backup**

```bash
rsync -az infrastructure/scripts/pg-backup.sh root@209.94.61.108:/opt/onepercent/infrastructure/scripts/pg-backup.sh
ssh root@209.94.61.108 'chmod +x /opt/onepercent/infrastructure/scripts/pg-backup.sh && /opt/onepercent/infrastructure/scripts/pg-backup.sh && tail -1 /opt/onepercent/backups/backup.log'
```

Expected: an `ok` line with the dump path and size. This takes minutes on a ~936K-listing DB with raw_data JSONB — be patient (timeout ≥ 10 min).

- [ ] **Step 3: Install the cron entry**

```bash
ssh root@209.94.61.108 'cat <(crontab -l 2>/dev/null | grep -v pg-backup) <(echo "17 3 * * * /opt/onepercent/infrastructure/scripts/pg-backup.sh >> /opt/onepercent/backups/cron.log 2>&1") | crontab - && crontab -l'
```

Expected: crontab now contains exactly one pg-backup line (03:17 UTC nightly).

- [ ] **Step 4: Restore test into a scratch container (the actual acceptance)**

```bash
ssh root@209.94.61.108 '
set -e
DUMP=$(ls -t /opt/onepercent/backups/pg_*.dump | head -1)
docker run -d --name pg-restore-test -e POSTGRES_PASSWORD=restoretest postgis/postgis:16-3.4-alpine
sleep 20
docker cp "$DUMP" pg-restore-test:/tmp/db.dump
docker exec pg-restore-test psql -U postgres -c "CREATE DATABASE restore_test;"
docker exec pg-restore-test psql -U postgres -d restore_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
# spatial_ref_sys duplicates from the postgis template are expected noise -> || true;
# the listings count below is the real gate.
docker exec pg-restore-test pg_restore -U postgres -d restore_test --no-owner --jobs 2 /tmp/db.dump || true
docker exec pg-restore-test psql -U postgres -d restore_test -t -c "SELECT count(*) FROM listings;"
docker exec pg-restore-test psql -U postgres -d restore_test -t -c "SELECT count(*) FROM underwriting_rules;"
docker rm -f pg-restore-test
'
```

Expected: listings count within one day's churn of prod (~936K+), underwriting_rules = 21. Record both counts and wall-clock restore time in `docs/superpowers/plans/2026-07-05-wave-0-baseline.md` (this is the RTO evidence for the Wave 8 DR drill).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/scripts/pg-backup.sh docs/superpowers/plans/2026-07-05-wave-0-baseline.md
git commit -m "wave0: nightly pg_dump backup with rotation + tested restore"
```

---

### Task 2: ML crash-loop — diagnose, fix, and patch the connection leak

**Files:**
- Modify: `services/ml/main.py` (connection leak + version cache)
- Modify: `infrastructure/docker-compose.yml` (ml memory limit, per diagnosis)

**Interfaces:**
- Consumes: nothing.
- Produces: an ML service that stays up. Tasks 3–5 assume `http://ml:8000/predict` is reliable. Wire contract (`PredictRequest`/`PredictResponse`) unchanged.

- [ ] **Step 1: Gather evidence (run all, keep output)**

```bash
ssh root@209.94.61.108 '
echo "=== docker events (15 min) ==="
timeout 10 docker events --since 15m --until 1s --filter container=infrastructure-ml-1 2>/dev/null | tail -30
echo "=== state timestamps ==="
docker inspect infrastructure-ml-1 --format "Started={{.State.StartedAt}} Finished={{.State.FinishedAt}} Restarts={{.RestartCount}} Exit={{.State.ExitCode}} OOM={{.State.OOMKilled}}"
echo "=== last lifecycle log lines (non-request) ==="
docker logs infrastructure-ml-1 --timestamps --tail 300 2>&1 | grep -vE "healthz|/predict" | tail -30
echo "=== kernel OOM ==="
dmesg -T 2>/dev/null | grep -iE "oom|killed process" | tail -10
echo "=== memory now vs limit ==="
docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" infrastructure-ml-1
echo "=== external restarters? ==="
systemctl list-timers --all 2>/dev/null | head -12
crontab -l 2>/dev/null
'
```

- [ ] **Step 2: Match evidence to a hypothesis and apply the matching fix**

| Hypothesis | Evidence signature | Fix |
|---|---|---|
| H1: memory limit (768M) exceeded → kernel kills uvicorn child, tini exits | `dmesg` shows `Killed process ... uvicorn` or mem usage climbing toward 768Mi between restarts | Raise ml memory limit to `2G` in compose (step 4) **and** fix the leak (step 3) |
| H2: external restarter | `docker events` shows `kill`/`stop` with an initiator, or a systemd timer / cron references ml | Disable/remove the restarter; document what it was in the baseline file |
| H3: clean self-exit | uvicorn logs show `Shutting down` immediately before exit with no kill event | Something SIGTERMs in-container; inspect `docker events` `signal=` attribute and trace; if inconclusive, apply step 3+4 anyway and re-observe |

Whatever the hypothesis, **steps 3 and 4 always ship** — the leak is a real bug regardless.

- [ ] **Step 3: Fix the per-request PG connection leak + cache the active version**

`services/ml/main.py` `_get_active_version()` opens a psycopg2 connection per `/predict` and never closes it (`with psycopg2.connect(...)` ends the *transaction*, not the connection — documented psycopg2 gotcha). Replace lines 85–108 (the `_DATABASE_URL` assignment through `_get_active_version`) with:

```python
_DATABASE_URL = os.getenv("DATABASE_URL")

# Active-version lookup is cached for 60s so /predict doesn't pay a
# connection handshake per request — and the connection is explicitly
# closed ("with psycopg2.connect()" only ends the transaction, which is
# how the previous version leaked one connection per prediction).
_VERSION_TTL_S = 60.0
_version_cache: tuple[float, str] = (0.0, "v0")


def _get_active_version() -> str:
    """Read the active model version from rent_models, cached 60s.

    Falls back to 'v0' (the baseline seed in 2026_06_03_rent_model_registry)
    if the table is absent — keeps local imports cheap during tests where
    the registry migration hasn't been applied.
    """
    global _version_cache
    now = time.monotonic()
    cached_at, cached = _version_cache
    if now - cached_at < _VERSION_TTL_S:
        return cached
    version = "v0"
    if _DATABASE_URL:
        conn = None
        try:
            conn = psycopg2.connect(_DATABASE_URL)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT version FROM rent_models WHERE active = true LIMIT 1"
                )
                row = cur.fetchone()
                if row and row[0]:
                    version = str(row[0])
        except Exception as exc:  # pragma: no cover — degrade not crash
            log.warning("rent_models lookup failed: %s", exc)
        finally:
            if conn is not None:
                conn.close()
    _version_cache = (now, version)
    return version
```

Add `import time` to the stdlib import block at the top of the file (after `import sys`).

- [ ] **Step 4: Raise the ml memory limit**

In `infrastructure/docker-compose.yml`, the `ml:` service's `deploy.resources.limits` block currently allows 768M. Change to:

```yaml
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
```

(Only the ml service. Box has 15 GB with ~11 available — 2G is safe.)

- [ ] **Step 5: Smoke-test the module locally**

```bash
cd /Users/johnny/Code/OnePercentRealEstate
.venv/bin/python -c "import services.ml.main" 2>/dev/null || python3 -c "import sys; sys.path.insert(0, '.'); import services.ml.main; print('import ok')"
```

Expected: `import ok` (or clean exit). If `fastapi`/`psycopg2` missing locally, this is non-blocking — the Docker build in step 6 is the authoritative check.

- [ ] **Step 6: Deploy and verify stability**

```bash
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .venv --exclude venv /Users/johnny/Code/OnePercentRealEstate/ root@209.94.61.108:/opt/onepercent/
ssh root@209.94.61.108 'cd /opt/onepercent/infrastructure && set -a && . ../.env && set +a && docker compose build ml && docker compose up -d --no-deps ml && sleep 30 && curl -s http://localhost:8001/healthz 2>/dev/null; docker exec infrastructure-ml-1 wget -qO- http://127.0.0.1:8000/healthz'
```

Expected: `{"ok": true, "estimator_loaded": true, "import_error": null}`.

Then watch for 30 minutes (previous cadence was a restart every ~2 min, so 30 min clean = strong signal; the 24 h check lands in Task 10):

```bash
ssh root@209.94.61.108 'R0=$(docker inspect infrastructure-ml-1 --format "{{.RestartCount}}"); sleep 1800; R1=$(docker inspect infrastructure-ml-1 --format "{{.RestartCount}}"); echo "restarts: $R0 -> $R1"'
```

Expected: `restarts: N -> N` (delta 0; note RestartCount resets to 0 on container recreate, so N is likely 0 → 0).

- [ ] **Step 7: Commit**

```bash
git add services/ml/main.py infrastructure/docker-compose.yml
git commit -m "wave0: fix ml /predict PG connection leak, cache active version 60s, raise ml mem limit to 2G"
```

---

### Task 3: Rent worker — transient-error classifier + circuit breaker (TDD)

**Files:**
- Create: `apps/worker/src/ml-errors.ts`
- Create: `apps/worker/src/ml-errors.test.ts`
- Modify: `apps/worker/package.json` (vitest)
- Modify: `apps/worker/tsconfig.json` (exclude tests from build)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `classifyMlError(message: string): 'transient' | 'permanent'` and `class CircuitBreaker { recordSuccess(): void; recordTransientFailure(now?: number): void; isOpen(now?: number): boolean; msUntilClose(now?: number): number }` — Task 4 imports both from `./ml-errors.js`.

- [ ] **Step 1: Add vitest to the worker package**

In `apps/worker/package.json`: add to `"scripts"`:

```json
    "test": "vitest run",
```

and to `"devDependencies"`:

```json
    "vitest": "^3.2.4",
```

Then:

```bash
pnpm install
```

In `apps/worker/tsconfig.json`, keep test files out of `dist/`: if an `"exclude"` array exists, add `"src/**/*.test.ts"` to it; otherwise add at the top level:

```json
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
```

- [ ] **Step 2: Write the failing tests**

Create `apps/worker/src/ml-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CircuitBreaker, classifyMlError } from './ml-errors.js';

describe('classifyMlError', () => {
  it('classifies undici connection failures as transient', () => {
    expect(classifyMlError('fetch failed')).toBe('transient');
  });

  it('classifies our own timeout message as transient', () => {
    expect(classifyMlError('ml timeout after 30000ms')).toBe('transient');
  });

  it('classifies ml 502/503 (service unavailable) as transient', () => {
    expect(classifyMlError('ml 503: upstream restarting')).toBe('transient');
    expect(classifyMlError('ml 502: bad gateway')).toBe('transient');
  });

  it('classifies ml 4xx (bad request for THIS row) as permanent', () => {
    expect(classifyMlError('ml 400: latitude and longitude required')).toBe('permanent');
  });

  it('classifies ml 500 (estimator raised on THIS row) as permanent', () => {
    expect(classifyMlError('ml 500: estimator error: bad sqft')).toBe('permanent');
  });

  it('classifies response-contract violations as permanent', () => {
    expect(classifyMlError('ml returned invalid predicted_rent: NaN')).toBe('permanent');
    expect(classifyMlError('ml returned missing model_version')).toBe('permanent');
  });

  it('defaults unknown errors (e.g. DB write blips) to transient — retry-safe', () => {
    expect(classifyMlError('connection terminated unexpectedly')).toBe('transient');
  });
});

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive transient failures, closes after baseOpenMs', () => {
    const b = new CircuitBreaker(3, 30_000, 300_000);
    const t0 = 1_000_000;
    b.recordTransientFailure(t0);
    b.recordTransientFailure(t0);
    expect(b.isOpen(t0)).toBe(false);
    b.recordTransientFailure(t0);
    expect(b.isOpen(t0)).toBe(true);
    expect(b.msUntilClose(t0)).toBe(30_000);
    expect(b.isOpen(t0 + 30_000)).toBe(false);
  });

  it('doubles the open window per consecutive trip, capped at maxOpenMs', () => {
    const b = new CircuitBreaker(1, 30_000, 120_000);
    b.recordTransientFailure(0); // trip 1 -> open 30s
    expect(b.isOpen(29_999)).toBe(true);
    expect(b.isOpen(30_000)).toBe(false);
    b.recordTransientFailure(30_000); // trip 2 -> open 60s
    expect(b.isOpen(89_999)).toBe(true);
    expect(b.isOpen(90_000)).toBe(false);
    b.recordTransientFailure(90_000); // trip 3 -> min(120s, cap 120s)
    b.recordTransientFailure(210_000); // trip 4 -> still capped at 120s
    expect(b.isOpen(329_999)).toBe(true);
    expect(b.isOpen(330_000)).toBe(false);
  });

  it('a success resets both the failure count and the trip escalation', () => {
    const b = new CircuitBreaker(2, 30_000, 300_000);
    b.recordTransientFailure(0);
    b.recordSuccess();
    b.recordTransientFailure(1);
    expect(b.isOpen(1)).toBe(false); // count restarted from zero
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
pnpm --filter @oper/worker test
```

Expected: FAIL — `Cannot find module './ml-errors.js'` (or equivalent resolution error).

- [ ] **Step 4: Implement**

Create `apps/worker/src/ml-errors.ts`:

```ts
// Failure taxonomy for the rent worker's ML calls.
//
// The old behavior marked ANY error 'failed' permanently — so every ML
// restart converted the in-flight batch into rows that no one ever
// retried (171K of them by 2026-07-05). The taxonomy is deliberately
// simple: an error is 'permanent' only when the evidence says THIS ROW
// can never succeed (4xx = bad payload, 500 = estimator raised on this
// input, contract violations). Everything else — connection refused,
// timeouts, 502/503, DB blips — is 'transient': the row stays 'pending'
// and the circuit breaker pauses the drain while the dependency heals.

export type MlFailureKind = 'transient' | 'permanent';

export function classifyMlError(message: string): MlFailureKind {
  const m = message.toLowerCase();
  if (m.startsWith('ml 4') || m.startsWith('ml 500') || m.includes('ml returned')) {
    return 'permanent';
  }
  return 'transient';
}

// Minimal time-injectable circuit breaker. After `threshold` consecutive
// transient failures the breaker opens for baseOpenMs, doubling per
// consecutive trip up to maxOpenMs. Any success resets everything.
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private trips = 0;

  constructor(
    private readonly threshold = 5,
    private readonly baseOpenMs = 30_000,
    private readonly maxOpenMs = 300_000,
  ) {}

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.trips = 0;
  }

  recordTransientFailure(now: number = Date.now()): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      const openMs = Math.min(this.baseOpenMs * 2 ** this.trips, this.maxOpenMs);
      this.openUntil = now + openMs;
      this.trips += 1;
      this.consecutiveFailures = 0;
    }
  }

  isOpen(now: number = Date.now()): boolean {
    return now < this.openUntil;
  }

  msUntilClose(now: number = Date.now()): number {
    return Math.max(0, this.openUntil - now);
  }
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
pnpm --filter @oper/worker test
```

Expected: PASS (10 tests). Also: `pnpm --filter @oper/worker typecheck` — clean, and `pnpm --filter @oper/worker build` — verify `dist/ml-errors.js` exists but `dist/ml-errors.test.js` does NOT.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/ml-errors.ts apps/worker/src/ml-errors.test.ts apps/worker/package.json apps/worker/tsconfig.json pnpm-lock.yaml apps/worker/dist
git commit -m "wave0: ml error taxonomy + circuit breaker for rent worker (TDD)"
```

---

### Task 4: Rent worker — continuous drain loop + wire the breaker

**Files:**
- Modify: `apps/worker/src/rent-estimator.ts`
- Modify: `apps/worker/src/env.ts`

**Interfaces:**
- Consumes: `classifyMlError`, `CircuitBreaker` from `./ml-errors.js` (Task 3).
- Produces: a worker whose steady-state is "backlog shrinking". New env knob `RENT_DRAIN_INTERVAL_MS` (default 30000). Task 5 deploys this.

**The bug being fixed:** `drain()` currently runs exactly twice per process lifetime (boot + post-LISTEN-subscribe), dispatching `RENT_BACKFILL_BATCH`=50 rows total; every other row waits for a NOTIFY that only fires on new inserts. 613K pending rows are structurally unreachable. Additionally, `drain()` must never be re-invoked while a batch is still in flight — it re-SELECTs the same `pending` rows (status only changes on completion) and would double-dispatch.

- [ ] **Step 1: Add the env knob**

In `apps/worker/src/env.ts`: add to the interface (after `RENT_WORKER_CONCURRENCY`):

```ts
  readonly RENT_DRAIN_INTERVAL_MS: number;
```

and to the loader object (after the `RENT_WORKER_CONCURRENCY` line):

```ts
    RENT_DRAIN_INTERVAL_MS: readInt('RENT_DRAIN_INTERVAL_MS', 30 * 1000),
```

- [ ] **Step 2: Wire the classifier + breaker into `rent-estimator.ts`**

Add to the imports at the top (after the `logger.js` import):

```ts
import { CircuitBreaker, classifyMlError } from './ml-errors.js';
```

Add after the `const semaphore = ...` block (around line 150):

```ts
// Breaker shared by the drain loop and NOTIFY-driven jobs. When the ML
// service flaps (its restart loop was the P1 incident), we stop pulling
// work instead of converting the backlog into permanent 'failed' rows.
const breaker = new CircuitBreaker(
  5,       // consecutive transient failures before opening
  30_000,  // first open window
  300_000, // cap
);
```

Replace the `catch` block of `processListing` (currently `catch (err) { const message = ...; try { await markFailed(...)...` — lines 355–366) with:

```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = classifyMlError(message);
    if (kind === 'transient') {
      // Row stays 'pending' — the drain loop will retry it once the
      // dependency heals. Marking these 'failed' is how 171K rows got
      // stranded before 2026-07-05.
      breaker.recordTransientFailure();
      jobLog.warn(
        { err: message, duration_ms: Date.now() - start },
        'rent calc transient failure — row stays pending',
      );
      return;
    }
    try {
      await markFailed(payload.listing_id, message);
    } catch (markErr) {
      jobLog.error(
        { markErr: (markErr as Error).message },
        'failed to mark rent_calc_status=failed (will be retried on next NOTIFY/update)',
      );
    }
    jobLog.error({ err: message, duration_ms: Date.now() - start }, 'rent calc errored');
  }
```

In the success path of `processListing`, record the success: immediately after the `await markDone(payload.listing_id, prediction.predicted_rent, ...)` line, add:

```ts
    breaker.recordSuccess();
```

- [ ] **Step 3: Add the continuous drain loop**

Add after the `drain()` function definition (around line 420):

```ts
// ---------------------------------------------------------------------------
// Continuous drain. The one-shot drain-on-connect only ever dispatched
// RENT_BACKFILL_BATCH rows per process lifetime — with 613K pending rows
// that meant the backlog was structurally never drained. This loop pulls
// a batch, waits for it to fully settle (drain() re-SELECTs 'pending', so
// overlapping batches would double-dispatch the same rows), then pulls
// the next. Empty queue or an open breaker -> sleep and re-check.
// ---------------------------------------------------------------------------

async function drainForever(parentLog: WorkerLogger): Promise<void> {
  while (!shuttingDown) {
    if (breaker.isOpen()) {
      const waitMs = Math.max(breaker.msUntilClose(), 1_000);
      parentLog.warn({ wait_ms: waitMs }, 'breaker open — pausing drain');
      await sleep(waitMs);
      continue;
    }

    let dispatched = 0;
    try {
      dispatched = await drain(parentLog);
    } catch (err) {
      parentLog.error({ err: (err as Error).message }, 'drain loop error');
      await sleep(5_000);
      continue;
    }

    if (dispatched === 0) {
      await sleep(env.RENT_DRAIN_INTERVAL_MS);
      continue;
    }

    // Wait for the batch to settle before the next SELECT.
    while (inFlight > 0 && !shuttingDown) {
      await sleep(250);
    }
  }
}
```

- [ ] **Step 4: Rewire boot — drain loop runs alongside LISTEN**

In `listenLoop`, DELETE the post-subscribe drain call and its comment (the two lines around line 455–457):

```ts
      // Subscribe-then-drain order matters: any NOTIFY arriving between
      // these two awaits will still be delivered once drain returns.
      await drain(parentLog);
```

Replace the body of `main()` (currently: log line, `await drain(log).catch(...)`, `await listenLoop(log)`) with:

```ts
async function main(): Promise<void> {
  log.info(
    {
      concurrency: env.RENT_WORKER_CONCURRENCY,
      ml: env.ML_URL,
      backfill_batch: env.RENT_BACKFILL_BATCH,
      drain_interval_ms: env.RENT_DRAIN_INTERVAL_MS,
    },
    'rent-estimator worker starting',
  );
  // LISTEN handles realtime inserts; drainForever owns the backlog.
  // They share the semaphore, so total concurrency stays bounded.
  await Promise.all([listenLoop(log), drainForever(log)]);
}
```

- [ ] **Step 5: Typecheck, test, build**

```bash
pnpm --filter @oper/worker typecheck && pnpm --filter @oper/worker test && pnpm --filter @oper/worker build
```

Expected: all green; `git diff --stat apps/worker/dist/` shows rebuilt `rent-estimator.js` + `env.js`.

- [ ] **Step 6: Raise worker throughput knobs in compose**

In `infrastructure/docker-compose.yml`, find the `worker-rent` service and add/override in its `environment:` list:

```yaml
      - RENT_BACKFILL_BATCH=200
      - RENT_WORKER_CONCURRENCY=8
      - RENT_DRAIN_INTERVAL_MS=30000
```

(Compose `environment:` entries override `.env` values. Throughput math: concurrency 8 × ~2 s/prediction ≈ 4 rows/s ≈ 340K/day — drains the ~784K backlog in ~2–3 days; the Wave 2 batch path takes it from there.)

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/rent-estimator.ts apps/worker/src/env.ts apps/worker/dist infrastructure/docker-compose.yml
git commit -m "wave0: continuous drain loop + breaker-guarded transient handling for rent worker"
```

---

### Task 5: Deploy worker, sweep stranded rows, verify throughput

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_05_repend_failed_rent.sql`

**Interfaces:**
- Consumes: Tasks 2–4 deployed code.
- Produces: shrinking backlog; the Wave 0 exit numbers.

- [ ] **Step 1: Write the sweep SQL**

Create `infrastructure/migrations/out-of-band/2026_07_05_repend_failed_rent.sql`:

```sql
-- Re-pend rent rows stranded 'failed' by the pre-2026-07-05 worker, which
-- marked ML-connection failures as permanent. Run ONCE, AFTER the
-- breaker-aware worker (wave/0-bleed-stop) is deployed — otherwise the old
-- worker just re-fails them. Idempotent. ~171K rows, single UPDATE is fine.
--
-- Rows whose failure is genuinely permanent (e.g. missing lat/lon, ~800
-- rows) will re-fail under the new classifier — expected, small, correct.
UPDATE listings
   SET rent_calc_status = 'pending',
       updated_at = NOW()
 WHERE rent_calc_status = 'failed';
```

- [ ] **Step 2: Deploy ML + worker together**

```bash
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .venv --exclude venv /Users/johnny/Code/OnePercentRealEstate/ root@209.94.61.108:/opt/onepercent/
ssh root@209.94.61.108 'cd /opt/onepercent/infrastructure && set -a && . ../.env && set +a && docker compose build worker-rent && docker compose up -d --no-deps worker-rent && sleep 10 && docker logs infrastructure-worker-rent-1 --tail 5'
```

Expected log: `rent-estimator worker starting` with `"backfill_batch":200,"drain_interval_ms":30000` followed by `drain: dispatching pending listings`.

- [ ] **Step 3: Run the sweep**

```bash
ssh root@209.94.61.108 'docker exec -i infrastructure-postgres-1 psql -U postgres -d postgres' < infrastructure/migrations/out-of-band/2026_07_05_repend_failed_rent.sql
```

Expected: `UPDATE 171###` (±whatever accrued since baseline).

- [ ] **Step 4: Verify drain throughput (30-minute observation)**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT count(*) FROM rent_predictions_audit WHERE created_at > now() - interval '\''30 minutes'\'';"'
```

Expected: **≥ 3,000** (baseline was 453 per 6 *hours*). Also confirm failures aren't mass-accruing:

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT rent_calc_status, count(*) FROM listings GROUP BY 1;"'
```

Expected: `failed` well under 5,000 (only genuine per-row permanents), `pending` visibly below the ~784K start, `done` climbing.

- [ ] **Step 5: Breaker fire-drill (proves the P2 failure mode is dead)**

```bash
ssh root@209.94.61.108 '
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT count(*) FROM listings WHERE rent_calc_status='\''failed'\'';"
docker restart infrastructure-ml-1
sleep 90
docker logs infrastructure-worker-rent-1 --since 2m 2>&1 | grep -cE "transient failure|breaker open"
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT count(*) FROM listings WHERE rent_calc_status='\''failed'\'';"
'
```

Expected: transient/breaker log lines present (>0); the two `failed` counts differ by ~0 (an ML restart no longer creates permanent failures). This is the spec's Wave 0 item-3 acceptance test.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/migrations/out-of-band/2026_07_05_repend_failed_rent.sql
git commit -m "wave0: re-pend 171K stranded failed rent rows (post-resilient-worker sweep)"
```

---

### Task 6: Postgres tuning + pg_stat_statements (gated on Task 1)

**Files:**
- Modify: `infrastructure/docker-compose.yml` (postgres `command:`)

**Interfaces:**
- Consumes: Task 1's verified backup (hard gate — do not restart Postgres without it).
- Produces: tuned PG; `pg_stat_statements` collecting (Wave 7's index audit input).

- [ ] **Step 1: Capture "before" measurements**

```bash
ssh root@209.94.61.108 '
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SHOW shared_buffers;" -c "SHOW work_mem;"
docker logs infrastructure-worker-refresh-1 --tail 50 2>&1 | grep -iE "refresh|duration" | tail -5
docker exec infrastructure-postgres-1 psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT id, price, estimated_rent FROM listings WHERE sale_type='\''standard'\'' AND listing_type='\''for_sale'\'' AND price >= 10000 ORDER BY rent_price_ratio DESC NULLS LAST LIMIT 100;" 2>&1 | tail -6
'
```

Record execution time + MV refresh durations in the baseline file.

- [ ] **Step 2: Add the tuned command to compose**

In `infrastructure/docker-compose.yml`, `postgres:` service — add a `command:` key (the image's default entrypoint accepts postgres flags; place it directly under `image:`):

```yaml
    command:
      - postgres
      - -c
      - shared_buffers=4GB
      - -c
      - effective_cache_size=10GB
      - -c
      - work_mem=64MB
      - -c
      - maintenance_work_mem=1GB
      - -c
      - random_page_cost=1.1
      - -c
      - wal_compression=on
      - -c
      - max_wal_size=4GB
      - -c
      - shared_preload_libraries=pg_stat_statements
```

Rationale: 15 GB box, PG is the primary tenant (apps + workers are slim). 4 GB buffers / 10 GB effective cache follows the 25%/65% rule; `work_mem=64MB` is safe because concurrent sort-heavy queries are few (max_connections=100 is nowhere near saturated); `random_page_cost=1.1` for SSD.

- [ ] **Step 3: Fresh backup, then coordinated restart (~30–60 s downtime)**

```bash
ssh root@209.94.61.108 '/opt/onepercent/infrastructure/scripts/pg-backup.sh && tail -1 /opt/onepercent/backups/backup.log'
rsync -az infrastructure/docker-compose.yml root@209.94.61.108:/opt/onepercent/infrastructure/docker-compose.yml
ssh root@209.94.61.108 'cd /opt/onepercent/infrastructure && set -a && . ../.env && set +a && docker compose up -d postgres && sleep 25 && docker exec infrastructure-postgres-1 pg_isready -U postgres && docker exec infrastructure-postgres-1 psql -U postgres -t -c "SHOW shared_buffers;" -c "SHOW shared_preload_libraries;"'
```

Expected: `accepting connections`, `4GB`, `pg_stat_statements`. Dependent services reconnect on their own (pools + LISTEN reconnect loops); verify:

```bash
ssh root@209.94.61.108 'sleep 30 && curl -s -o /dev/null -w "app:%{http_code}\n" http://localhost:3001/api/healthz && docker logs infrastructure-worker-rent-1 --since 2m 2>&1 | tail -3'
```

Expected: `app:200`; worker logs show reconnect + continued draining, no crash loop. **Rollback if unhealthy:** remove the `command:` block, re-rsync, `docker compose up -d postgres`.

- [ ] **Step 4: Enable the extension + capture "after"**

```bash
ssh root@209.94.61.108 '
docker exec infrastructure-postgres-1 psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
docker exec infrastructure-postgres-1 psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT id, price, estimated_rent FROM listings WHERE sale_type='\''standard'\'' AND listing_type='\''for_sale'\'' AND price >= 10000 ORDER BY rent_price_ratio DESC NULLS LAST LIMIT 100;" 2>&1 | tail -6
'
```

Record before/after execution time in the baseline file. (Cold cache right after restart — note that; steady-state comparison happens at Task 10.)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/docker-compose.yml docs/superpowers/plans/2026-07-05-wave-0-baseline.md
git commit -m "wave0: tune postgres for 15GB host + enable pg_stat_statements"
```

---

### Task 7: n8n audit + tested freeze switch

**Files:**
- Create: `documentation/operations/n8n-freeze.md`

**Interfaces:**
- Consumes: nothing.
- Produces: documented inventory of what n8n actually runs; a *tested* disable/enable procedure. **Deviation from spec, with reason:** the spec says "disable for the duration of Waves 0–3", but the audit below will likely show n8n's ZIP iterator is what *seeds* `crawl_jobs` — freezing it for weeks stops ingestion (the healthy half of the platform). Policy instead: freeze only during sensitive windows (Wave 1 backfill/deploys, any quiescence-requiring diagnosis), using the tested switch. If the audit shows n8n does NOT seed crawls, freeze it fully per spec.

- [ ] **Step 1: Inventory workflows**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-n8n-1 n8n list:workflow 2>/dev/null'
```

Expected: lines of `<id>|<name>`. For each, capture active state:

```bash
ssh root@209.94.61.108 'docker exec infrastructure-n8n-1 n8n list:workflow --active=true 2>/dev/null'
```

- [ ] **Step 2: Determine what they write**

Check recent n8n executions against the crawl queue's writers:

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT created_at::date, count(*) FROM crawl_jobs WHERE created_at > now() - interval '\''3 days'\'' GROUP BY 1 ORDER BY 1;" && docker logs infrastructure-n8n-1 --since 24h 2>&1 | grep -ciE "workflow|execut" | head -3'
```

If n8n shows executions AND `crawl_jobs` keeps being seeded → n8n is the seeder (expected). Document the mapping (workflow id → what it writes) in `documentation/operations/n8n-freeze.md`.

- [ ] **Step 3: Test the switch (disable → verify → re-enable)**

```bash
ssh root@209.94.61.108 '
docker exec infrastructure-n8n-1 n8n update:workflow --id <ITERATOR_ID> --active=false
docker restart infrastructure-n8n-1
sleep 30
docker exec infrastructure-n8n-1 n8n list:workflow --active=true
'
```

Expected: iterator absent from the active list. Wait 20+ minutes, confirm `crawl_jobs` stops growing (`SELECT count(*) FROM crawl_jobs WHERE created_at > now() - interval '15 minutes';` → 0), then re-enable:

```bash
ssh root@209.94.61.108 'docker exec infrastructure-n8n-1 n8n update:workflow --id <ITERATOR_ID> --active=true && docker restart infrastructure-n8n-1'
```

Confirm seeding resumes. (`<ITERATOR_ID>` comes from Step 1's inventory — record the real id in the runbook.)

- [ ] **Step 4: Write the runbook**

`documentation/operations/n8n-freeze.md` — contents: the workflow inventory table from Steps 1–2, the exact disable/enable commands with the real workflow ids substituted, the verification queries, and the policy line: *"Freeze during Wave 1 backfill + deploy windows and any diagnosis needing quiescence; re-enable immediately after; decommission decision at Wave 8."*

- [ ] **Step 5: Commit**

```bash
git add documentation/operations/n8n-freeze.md
git commit -m "wave0: n8n audit + tested freeze switch with scoped-window policy"
```

---

### Task 8: Secrets rotation runbook (owner handoff)

**Files:**
- Create: `documentation/operations/wave-0-secrets-rotation.md`

**Interfaces:**
- Consumes: nothing.
- Produces: copy-paste rotation commands for the owner. **The FRED key line explicitly states it gates the Wave 3 deploy** (spec §7 exception).

- [ ] **Step 1: Write the runbook**

`documentation/operations/wave-0-secrets-rotation.md`:

```markdown
# Wave 0 — Secrets Rotation (owner actions)

All four leaked/placeholder secrets from the Wave-7 open-items list, with
exact commands. Rotate in this order; each is independent.

## 1. n8n Postgres password (leaked at commit d2d24dc)

    ssh root@209.94.61.108
    docker exec infrastructure-postgres-1 psql -U postgres -c "ALTER USER n8n WITH PASSWORD '<NEW_PASSWORD>';"
    # update /opt/onepercent/.env → the n8n DB_POSTGRESDB_PASSWORD (or equivalent) line
    cd /opt/onepercent/infrastructure && set -a && . ../.env && set +a && docker compose up -d --no-deps n8n
    # verify: docker logs infrastructure-n8n-1 --tail 20 (no auth errors)

## 2. FRED API key — ⚠ GATES WAVE 3

Old key is exposed in git history. Create a new key at
https://fred.stlouisfed.org/docs/api/api_key.html, then on the server:
update FRED_API_KEY in /opt/onepercent/.env and restart the app:

    cd /opt/onepercent/infrastructure && set -a && . ../.env && set +a && docker compose up -d --no-deps app

Verify: curl -s http://localhost:3001/api/mortgage-rates → real rates, not an error.
**Wave 3 (underwriting truth) will not deploy until this works** — the plan
treats the hardcoded-rate fallback as a blocker, not a degradation.

## 3. Server root password

    passwd   # on the server; store in your password manager
    # Preferred: disable password SSH entirely (key auth already in use):
    # /etc/ssh/sshd_config → PasswordAuthentication no; systemctl reload sshd

## 4. Stripe

- Rotate the live secret key in the Stripe dashboard (Developers → API keys → roll).
- Replace STRIPE_PRICE_MONTHLY=PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD in
  /opt/onepercent/.env with the real price id (needed by Wave 5, not before).
- Restart app + worker containers after .env changes (same compose command as #2).
```

- [ ] **Step 2: Commit**

```bash
git add documentation/operations/wave-0-secrets-rotation.md
git commit -m "wave0: secrets rotation runbook (FRED gates wave 3)"
```

---

### Task 9: Activate pgbackrest (follow existing runbook)

**Files:**
- Consult: `infrastructure/backup/setup-pgbackrest.md` (9 KB runbook, written Wave 7), `infrastructure/backup/pgbackrest.conf`
- Modify: whatever the runbook prescribes (it predates this plan; it is the authority for its own steps).

**Interfaces:**
- Consumes: Task 1 (stopgap keeps running until this is proven; both coexist).
- Produces: WAL-archived physical backups → RPO drops from ≤24 h to ≤5 min.

- [ ] **Step 1: Read the runbook end-to-end before executing anything**

```bash
cat infrastructure/backup/setup-pgbackrest.md
```

- [ ] **Step 2: Execute its steps on the server**

Follow the runbook exactly. Where it requires the offsite (B2) bucket that the owner hasn't provisioned yet, configure the **local-repo variant only** (repo on `/opt/onepercent/backups/pgbackrest`) and leave the offsite stanza commented with a `# TODO(owner): B2 bucket — spec §7 item 3` marker. That is this plan's single sanctioned TODO: it marks an owner decision, not deferred engineering.

- [ ] **Step 3: Acceptance**

```bash
ssh root@209.94.61.108 'pgbackrest --stanza=main info 2>&1 | head -15'
```

Expected: one full backup listed; `wal archive min/max` populated. If the runbook's approach conflicts with the containerized Postgres in a way it doesn't itself resolve, STOP and record findings in the baseline file — do not improvise WAL plumbing; the stopgap dump (Task 1) is the safety net and this task can ship in a follow-up PR.

- [ ] **Step 4: Commit whatever config the runbook had you change**

```bash
git add infrastructure/backup/
git commit -m "wave0: activate pgbackrest per setup runbook (local repo; B2 pending owner)"
```

---

### Task 10: 24-hour acceptance gate + wrap-up

**Files:**
- Modify: `docs/superpowers/plans/2026-07-05-wave-0-baseline.md` (append the "after" table)

**Interfaces:**
- Consumes: everything above, aged ≥24 h.
- Produces: Wave 0 sign-off evidence; the go signal for Wave 1 + Track P.

- [ ] **Step 1: Run the acceptance battery (≥24 h after Task 5's deploy)**

```bash
ssh root@209.94.61.108 '
echo "=== ML stability (spec: RestartCount stable 24h) ==="
docker inspect infrastructure-ml-1 --format "RestartCount={{.RestartCount}} Started={{.State.StartedAt}}"
echo "=== backlog trajectory ==="
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT rent_calc_status, count(*) FROM listings GROUP BY 1;"
echo "=== throughput (24h) ==="
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT count(*) FROM rent_predictions_audit WHERE created_at > now() - interval '\''24 hours'\'';"
echo "=== backup ran overnight ==="
tail -3 /opt/onepercent/backups/backup.log
echo "=== pg settings held ==="
docker exec infrastructure-postgres-1 psql -U postgres -t -c "SHOW shared_buffers;"
echo "=== apps healthy ==="
curl -s -o /dev/null -w "app:%{http_code}\n" http://localhost:3001/api/healthz
'
```

Pass criteria (all must hold):
- RestartCount delta over the window = **0**
- `pending` down by ≥200K from the ~784K start; `failed` < 5,000
- audit rows last 24 h ≥ **100,000**
- `backup.log` newest line says `ok` with today's date
- `shared_buffers` = 4GB; app healthz 200

- [ ] **Step 2: Append results to the baseline file, commit, merge**

```bash
git add docs/superpowers/plans/2026-07-05-wave-0-baseline.md
git commit -m "wave0: 24h acceptance evidence — ML stable, backlog draining, backups proven"
git checkout main && git merge --no-ff wave/0-bleed-stop -m "merge wave/0-bleed-stop: backups, ML stability, drain loop, PG tuning"
```

(Push only when the owner says to.)

- [ ] **Step 3: Update progress memory**

Update the `wave-progress` / `upgrade-plan` memory files: Wave 0 shipped with the acceptance numbers; Wave 1 (data harvest) + Track P (Wave 5) unblocked; note the n8n freeze policy + runbook location for the Wave 1 plan to consume.

---

## Self-review notes (kept honest)

- **Spec coverage:** W0 items 1–6 → Tasks 1+9 (backups), 2 (ML), 3+4+5 (worker resilience — spec's "exponential backoff" is realized as the breaker's doubling open-window, which backs off the *queue* rather than per-row state; per-row attempt tracking deliberately deferred to Wave 2's batch path), 6 (PG), 7 (n8n — scoped-window deviation documented in-task), 8 (secrets). Pre-flight → Task 0 (v2 file resolved as "already committed+wired"; only dist/* needed reconciling).
- **Known deviation:** n8n freeze is windowed, not weeks-long — freezing the crawl seeder for Waves 0–3 would halt ingestion; the spec's intent (no unknown writers during sensitive ops) is preserved via the tested switch + policy. Flag to owner at review.
- **Poison-row risk:** a row that repeatedly times out against a *healthy* ML stays pending and recycles at the front of the id-ordered drain batch. Bounded, not eliminated: the breaker only opens on *consecutive* failures (healthy-ML timeouts are interleaved with successes, so the queue keeps moving), 500s/4xx/contract violations classify permanent, and Wave 2's batch path adds real per-row accounting. Accepted for a ~2-week window; if Task 10 shows `pending` stalling with ML healthy, the top-of-queue ids are the first thing to inspect.
