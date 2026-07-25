# apps/two — Terminal Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the pro terminal the correctness guarantees and operational visibility that `apps/one` has, so "separate but equal" stops being aspirational.

**Architecture:** `apps/two` shares a database with `apps/one` but none of its safeguards. Every correctness fix and every probe built over the last two sessions — the photo read-path guard, native-column reads, slow-query alerting, per-route latency, declared budgets — stopped at the `apps/one` boundary. This plan carries them across, reusing the same modules rather than reimplementing them, and adds the missing test floor.

**Tech Stack:** Next 16 (`apps/two`, port 3002), PostgreSQL 16, vitest, the existing `@oper/*` workspace packages.

## The measured gap

Prod and repo, 2026-07-25:

| | `apps/one` | `apps/two` |
|---|---|---|
| Test files | 49 (267 tests) | **2 (5 tests)** |
| Slow-query alerting wired (`reportSlowQuery`) | yes | **no (0 references)** |
| Per-route latency instrumentation (`withSpan`) | 5 entrypoints | **0 across all API routes** |
| Declared p95 budgets | 6 routes | **none** |
| Photo read-path regression guard | 10 paths covered | **not covered** |
| Live | 3001, healthy | 3002, healthy (7 ms) |

`apps/two` is not broken — it responds in ~7 ms and its two pages render. It is
*unwatched*: if a query there degrades to 10 seconds, nothing logs it, nothing
alerts, and no budget notices. That is exactly the condition `apps/one` was in
before the hero aggregate sat at 18.5 seconds for weeks and the pipeline-health
endpoint at 9.98 seconds — both found only when a human happened to look.

There is also a live correctness question this plan must answer rather than
assume: the photo defect that affected seven `apps/one` read paths was never
checked in `apps/two`, whose `src/lib/db.ts` exists and whose API routes query
the same `listings` table.

## Global Constraints

- **Reuse, do not reimplement.** `perf-track.ts`, `slow-query.ts`, `cache-swr.ts` and `tracing.ts` already exist in `apps/one/src/lib/`. Copying them creates two copies that drift; promote to a shared workspace package or import across the workspace. Decide once, in Task 1, and apply consistently.
- **Read paths coalesce.** Any SQL selecting `primary_photo` must use `COALESCE(primary_photo, images->>0)`. The native column is the fast path; the jsonb is the net for rows the crawler has just inserted.
- **Prefer native columns over `raw_data`/jsonb extraction.** Measured on this database: `raw_data->>'city'` costs 1.074 ms / 41 buffers versus 0.061 ms / 4 for the native column, because `raw_data` is TOASTed.
- **A budget on a route you cannot sample is worse than none** — it reads as permanently passing. Only instrument-then-budget; never budget first.
- **Instrumentation must stay bounded.** Fixed-size ring per route, capped route count, one aggregated DB row per route per flush window — never a write per request.
- **No new unbounded background work**; every probe is O(index) or a bounded sample.

---

## Task 1: Share the instrumentation instead of copying it

**Files:**
- Decide and create: either `packages/observability/src/{perf-track,slow-query}.ts` (+ `package.json`, `tsconfig.json`) or documented cross-app imports
- Modify: `apps/one/src/lib/perf-track.ts`, `apps/one/src/lib/slow-query.ts` (re-export from the shared home if promoting)
- Modify: `apps/two/src/lib/db.ts`

**Interfaces:**
- Produces: `trackRoute(route, ms)`, `percentiles(values)`, `snapshot()`, `reportSlowQuery(sql, ms)`, `slowQueryThresholdMs()` importable from both apps.

- [ ] **Step 1: Read the existing modules and the workspace layout** before choosing:

```bash
cat apps/one/src/lib/perf-track.ts apps/one/src/lib/slow-query.ts
ls packages/
cat packages/primitives/package.json
```

Both modules are dependency-free apart from `process.env` and `fetch`, which
makes promotion cheap. Follow whatever pattern `packages/primitives` uses —
do not invent a new build setup.

- [ ] **Step 2: Promote both modules** into a shared package, leaving thin re-exports in `apps/one/src/lib/` so no existing import breaks:

```ts
// apps/one/src/lib/perf-track.ts
export * from '@oper/observability/perf-track';
```

- [ ] **Step 3: Run the existing tests unchanged.** They are the proof the move was behaviour-preserving — do not edit them to fit the new location:

```bash
pnpm --filter @oper/one test --run src/lib/perf-track src/lib/slow-query
```

