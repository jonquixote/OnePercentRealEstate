# OnePercent — Engineering Handoff

Everything a new engineer needs to run this system without re-learning it the
expensive way. **Read §9 (Gotchas) before touching infrastructure** — every item
there cost real debugging time or an outage.

Last updated: 2026-07-25.

---

## 1. What this is

A real-estate investor analytics platform. It crawls listings nationwide,
estimates rent, scores deals against the "1% rule", and serves two frontends:

| Surface | What it is | Port |
|---|---|---|
| `one.octavo.press` | Consumer app (Next 16, eggshell design) | 3001 |
| `two.octavo.press` | Pro terminal (Next 16, dark Bloomberg-style) | 3002 |

Monorepo (pnpm workspaces): `apps/one`, `apps/two`, `apps/worker`,
`services/scraper_service` (Python/FastAPI), `services/ml`, `packages/*`
(`@oper/primitives`, `@oper/api-client`, `@oper/query-lang`, `@oper/map`).

---

## 2. Production topology

**Everything runs on ONE box** (UpCloud, us-sjo1) via **systemd**, not Docker
(except the monitoring stack — see §7).

| Thing | Value |
|---|---|
| Main / driver | `209.50.61.64`, mesh `10.8.0.105`, UUID `003b1626-d145-47b6-9cf6-b9fff3025829` |
| SSH | `ssh -i ~/.ssh/id_onepercent root@209.50.61.64` |
| App root | `/opt/onepercent` (a real git checkout) |
| Runtime env | `/etc/oper.env` (generated — never edit by hand) |
| Scraper nodes | `oper-scraper-2` (mesh `10.8.0.182`), `oper-scraper-3` (mesh `10.8.0.246`) |

> ⚠️ **Do not use the `onepercent-prod` SSH alias** in `~/.ssh/config` — it points
> at a long-dead Linode IP. Use the raw IP above.

Main runs: Postgres 16 + PostGIS, Redis, PgBouncer, apps one/two, the ML service,
the local scraper, and ~10 workers. All units are `oper-*`.

---

## 3. Deploying

```bash
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 \
  'cd /opt/onepercent && git pull --ff-only && \
   rm -rf apps/worker/dist apps/worker/*.tsbuildinfo && \
   bash ops/systemd/deploy-systemd.sh app two worker'
```

Arguments are service names (`app two worker worker-alerts …`); no arguments =
everything. The script runs a **four-gate pipeline**:

```
gen-env → PREFLIGHT → build (memory-capped) → restart → REBUILD ASSERT → SMOKE
```

- **Preflight** (`ops/ci/preflight.sh`) validates config against the *running
  system* before anything mutates: every `DATABASE_URL`/`REDIS_URL`/scraper
  endpoint must actually be listening. Fail-closed.
- **Smoke** hits health, sitemap, robots, two, pgbouncer, scraper, a property
  page. Fail-closed, alerts Telegram.
- Run the same checks locally any time: `bash ops/ci/ops-lint.sh`.

CI runs `ops-lint` (shellcheck + `systemd-analyze verify` + a systemd-scope
property allowlist) on any `ops/**` change, plus the vitest suites.

---

## 4. Database

- Postgres 16 + PostGIS, ~19 GB. `listings` is ~11 GB / 1.3 M rows.
- **PgBouncer on `:6432`, transaction mode**, cutover is **fail-safe**:
  `gen-env.sh` only points `DATABASE_URL` at the pooler when `USE_PGBOUNCER=1`
  **and** a live `SELECT 1` through `:6432` succeeds; otherwise it falls back to
  direct `:5432` with a warning.
- `DATABASE_URL` = pooled. **`DATABASE_URL_DIRECT` = always `:5432`** and must be
  used by anything session-scoped: the two `LISTEN` clients (`crawl.ts`,
  `rent-estimator.ts`) and **all migrations** (DDL in one transaction +
  `CREATE INDEX CONCURRENTLY` cannot go through a transaction pooler).
- Least-privilege roles per service (`oper_app`, `oper_worker`, `oper_ml`,
  `oper_tileserv`, `oper_scraper`) via `/etc/oper-role-*.env`.
- Migrations: `infrastructure/migrations/` (runner wraps each file in ONE
  transaction). `infrastructure/migrations/out-of-band/` is for things that
  cannot run in a transaction (`CONCURRENTLY`) — run those by hand:
  `psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f <file>.sql`.

