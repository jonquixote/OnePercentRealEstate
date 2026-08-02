# Stateless Scraper Nodes — Nodes Scrape, Main Writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two provisioned scraper nodes sit idle because they cannot reach Postgres: the UpCloud mesh passes ICMP/80/443 but blocks 5432 and 22, and **trial mode forbids modifying the firewall** (`TRIAL_FIREWALL`). Rather than tunnel around it or wait on an account upgrade, remove the requirement: nodes stop touching the database entirely. They scrape and return rows; **main** — which already owns the DB — does every write. This is also the better security posture (no DB credentials on the most internet-exposed hosts in the fleet) and the better failure model (a node cannot corrupt or lock the database).

**Architecture:** `/scrape` gains a `return_rows` mode that performs the scrape + enrichment exactly as today but returns the normalized records instead of writing them. Main runs a small **ingest service** that reuses the *existing, unmodified Python upsert* — the same ~50-column `INSERT … ON CONFLICT` that has been in production for months — exposed only to the mesh through nginx on a port the firewall already permits (80/443). The crawl worker orchestrates: it computes the ZIP bbox (it has DB access), asks a node to scrape, and posts the returned rows to the ingest service. No SQL is ported to TypeScript; no logic is duplicated.

**Tech Stack:** `services/scraper_service/main.py` (FastAPI), a new thin ingest app reusing its upsert helpers, `apps/worker/src/crawl.ts`, nginx (mesh-only server block), systemd.

## Global Constraints

- **Do not port the upsert.** The existing Python `INSERT … ON CONFLICT` is the single source of write truth and must be *reused*, not reimplemented in TypeScript. Duplicating it is how column drift and silent data loss start.
- **The local scraper on main keeps working exactly as today** (direct DB write). This plan must not regress the one endpoint currently producing data — it is the fallback throughout.
- **Ingest is mesh-only.** The nginx server block binds the mesh IP and `allow 10.8.0.0/22; deny all;`, plus a shared secret header. It is never reachable from the public internet.
- **No DB credentials on scraper nodes.** After cutover, `/etc/oper.env` on a node contains no `DATABASE_URL`; the least-privilege `oper_scraper` role is revoked once nodes stop using it.
- **Politeness untouched** — per-IP AIMD, jitter, cool-offs unchanged. This plan changes *where rows are written*, never how fast we scrape.
- **Staged, reversible cutover:** rows-mode is opt-in per request, so a node can be flipped back to direct-write (or out of the pool) with one env change.
- **Payload discipline:** a dense ZIP returns hundreds of rows with `raw_data` JSON. Responses must be gzipped and size-capped, with batching, so a big metro cannot blow memory on either side.
- **Tests:** `pnpm --filter @oper/worker test`; Python tests for the rows-mode contract; `ops/ci/ops-lint.sh`.

## Current State (verified 2026-07-25 on prod)

- Mesh reachability from a node → main: **ICMP ok, 80 open, 443 open, 5432 BLOCKED, 22 BLOCKED**. `upctl server firewall create` → `Trial mode firewall cannot be modified`.
- Nodes `oper-scraper-2` (10.8.0.182) and `oper-scraper-3` (10.8.0.246) are provisioned, `oper-scraper` active, and return `500 {"detail":"Database connection failed"}` on every pass. They are currently **removed from `SCRAPER_URLS`** so they waste no capacity; the pool is `http://127.0.0.1:8001` with `WORKER_CONCURRENCY=1`.
- `services/scraper_service/main.py`: `/scrape` scrapes → enriches → writes via a ~50-column `INSERT … ON CONFLICT` → returns `{count, inserted, updated, skipped, blocked}`. It also needs the DB *before* scraping: `_geocode_zip_to_bbox(zip, conn)` derives a ZIP bbox from existing listings, and `_check_dupe_address(address, conn)`.
- Main's Postgres now correctly binds `localhost,10.8.0.105` (it had been left on the pre-rebuild `10.8.2.241`).
- nginx on main already serves 80/443 for one/two.octavo.press.
- Backups are provider-managed (UpCloud Simple Backup `0430,dailies`).

## File Structure

| File | Responsibility |
|---|---|
| `services/scraper_service/main.py` (modify) | `return_rows` mode; accept a caller-supplied `bbox`; skip all DB use in that mode. |
| `services/ingest_service/main.py` (create) | Thin FastAPI on main that **imports** the scraper's existing upsert helpers and writes rows. Mesh-only + shared secret. |
| `ops/systemd/oper-ingest.service` (create) | Runs the ingest service bound to 127.0.0.1 (nginx fronts it). |
| `ops/nginx/sites/ingest-mesh.conf` (create) | Mesh-IP server block, `allow 10.8.0.0/22; deny all;`, proxies to the ingest service. |
| `apps/worker/src/crawl.ts` (modify) | Compute bbox; call nodes with `return_rows`; POST rows to ingest; keep direct-write path for the local endpoint. |
| `ops/scraper-node/cloud-init.yaml` (modify) | Stop writing `DATABASE_URL` on nodes; set `INGEST_URL` + secret. |
| `documentation/operations/crawl-runbook.md` (modify) | The new data path + how to fall back. |