Expected: 7 + 9 = 16 tests still passing.

- [ ] **Step 4: Wire slow-query alerting into `apps/two`'s pool.** Its `src/lib/db.ts:22` already logs `[SLOW QUERY]`; give it the same push the other app has:

```ts
if (duration > 200) {
  const queryText = typeof text === 'string' ? text : text.text;
  console.warn(`[SLOW QUERY] ${duration}ms: ${queryText?.substring(0, 100)}...`);
  if (duration >= slowQueryThresholdMs()) reportSlowQuery(queryText ?? '', duration);
}
```

Dedup is keyed on the query's *shape*, so the two apps sharing a threshold and a
Telegram channel will not double-alert on identical statements — but they will
alert separately for genuinely different queries, which is what we want.

- [ ] **Step 5: Typecheck and run both suites.**

```bash
pnpm -r exec tsc --noEmit && pnpm -r test --run
```

- [ ] **Step 6: Commit** — `refactor(observability): share perf-track and slow-query across both apps`

---

## Task 2: Find out whether the photo defect reached apps/two

**Files:**
- Create: `apps/two/src/lib/photo-read-paths.test.ts`
- Modify: whichever `apps/two` SQL selects a photo column

**Interfaces:**
- Consumes: the guard logic proven in `apps/one/src/lib/photo-read-paths.test.ts`.

- [ ] **Step 1: Establish the facts before writing anything.**

```bash
grep -rn "primary_photo\|images" apps/two/src --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Three outcomes, and they lead different places:
  - **No photo reads at all** → there is nothing to fix. Record that in the commit message and skip to Step 4, adding the guard anyway so a future route cannot regress.
  - **Bare `primary_photo` selections** → the same defect; fix as in Steps 2–3.
  - **Already coalesced** → note it and still add the guard.

- [ ] **Step 2: Port the guard test.** Copy `apps/one/src/lib/photo-read-paths.test.ts`, point `READ_PATHS` at the `apps/two` files found in Step 1, and keep its self-tests — the ones asserting the guard detects a bare selection on its own line, inline, and in a WHERE filter, and accepts a CTE alias. Those self-tests are what make the guard trustworthy.

- [ ] **Step 3: Run it.** If it fails, fix each SQL selection to `COALESCE(primary_photo, images->>0) AS primary_photo` and re-run until green.

```bash
pnpm --filter @oper/two test --run src/lib/photo-read-paths
```

- [ ] **Step 4: Check the other known data trap in the same sweep** — `raw_data` extraction where a native column exists:

```bash
grep -rn "raw_data->>" apps/two/src | grep -v "\.test\."
```

For each hit, verify the native column agrees before switching (`count(*) FILTER (WHERE native IS DISTINCT FROM raw_data->>'x')` on prod), then switch it. State the row counts in the commit — assuming equivalence is how a plan premise gets falsified.

- [ ] **Step 5: Commit** — `fix(two): photo read paths coalesce; native columns over TOASTed raw_data`

---

## Task 3: Instrument the terminal's routes

**Files:**
- Modify: `apps/two/src/app/api/screens/route.ts`, `apps/two/src/app/api/layouts/route.ts`, `apps/two/src/app/api/market-series/route.ts`, and any other API route found in Step 1
- Modify: `apps/two/src/app/(terminal)/page.tsx`, `apps/two/src/app/portfolio/page.tsx`

**Interfaces:**
- Consumes: `withSpan` from Task 1's shared home.
- Produces: route names `two.screens`, `two.layouts`, `two.market-series`, `two.terminal`, `two.portfolio`.

- [ ] **Step 1: Enumerate every route.**

```bash
find apps/two/src/app -name "route.ts" -o -name "page.tsx" | sort
```

- [ ] **Step 2: Wrap each entrypoint**, using the pattern already applied in `apps/one` — rename the handler and export a thin wrapper, so the diff stays mechanical and reviewable:

```ts
export async function GET(req: Request) {
  return withSpan('two.screens', () => handleGet(req));
}

