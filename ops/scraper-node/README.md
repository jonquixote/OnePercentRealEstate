# Scraper node ops

Runbook for the horizontally-scaled Realtor.com crawler: side scraper nodes on
the private mesh (`10.8.0.0/22`, interface `eth1`), talking directly to the
central Postgres on main (`10.8.2.241`). Main runs Postgres natively via
`oper-postgres.service` (config at `/etc/postgresql/16/main/`), not the Docker
container — see `ops/systemd/cutover.sh`.

This file grows with each task in the horizontal-scaling track:
- **Central DB access + tunnel retirement** (this section) — D1.
- **Node provisioning** (cloud-init) — D2.
- **Calibration + kill-switch** — D3.

---

## Central DB access over the private mesh

**Goal:** scrapers on side boxes reach main's Postgres directly over
`10.8.0.0/22` using a least-privilege `oper_scraper` role — no superuser, no
public-interface exposure, no SSH tunnel.

### 1. Run the migration + set the password

On **main**, as a user that can `sudo -u postgres`:

```bash
cd /opt/onepercent
sudo -u postgres psql -f infrastructure/migrations/out-of-band/2026_07_15_scraper_ingest_role.sql
```

This idempotently creates `oper_scraper` as a standalone least-privilege role
if it doesn't already exist — it is **not** a member of `oper_rw` (which has
CRUD on all public tables/sequences, created by `2026_07_12_db_roles.sql`).
Scraper nodes are the most-exposed hosts in the fleet (public egress to
Realtor.com), so `oper_scraper` gets only its real write surface: explicit
`INSERT`/`UPDATE`/`SELECT` grants on `listings`, `rental_listings`, and
`sold_listings` (plus `USAGE`/`SELECT` on their id sequences) and nothing
else — no default privileges, so new tables never become writable by a
compromised scraper node automatically.

The role has **no password yet** — the migration deliberately does not set one
(never commit a password). Set it out-of-band, once:

```bash
sudo -u postgres psql -c "ALTER ROLE oper_scraper PASSWORD '<generate-a-strong-password>';"
```

Store that password in your secrets manager / password manager — it goes into
`/etc/oper.env` on each side node (step 3), never into git.

### 2. Bind Postgres to the mesh + allowlist the /22

Still on **main**, edit the native Postgres config:

`/etc/postgresql/16/main/postgresql.conf`:

```
listen_addresses = 'localhost,10.8.2.241'
```

(Not `*` — Postgres must never listen on the public interface.)

`/etc/postgresql/16/main/pg_hba.conf` — append:

```
# Scraper fleet on the private mesh only (never the public interface).
hostssl  postgres  oper_scraper  10.8.0.0/22  scram-sha-256
```

`listen_addresses` changes require a full Postgres restart (a reload is NOT
enough); `pg_hba.conf` changes only need a reload. The restart below also
picks up the `pg_hba.conf` edit, so a single restart covers both:

```bash
sudo systemctl restart oper-postgres.service   # required for listen_addresses to take effect
sudo -u postgres psql -c "SELECT pg_reload_conf();"   # picks up pg_hba.conf (also covered by the restart above)
```

Confirm main is actually listening on the mesh IP:

```bash
ss -tlnp | grep 5432
# expect: 127.0.0.1:5432 and 10.8.2.241:5432
```

Verify from the **existing side box** (`10.8.3.41`), using the password set in
step 1:

```bash
psql "postgresql://oper_scraper:<password>@10.8.2.241:5432/postgres" -c 'select 1'
```