```bash
# The app DB is NOT the system postgres db — always source the env first:
set -a; . /etc/oper.env; set +a
psql "$DATABASE_URL_DIRECT" -c 'SELECT count(*) FROM listings;'
```

---

## 5. The crawl pipeline

```
oper-worker (crawl.ts)  →  scraper endpoint(s)  →  Postgres
   claims crawl_jobs        FastAPI + homeharvest     writes listings
```

- Endpoints come from **`SCRAPER_URLS`** (comma-separated). Each gets its own
  **AIMD pacing** (30 s start → 12 s floor, escalating cool-off on blocks) plus
  **fail-away**: N consecutive errors sideline an endpoint, with a
  **never-empty guarantee** (if all are sidelined the pool still returns one —
  a pool that refuses to serve is worse than a slow one).
- **`WORKER_CONCURRENCY` must equal the endpoint count.** Endpoints do nothing
  on their own — with concurrency 1 the pool just rotates IPs while they idle.
- **Politeness is inviolable.** Scale throughput by adding IPs, *never* by
  lowering `CRAWL_JOB_MIN_INTERVAL_MS` or removing jitter. That pacing is why we
  went months without Realtor.com bans.
- Adding a node: `ops/scraper-node/cloud-init.yaml` (see §9 for its traps).

Deep detail: `documentation/operations/crawl-runbook.md`.

---

## 6. Listing lifecycle (data correctness)

`listing_status ∈ (active, pending_verify, sold, stale, rental_misfiled)`.

**Every user-facing read must filter** `listing_status NOT IN ('sold','stale',
'rental_misfiled')`. Rentals misfiled as for-sale are quarantined, not deleted —
**never delete listing data, relabel it.**

Trust guardrails (`apps/one/src/lib/rent-trust.ts`): a rent estimate is
`trusted | wide | implausible` based on model-vs-HUD-vs-comps agreement. Anything
implausible is demoted on the page and excluded from alerts/spotlight/default
search (opt-in to see it).

---

## 7. Monitoring & alerts

| Timer | Cadence | What it watches |
|---|---|---|
| `oper-healthcheck` | 2 min | Host mem/swap/disk, every `oper-*` unit, HTTP surfaces |
| `oper-crawl-health` | 10 min | **Productivity**: listing freshness, job throughput, backlog, per-endpoint health |
| `oper-pg-stat` | weekly | Index/statement snapshots for windowed audits |
| `oper-db-load-budget` | hourly | Any single query eating a share of DB time |
| `oper-perf-flush` | 5 min | Persists per-route latency aggregates (one row per route) |
| `oper-perf-budget` | 10 min | Per-route **p95 vs declared budget** (`docs/perf/perf-budgets.md`) |
| `oper-photo-coverage` | 30 min | Share of image-bearing active listings that expose a photo |
| `oper-rent-coverage` | 30 min | Banded share of estimated active listings **+ band integrity** |
| `oper-image-availability` | hourly | Samples the listing-photo CDN — every photo comes from rdcpix |

Alerts go to **Telegram** via `ops/monitoring/notify-telegram.sh` (30-min dedup,
auto-RESOLVED). Credentials already live in `/etc/oper.env`.

### Latency: how to find a slow page now

Until 2026-07-28 every performance problem was found by a human noticing a page
felt slow — the hero at 18.5 s, market pages at 10.4 s, an exporter query eating
79% of all DB time, a freshness probe at 8.4 s. The evidence existed in the
journal; nothing aggregated it. Three signals now close that:

1. **`GET /api/admin/perf`** (Bearer `ADMIN_API_KEY`) — live per-route p50/p95/p99
   from a bounded in-memory ring, plus the persisted trailing hour so it still
   says something after a restart. Costs no query to read.
2. **`[SLOW QUERY]` → Telegram** — anything over `SLOW_QUERY_MS` (default 1000)
   pushes, deduped on the query's *shape* so one bad statement sends one message.
3. **`perf-budget.sh`** — alerts when a route's p95 breaches
   `docs/perf/perf-budgets.md`, requiring ≥20 samples so noise cannot fire it.

> **Instrumentation must never become the load.** All of the above are bounded by
> construction: a fixed-size ring per route, a capped number of routes, one
> aggregated DB row per route per 5 min — never one write per request. This is
> not theoretical: the postgres-exporter's per-scrape aggregate consumed **79% of
> all database time** before it was replaced with a counter table.