async function handleGet(req: Request) {
  // …original body unchanged…
}
```

**Prefix every route name with `two.`** so the shared perf snapshot never
confuses the two apps' routes. `apps/one` uses bare names (`api.stats`,
`market.zip`).

- [ ] **Step 3: Typecheck.** This refactor's most likely failure is a missed
`return` or a body that referenced `req` implicitly:

```bash
pnpm --filter @oper/two exec tsc --noEmit
```

- [ ] **Step 4: Add the admin perf endpoint.** Port `apps/one/src/app/api/admin/perf/route.ts` and its tests to `apps/two`, keeping the `ADMIN_API_KEY` gate and the 501-when-unconfigured behaviour, so the terminal's latency can be read the same way.

- [ ] **Step 5: Run the suite and commit** — `feat(two): per-route latency instrumentation + admin perf endpoint`

---

## Task 4: A test floor for the terminal

**Files:**
- Create: tests for each `apps/two` API route

**Interfaces:**
- Consumes: the vitest setup already present in `apps/two`.

- [ ] **Step 1: Read the two existing tests** to match their style and mocking approach:

```bash
find apps/two/src -name "*.test.*" -exec cat {} \;
```

- [ ] **Step 2: For each API route, write tests covering the three things that actually break in this codebase**, mocking `@/lib/db` the way `apps/one`'s route tests do:
  - the success shape (the fields a consumer reads are present and correctly typed)
  - invalid input → a 4xx with a useful body, not a 500
  - a database failure → a handled error, not an unhandled rejection

Do not write a test that asserts nothing — a test that only checks `res.status === 200` on a fully-mocked handler is a test that cannot fail.

- [ ] **Step 3: Run them and confirm they fail for the right reason first** where you are asserting behaviour that does not exist yet, then implement.

- [ ] **Step 4: Commit** — `test(two): cover the terminal's API routes`

---

## Task 5: Budgets, deploy, and proof

**Files:**
- Modify: `docs/perf/perf-budgets.md`, `ops/monitoring/perf-budget.sh`, `docs/HANDOFF.md`

- [ ] **Step 1: Deploy and generate real traffic**, then read the numbers before writing any budget:

```bash
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 \
  "cd /opt/onepercent && ./ops/systemd/deploy-systemd.sh two"
for i in $(seq 1 25); do curl -s -o /dev/null http://127.0.0.1:3002/; done
curl -sS -H "Authorization: Bearer $ADMIN_API_KEY" http://127.0.0.1:3002/api/admin/perf
```

- [ ] **Step 2: Add budgets to `perf-budgets.md` for the `two.*` routes** using the measured p95 with headroom, each row citing its measured value exactly as the existing rows do.

- [ ] **Step 3: Teach `perf-budget.sh` about the second app.** It currently reads one URL; it needs to check both and key its alerts per app so a breach names which terminal is slow. Keep the ≥20-sample minimum — the reason it exists (a single slow request is not a trend) applies equally here.

- [ ] **Step 4: Prove a breach alerts and resolves** on a `two.*` route, using the same method as the existing proof: set one budget to 1 ms, confirm the Telegram message names the route and its p95 and that the state file appears, restore, confirm RESOLVED clears it.

- [ ] **Step 5: Confirm nothing regressed.** The terminal was responding in ~7 ms before instrumentation; it must still be:

```bash
for u in / /portfolio; do curl -s -o /dev/null -w "$u %{time_total}s\n" http://127.0.0.1:3002$u; done
/opt/onepercent/ops/monitoring/db-load-budget.sh
```

Neither the instrumentation nor the new flush may appear as a new top query.

- [ ] **Step 6: Update `docs/HANDOFF.md`** so the terminal appears alongside `apps/one` in the monitoring section rather than being the app nobody watches. Commit — `feat(two): p95 budgets + handoff parity`

---

## Self-Review

**Spec coverage:** every column of the gap table is closed — tests (Task 4),
slow-query alerting (Task 1), latency instrumentation and the perf endpoint
(Task 3), budgets (Task 5), and the photo/`raw_data` correctness sweep
(Task 2). Sharing rather than copying (Task 1) is what stops the gap silently
reopening the next time `apps/one` gains a safeguard.

**Placeholder scan:** every step names files, commands, and expected output.
Task 2 Step 1 is deliberately branching rather than assuming a defect exists in
`apps/two` — the last two sessions each contained a plan premise that
measurement falsified, and one audit figure that was measuring the wrong thing
entirely. Budgets in Task 5 are set from measured values, never invented ahead
of the measurement.

**Type consistency:** no new runtime contracts. The shared package re-exports
the existing signatures (`trackRoute(route: string, ms: number): void`,
`reportSlowQuery(sql: string, durationMs: number): void`), and the `two.` route
prefix is a naming convention enforced by review, not a type — so it is called
out explicitly in Task 3 Step 2 where it would otherwise be forgotten.