If this fails: check `ss -tlnp` above ran on main after the restart, check
`pg_hba.conf` line ordering (first match wins — make sure nothing earlier in
the file rejects the side box's mesh IP), and check the side box's mesh
interface (`ip -4 addr show eth1`) is actually in `10.8.0.0/22`.

### 3. Point the side scraper at the mesh DB

On the **side box** (`10.8.3.41`), edit `/etc/oper.env`:

```
DATABASE_URL=postgresql://oper_scraper:<password>@10.8.2.241:5432/postgres
```

Restart the scraper and confirm it's still inserting:

```bash
sudo systemctl restart oper-scraper
sudo journalctl -u oper-scraper -f
```

Watch for successful `/scrape` responses and no connection errors. Optionally
confirm with a direct insert check from main:

```bash
sudo -u postgres psql -c "SELECT max(created_at) FROM listings;"
# re-run after triggering a scrape; timestamp should advance
```

### Retiring the reverse-SSH tunnel

Once step 3 above is confirmed working (side scraper inserting over the mesh,
not the tunnel), retire the old path. The tunnel was two units:

- **Side box:** `oper-sshtunnel.service` — forwards local `127.0.0.1:15432` to
  main over a reverse SSH connection on `:443`. This is the unit that was
  crash-looping (34k+ restarts, port 443 already in use).
- **Main:** `oper-db-tunnel.service` — the corresponding sshd-side listener.

Disable both:

```bash
# side box
sudo systemctl disable --now oper-sshtunnel.service

# main
sudo systemctl disable --now oper-db-tunnel.service
```

Verify the scraper keeps inserting with the tunnel units stopped (this is the
real proof the mesh path is load-bearing, not the tunnel):

```bash
# side box
sudo journalctl -u oper-scraper -f
```

Trigger a manual scrape if the fleet is quiet:

```bash
curl -XPOST http://127.0.0.1:80/scrape -d '{"location":"77002","listing_type":"for_sale"}' -H 'Content-Type: application/json'
```

Confirm rows land (from main): `SELECT max(created_at) FROM listings;` should
advance. Once confirmed, the tunnel units can be removed from the systemd unit
directories entirely in a later cleanup (out of scope here — `disable --now`
is sufficient to retire them without deleting anything irreversible).

**Rollback:** if the mesh path breaks after the tunnel is disabled,
`sudo systemctl enable --now oper-sshtunnel.service` (side) and
`oper-db-tunnel.service` (main) restores the old path; the side box's
`/etc/oper.env` `DATABASE_URL` would also need to point back at
`127.0.0.1:15432` until the mesh path is fixed.

---

## Node provisioning

**Goal:** bring up additional scraper nodes (up to 4 side servers, same
provider/region as the existing `10.8.3.41` box) on the private mesh, then
register each one's private IP with the driver so it starts drawing jobs.

Each node is a stateless FastAPI scraper (`services/scraper_service`) that
scrapes Realtor.com from its own egress IP and inserts straight into main's
Postgres over the mesh — the same shape as `10.8.3.41`, just with a
different bind IP. Nothing about the driver (`apps/worker`, unit
`oper-worker`) changes when you add a node beyond editing `SCRAPER_URLS`.

### 1. Provision the VPS

Create a new VPS with the **same provider and region** as the existing side
box, so it lands on the same private mesh (`10.8.0.0/22`) and picks up an
`eth1` address automatically at boot. The exact provisioning command depends
on the provider console/CLI in use for this fleet — pass
`ops/scraper-node/cloud-init.yaml` as the instance's user-data/cloud-init
script, after filling in `${SCRAPER_DB_PASSWORD}` with the `oper_scraper`
role password (generated in "Central DB access", step 1 above — never
commit it; substitute it in your provider's user-data field or a local copy
of the file that is not checked into git) and `${DEPLOY_REF}` with the
reviewed commit SHA (or signed tag) being deployed — never leave a node
tracking bare `main`.

**Preferred `SCRAPER_DB_PASSWORD` delivery:** leave it OUT of user-data
entirely. Boot the node with a placeholder/empty `DATABASE_URL`, then once
cloud-init finishes, `scp` a real `/etc/oper.env` from the driver box (main)
to the new node out-of-band (mode stays `0600`) and restart
`oper-scraper.service`. This avoids the password ever touching cloud-init
user-data or the provider's activity log. If you do embed the password in
user-data (e.g. for unattended fleet scripting), the cloud-init run shreds
`/var/lib/cloud/instances/*/user-data.txt` as its last step as a fallback —
treat that as a safety net, not the primary control.

Example shape (adjust flags/API to the actual provider CLI):

```bash
<provider-cli> instance create \
  --region <same-region-as-10.8.3.41> \
  --image ubuntu-22.04 \
  --private-network <the-10.8.0.0/22-mesh-network> \
  --user-data-file <(sed -e "s/\${SCRAPER_DB_PASSWORD}/<the-actual-password>/" -e "s/\${DEPLOY_REF}/<the-reviewed-commit-sha>/" ops/scraper-node/cloud-init.yaml) \
  --name oper-scraper-node-N
```

Cloud-init (`ops/scraper-node/cloud-init.yaml`) then, unattended:

1. Installs `git`, `python3-venv`, `python3-pip`, `build-essential`,
   `libpq-dev`, `nftables`.
2. Writes `/etc/oper.env` (mode `0600`) with the mesh `DATABASE_URL`
   pointing at `oper_scraper@10.8.2.241:5432` and `SCRAPE_TIMEOUT_MS`.
3. Clones `OnePercentRealEstate` to `/opt/onepercent` and checks out
   `${DEPLOY_REF}` — a pinned, reviewed commit/tag, not floating `main` —
   then builds the venv at `services/ml/.venv` (same layout as the working
   side box). A recommended follow-up: hash-locked requirements
   (`pip install --require-hashes`) for the scraper's dependency install.
4. Installs the real `ops/systemd/oper-scraper.service` unit verbatim, then
   patches only the `--host`/`--port` flags to bind the node's own `eth1`
   private IP on port 80 (the fleet convention — `SCRAPER_URLS` entries are
   bare IPs like `http://10.8.3.41`, no port suffix). The unit still runs as
   `User=root` to match the proven side-box unit; dropping to an
   unprivileged user with `CAP_NET_BIND_SERVICE` (so it can still bind port
   80) is a recommended future hardening.
5. Enables and starts `oper-scraper.service`.
6. Installs a persistent `nftables` ruleset (`/etc/nftables.conf`) that
   allows inbound `tcp/80` on `eth1` only from `10.8.2.241` (main, the
   `oper-worker` driver — the only legitimate client) and drops everything
   else on that port. Without this, any host that can route to
   `10.8.0.0/22` could reach `/scrape` on the node.
7. Shreds (or, if `shred` is unavailable, removes) the cloud-init
   `user-data.txt` on disk — the fallback for not leaving
   `SCRAPER_DB_PASSWORD` on disk when it was embedded in user-data rather
   than delivered out-of-band per the preferred path above.

Boot the instance and wait for cloud-init to finish
(`cloud-init status --wait` over SSH, or watch the provider console) before
moving to the smoke test.

### 2. Smoke test the new node

From any host that can reach the mesh (e.g. main, or another side box),
confirm the node is up and actually inserting:

```bash
curl http://<node-priv-ip>/health
```

Then trigger one real scrape and confirm it lands in the DB:

```bash
curl -XPOST http://<node-priv-ip>/scrape \
  -H 'Content-Type: application/json' \
  -d '{"location":"77002","listing_type":"for_sale"}'
```

From main:

```bash
sudo -u postgres psql -c "SELECT max(created_at) FROM listings;"
```

Re-run the `SELECT` after the `curl -XPOST` above — the timestamp should
advance. Do not proceed to registration until both checks pass; a node that
fails the smoke test will just fill the driver's breaker with errors
instead of drawing real jobs.

### 3. Register the node with the driver

On **main**, add the new node's private IP to the driver's `SCRAPER_URLS`
(comma-separated, no spaces required but tolerated — see
`apps/worker/src/env.ts`) in `/etc/oper.env`:

```
SCRAPER_URLS=http://10.8.3.41,http://<node-priv-ip>
```

For a third or fourth node, keep appending, comma-separated:

```
SCRAPER_URLS=http://10.8.3.41,http://<node2-priv-ip>,http://<node3-priv-ip>
```

Restart the driver to pick up the new pool:

```bash
sudo systemctl restart oper-worker
```

### 4. Confirm the fleet is drawing from all IPs

```bash
sudo journalctl -u oper-worker -f
```

Watch for job logs alternating between endpoint URLs (e.g. requests routed
to both `http://10.8.3.41` and `http://<node-priv-ip>`) as the
`ScraperPool`'s earliest-available-IP selection spreads jobs across the
fleet. If only the original IP ever appears, double-check
`SCRAPER_URLS` was actually reloaded (`systemctl show oper-worker
--property=Environment` or re-`cat /etc/oper.env` on main) and that the new
node passed its own smoke test above — a node whose breaker tripped to
`error` on first contact will be skipped, not alternated to.

**Rollback:** if a newly added node causes problems (block storms, bad
data, unreachable), drop its IP from `SCRAPER_URLS` and
`systemctl restart oper-worker` — the rest of the fleet is unaffected
(per-endpoint breakers are isolated by design). See "Calibration +
kill-switch" below for the full kill-switch procedure.

---

## Calibration + kill-switch

### Per-endpoint metrics

The driver (`apps/worker`, unit `oper-worker`) logs one structured line per
scraper endpoint every 60s (`METRICS_INTERVAL_MS` in `apps/worker/src/crawl.ts`),
built from the pure `formatEndpointMetrics()` in `apps/worker/src/metrics.ts`:

```json
{"url":"http://10.8.3.41","interval_ms":18000,"ok":142,"blocked":0,"error":1,"ready_in_ms":0,"msg":"scraper endpoint metrics"}
```

- `interval_ms` — the endpoint's current AIMD-adjusted minimum gap between
  job starts (lower = the driver believes this IP can go faster).
- `ok` / `blocked` / `error` — cumulative counters since worker boot (reset on
  restart; there's no persistence of these across a deploy).
- `ready_in_ms` — how long until this endpoint is next eligible for a job (0
  if it's currently available).

Tail these on main with:

```bash
sudo journalctl -u oper-worker -f | grep 'scraper endpoint metrics'
```

## Calibrating a new IP

Every new scraper IP (side node) needs its own settle-in period before it can
be trusted to run at a tight interval. Do this **after** the node passes its
smoke test (Node provisioning, step 2) and is registered in `SCRAPER_URLS`
(step 3).

1. **Start conservative.** The AIMD default `startIntervalMs` is 30s
   (`CRAWL_JOB_MIN_INTERVAL_MS`, also the fleet-wide default for
   `SCRAPER_MIN_INTERVAL_MS`'s floor) — every new endpoint boots at this
   interval regardless of how tight its siblings have already tightened,
   since AIMD state is per-endpoint (`ScraperEndpoint` in
   `apps/worker/src/scraper-pool.ts`), not shared across the pool.
2. **Let AIMD tighten on sustained success.** Each `ok` settle subtracts
   `decreaseMs` (`SCRAPER_AIMD_DECREASE_MS`) from that endpoint's interval,
   down to `minIntervalMs` (`SCRAPER_MIN_INTERVAL_MS`). No manual action is
   needed here — just let the fleet run and watch the metrics log.
3. **Watch the `blocked` counter** for that IP's log lines. Note the
   `blocked` count and `interval_ms` at two points a few hours apart. If
   `blocked` isn't climbing and `interval_ms` has stopped decreasing, the
   endpoint has found its **stable operating interval** — the point where
   AIMD settles without repeated blocks. Record that interval per IP (e.g. in
   this file, a table, or your fleet inventory) so future re-provisioning of
   the same node/region can start closer to it instead of always re-learning
   from 30s.
4. **If an IP blocks repeatedly within an hour**, its stable interval is
   still above `minIntervalMs` — the floor is letting AIMD race down to a
   rate that IP/region can't sustain. Raise that IP's floor by setting a
   higher `SCRAPER_MIN_INTERVAL_MS` on **that node's** `/etc/oper.env`...
   but note `SCRAPER_MIN_INTERVAL_MS` is currently a single fleet-wide value
   read once by the driver (`apps/worker/src/env.ts`), not per-endpoint. Until
   a per-endpoint floor override exists, the practical lever is to give the
   repeatedly-blocked IP a longer rest via the kill-switch below (pull it from
   `SCRAPER_URLS` for a cool-down period) rather than degrading the whole
   fleet's floor to accommodate one weak IP.

### Boot-phase stagger

Side nodes are provisioned from the same provider/region as the existing box,
so without deliberate desynchronization every endpoint's first job after a
driver restart would fire at the same `startIntervalMs` offset — a
same-provider burst hitting Realtor.com at once, which is exactly the
bursty pattern the per-IP AIMD pacing exists to avoid. `crawl.ts` seeds each
pool endpoint's `reserve()` at boot with an `i/N`-fraction offset of
`startIntervalMs` (endpoint `i` of `N` gets `i * startIntervalMs / N`), so the
fleet's start phases are spread across one interval from the first tick
onward instead of synchronized. This only runs when there's more than one
endpoint; a single-IP pool is unaffected.

## Kill-switch

Three levels, from narrowest to broadest blast radius:

**Pause one IP** (e.g. it's blocking repeatedly, or the node itself is
suspect): remove its URL from `SCRAPER_URLS` in `/etc/oper.env` on **main**,
then:

```bash
sudo systemctl restart oper-worker
```

This drains cleanly — `shutdown()` in `crawl.ts` stops accepting new work,
waits up to 30s for in-flight jobs, then exits; the restarted driver reads
the trimmed `SCRAPER_URLS` and simply never acquires that endpoint again. The
rest of the fleet is unaffected (per-endpoint AIMD state is isolated by
design). This is also the rollback step referenced in "Node provisioning"
above.

**Pause the whole fleet** (e.g. a widespread block, or investigating a data
quality issue): stop the driver entirely — no scraper node will receive new
jobs since they're all pull-based (nodes never initiate; the driver calls
`POST /scrape` on them):

```bash
sudo systemctl stop oper-worker
```

**Pause a single node without touching the driver** (e.g. the node itself
needs patching/rebooting, or you want to pull it out of rotation without
editing `SCRAPER_URLS`/restarting the driver and losing the rest of the
pool's warmed-up AIMD state): stop the scraper service on **that node**:

```bash
sudo systemctl stop oper-scraper
```

The driver keeps `SCRAPER_URLS` unchanged and will still try that endpoint,
but every request now fails to connect. `processClaimedJob`'s failure
classification treats a down scraper as `transient` (`isTransientScraperError`
in `crawl-errors.ts`), which `runnerLoop` maps to the `'error'` outcome —
`ScraperEndpoint.settle('error', ...)` deliberately leaves `intervalMs`
untouched (see the comment in `scraper-pool.ts`: "'error' leaves the rate
untouched"). So the stopped node's AIMD state is preserved (no rate decay),
its `error` counter climbs in the metrics log, and it stops drawing new jobs
after its current in-flight one finishes — without a driver restart and
without disturbing the other endpoints' pacing. Restart `oper-scraper` on
the node when it's ready to rejoin; no driver-side action is needed.