> **A budget on a route you cannot sample is worse than no budget** — it reads as
> permanently passing. `/search` is client-rendered and `market.zip` is
> ISR-cached (verified: cold ZIPs return from cache and record zero samples), so
> neither is judged by p95. See the notes in `perf-budgets.md`.

### Data-coverage probes: measure the thing users see

Two gaps survived for months because nothing distinguished "no data available"
from "data available but unreadable":

- **Photos.** 446,437 of 449,654 active listings had images, but the native
  `primary_photo` column was set on **140** of them, and seven read paths
  selected that bare column. One of them (`/api/featured`) used it as a WHERE
  filter, so the homepage strip was restricted to those 140 listings nationwide.
- **Rent bands.** 40% of estimated active listings had no confidence band, which
  looked like a model or write-path bug and was neither — the backfill walks
  `ORDER BY id` and simply had not reached them.

Both probes therefore measure against **the population that could have the
thing**, not against all listings — otherwise genuinely photoless or
genuinely unbandable inventory masks a real regression.

`rent-coverage.sh` also asserts band *integrity* (no inverted, degenerate,
half-populated, or estimate-outside-band rows — zero across 1,011,800 rows on
2026-07-25). That assertion is why no `bandFor()` validation layer exists: the
invariant is monitored rather than defended by an abstraction guarding a failure
that has never occurred.

> **Backfills: filter, then order — and never let the progress line cost more
> than the work.** Both mistakes were made here in one session.
> `ORDER BY (listing_status='active') DESC, id` cannot use a partial index and
> forced a parallel seq scan every batch (9,520 ms vs 637 ms filtered). And a
> progress count using `jsonb_array_length(images)` forced a TOAST read per
> candidate row, reaching **75% of the window's database time** — the progress
> line was more expensive than the backfill it described.

> **Listing ids are roughly chronological.** A plain `ORDER BY id` backfill
> fills ~900k sold and stale rows nobody can see before reaching anything
> user-visible. Fill active inventory first.

### Both apps are watched now

Until 2026-07-26 every safeguard stopped at the `apps/one` boundary: `apps/two`
had 2 test files to `apps/one`'s 49, zero route instrumentation, and logged
`[SLOW QUERY]` with nothing reading it. It was not broken — it answered in ~7 ms
— it was *unwatched*, which is the state `apps/one` was in while its hero
aggregate sat at 18.5 s.

`perf-track` and `slow-query` now live in `@oper/observability` and are imported
by both, rather than copied. That is the point: copies drift, and the next
safeguard added to `apps/one` would silently skip the terminal again.
`perf-budget.sh` reads both `:3001` and `:3002`, and terminal routes are
prefixed `two.` so a shared snapshot cannot confuse them.

> **`git add -A` in this repo sweeps up local debris.** On 2026-07-26 it
> committed 41 Playwright MCP artifacts and screenshots from the working tree
> into a refactor commit. They are now in `.gitignore`, but prefer naming paths
> explicitly when staging.

> **Liveness ≠ productivity.** The crawl once produced zero listings for ~10
> hours while every monitor stayed green, because `oper-worker` was "active" the
> whole time — failing 100% of its scrapes. That is why the crawl-health probes
> measure *work done*, not process state.

**Backups:** provider-managed **UpCloud Simple Backup (`0430,dailies`)**. The old
`snapshot-cron.sh` is deprecated/disabled (see §9). Ad-hoc before risky work:
`upctl storage backup create <boot-disk-uuid> --title "oper-<reason>-<date>"`.

There is also a Docker monitoring stack (Prometheus/Grafana/Alertmanager) — see
the warning in §9 about what its postgres-exporter costs.

---

## 8. Product surfaces worth knowing

