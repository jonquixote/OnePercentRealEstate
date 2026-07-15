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

This idempotently creates `oper_scraper LOGIN IN ROLE oper_rw` if it doesn't
already exist (`oper_rw` — CRUD on all public tables/sequences — was created by
`2026_07_12_db_roles.sql`; reusing it keeps grants consistent with
`oper_app`/`oper_worker`/`oper_ml`).

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

Reload (no restart needed — `listen_addresses` changes on a running native
`postgres -D ... -c config_file=...` process still require a full restart of
`oper-postgres.service` to bind the new address; `pg_hba.conf` changes are
picked up by reload alone):

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

_(Task D2 — cloud-init + provisioning steps land here.)_

---

## Calibration + kill-switch

_(Task D3 — per-IP calibration procedure and kill-switch steps land here.)_