---

## Task 1: `return_rows` mode in the scraper (no DB)

- [ ] **Step 1: Failing test** — `POST /scrape {return_rows: true, bbox: [...]}`: returns `{rows: [...], count: N, blocked: false}`, each row carrying every field the upsert needs; **asserts `get_db_connection` is never called** (monkeypatch it to raise). Without `return_rows` behavior is byte-for-byte unchanged.
- [ ] **Step 2: RED → implement.** Extract the normalize/enrich pipeline so it is shared by both modes. In rows-mode: accept `bbox` from the request instead of `_geocode_zip_to_bbox`, skip `_check_dupe_address` (the upsert's `ON CONFLICT` already handles dupes), and return the records.
- [ ] **Step 3:** Response is gzip-enabled and capped at `SCRAPE_MAX_ROWS` (default 2000) with a `truncated` flag. Commit — `feat(scraper): return_rows mode — scrape without any DB access`

## Task 2: Ingest service on main (reuses the existing upsert)

- [ ] **Step 1: Failing test** — POST a fixture batch to `/ingest` → rows land in `listings`/`rental_listings` with the same counts the direct path produces; a replay of the same batch is idempotent (`ON CONFLICT`); a request without the shared secret is 401; a malformed row is rejected without aborting the batch.
- [ ] **Step 2: RED → implement.** `services/ingest_service/main.py` **imports** the upsert from the scraper module — do not copy the SQL. Bind 127.0.0.1 only. Auth via `INGEST_SECRET` header compared with `hmac.compare_digest`.
- [ ] **Step 3:** `oper-ingest.service` (MemoryMax cap, `EnvironmentFile=/etc/oper.env`) + nginx mesh block (`listen 10.8.0.105:80`, `allow 10.8.0.0/22; deny all;`). Verify from a node: authorized POST succeeds; from the public IP it is refused. Commit — `feat(ingest): mesh-only ingest service reusing the existing upsert`

## Task 3: Worker orchestration

- [ ] **Step 1: Failing tests** — for a `return_rows` endpoint the worker (a) computes the bbox from the DB, (b) sends `return_rows: true`, (c) POSTs returned rows to `INGEST_URL`, (d) reports counts identical in shape to today's; a node returning rows but a failing ingest POST settles the job as an error (rows are not silently dropped); the **local** endpoint keeps its existing direct-write path untouched.
- [ ] **Step 2: RED → implement.** Endpoint config gains a `mode` (`direct` for local, `rows` for remote nodes) derived from a `SCRAPER_ROWS_URLS` env list, so the two paths coexist and either can be disabled instantly.
- [ ] **Step 3:** Worker suite + typecheck; commit — `feat(crawl): orchestrate rows-mode nodes (bbox in, rows out, main writes)`

## Task 4: Cutover + credential removal

- [ ] **Step 1:** Bring ONE node into the pool in rows-mode. Verify: jobs complete, listings land, `count>0`, no `Database connection failed`, per-endpoint `ok` rises, blocks stay 0. Compare a same-ZIP crawl against the direct path — row counts must match.
- [ ] **Step 2:** Add the second node. Raise `WORKER_CONCURRENCY` to the endpoint count (endpoints do nothing without it — 2026-07-25) and confirm throughput rises against the ~78 jobs/hr single-endpoint baseline, blocks still 0.
- [ ] **Step 3: Remove DB access from nodes** — delete `DATABASE_URL` from each node's `/etc/oper.env`, update `cloud-init.yaml` to stop writing it, and `REVOKE` the `oper_scraper` grants (or drop the role) once no node uses it. Verify a node still scrapes with no DB credentials present.
- [ ] **Step 4:** Runbook: the new data path, `SCRAPER_ROWS_URLS` vs `SCRAPER_URLS`, and the one-line fallback (drop the node from the pool). Commit — `feat(crawl): stateless nodes cutover + revoke node DB access`

## Task 5: Guardrails

- [ ] **Step 1:** `preflight.sh` additionally asserts the ingest service answers from main and that every rows-mode node is reachable.
- [ ] **Step 2:** `crawl-health.sh` gains an `ingest` probe (POST-failure rate over the window) so a broken ingest path pages instead of silently dropping rows.
- [ ] **Step 3:** Commit — `feat(ops): preflight + health cover the ingest path`

## Self-Review

**Spec coverage:** nodes need no DB, so the trial firewall stops being a blocker (T1–T3) · the production upsert is reused rather than reimplemented (T2 constraint) · cutover is staged and instantly reversible with the local endpoint as the fallback (T4) · credentials are removed from exposed hosts (T4 Step 3) · the new path is monitored rather than assumed (T5). Covered.

**Placeholder scan:** every task names exact files and a behavioral proof; the payload risk (dense ZIP, `raw_data` JSON) is addressed with gzip + a row cap; the known `WORKER_CONCURRENCY` trap is called out in the cutover step.

**Type consistency:** the row contract is defined once by the scraper's `return_rows` response and consumed by both the ingest service and the worker; `mode` (`direct`|`rows`) is the single switch distinguishing endpoints; `INGEST_URL`/`INGEST_SECRET` are the only new env keys.