- **SEO**: `/property/[id]` has per-deal metadata + canonical + OG; JSON-LD ships
  via `<Schema kind="RealEstateListing">`; `sitemap.ts` is a **single flat file**
  (Next 16's `generateSitemaps` throws at runtime — see §9), Redis-cached 1 h,
  ~33 k URLs.
- **Auth**: self-owned session JWT in an `oper_session` cookie, scoped
  `Domain=.octavo.press` so one login covers both subdomains.
- **Entitlements**: one map in `apps/one/src/lib/entitlements.ts` (compare cap,
  layout cap, alert cadence). `profiles.subscription_tier` is written **only** by
  the Stripe webhook.
- **Caching**: `@/lib/cache`'s `cached(key, ttl, fn)` — Redis, versioned by
  `props:version`, bumped on ingest.

---

## 9. Gotchas — read before touching infra

These each cost hours or an outage.

**Deploy / config**
1. `systemd-run --scope` accepts **only cgroup properties**. `-p Nice=` is
   rejected (`Unknown assignment`) and aborted the build step of *every* deploy
   silently for hours. Wrap with `nice`/`ionice` instead. `ops-lint` now catches it.
2. `gen-env.sh`'s passthrough deny-list matches **prefixes** — `^SCRAPER_URL`
   also matched `SCRAPER_URLS`, silently dropping the whole scraper pool and
   stalling the crawl for ~10 h. New vars sharing a prefix must be emitted
   explicitly.
3. **Never point `DATABASE_URL` at a service that isn't up.** Pre-flipping to
   PgBouncer before installing it took the app down (health 503). Preflight now
   blocks this.
4. `/opt/onepercent` can sit on a **stale branch**; a chained
   `git pull --ff-only -q` fails silently. Always confirm
   `git log --oneline -1` on the box after deploying ops scripts.
5. `psql -f` **autocommits per statement** (the repo runner wraps in one txn).
   Surgical prod applies must handle races themselves.
6. The worker's `tsc` incremental cache can exit 0 **without writing `dist/`** —
   `rm -rf apps/worker/dist apps/worker/*.tsbuildinfo` before rebuilding.

**Scraper nodes (cloud-init)** — all four of these were latent; it could never
have provisioned a node as written:
7. `#cloud-config` **must be line 1**, or cloud-init ignores the file while still
   reporting `status: done`.
8. `upctl --user-data` takes the **body or a URL, not a path** —
   `--user-data "$(cat file)"`.
9. `oper-scraper.service` has `After=/Requires=oper-postgres.service`, which does
   not exist on a node → strip it there.
10. Don't hardcode main's mesh IP; it **changes when main is rebuilt**.

**Platform (UpCloud trial account)**
11. Caps: **24 GB memory**, **5 IPv4**, and **the firewall cannot be modified**
    (`TRIAL_FIREWALL`). Custom plans are rejected.
12. **Stopped servers still hold their IPv4** — freeing an address means
    *deleting*, not stopping.
13. Mesh reachability between servers: **ICMP/80/443 pass; 5432 and 22 are
    blocked.** This is why scraper nodes cannot reach Postgres directly today.
14. `upctl server stop/start/delete` are gated in this workflow — an operator
    runs them.

**Framework**
15. Next 16 `generateSitemaps` throws `r.startsWith is not a function` at runtime
    (framework-internal). Use a single flat `sitemap.ts`.
16. `#` inside a Next `title` template: use `title: { absolute: … }` or the
    layout appends its suffix twice.

**Ops scripts that lied**
17. `snapshot-cron.sh` could never work (`upctl` isn't installed on the box, a
    truncated UUID default, `--description` vs `--title`) and alerted nightly.
    Deprecated in favour of UpCloud Simple Backup. Making it work would have put
    **server-delete-capable API credentials on the most exposed host**.
18. FastAPI has **no route at `/`** — it answers 404. A health check using
    `curl -f` against `/` reports a healthy scraper as down.

---

## 10. Known issues / open work

| Issue | Detail |
|---|---|
| **DNS not moved** | `one`/`two.octavo.press` still point at the old, deleted box. Must become `209.50.61.64`. |
| **Scraper nodes idle** | Provisioned but out of the pool — they cannot reach Postgres (§9.13). Plan: `docs/superpowers/plans/2026-07-25-stateless-scraper-nodes.md`. |
| ~~Homepage stats cold path~~ | **FIXED 2026-07-26**: precomputed into `stats_summary` + SWR/single-flight. 18.5 s → **0.012 s**; 20 concurrent cold requests now peak at 0.12 s. |
| ~~Monitoring eats the DB~~ | **FIXED 2026-07-26**: exporter reads `listing_status_counters`/`reltuples`. Was **79 % of all DB time**; now 0.02 ms. Guarded by `db-load-budget.sh`. |
| `oper-worker-watchlist` | `Type=simple` but exits 0 immediately; should be timer-driven. |
| Index audit | Gated until ≥2 weekly `oper-pg-stat` snapshots (~2026-07-31). |

Plans live in `docs/superpowers/plans/`. Operational runbooks live in
`documentation/operations/` — especially `crawl-runbook.md`,
`deploy-safety.md`, `db-performance.md`, and `prod-rescue-runbook.md`
(how to rebuild main from a snapshot; it has been used for real).
