# Crawl Runbook — SLOs, Alerts, and Incident Response

The crawl is the product's supply line. This runbook covers what we measure,
what each alert means, and what to do first.

## 1. Why productivity SLOs exist

On **2026-07-24 the crawl produced zero listings for ~10 hours and nothing
alerted.** Every monitor was green because every monitor asked *"is the process
alive?"* — and `oper-worker` was alive the whole time, failing 100% of its
scrapes (290 consecutive errors, 0 ok) and re-pending the same job forever.

**Liveness is not productivity.** `ops/monitoring/crawl-health.sh`
(`oper-crawl-health.timer`, every 10 min) measures work *done*.

## 2. The SLOs

| Alert key | Fires when | Default | Env override |
|---|---|---|---|
| `crawl-freshness` | No listing seen for N minutes. **This is the one that catches a dead crawl.** | 45 min | `CRAWL_FRESH_MAX_MIN` |
| `crawl-throughput` | 0 jobs finished in 1h **while** pending > 0 (work exists, none done) | — | — |
| `crawl-backlog` | Pending grew N probes straight with 0 completions (stuck ≠ merely busy) | 3 probes | `CRAWL_BACKLOG_GROW_PROBES` |
| `crawl-endpoint-<url>` | An endpoint shows `ok=0` with `error>0` over the window — **names the dead IP** | 15 min | `CRAWL_ENDPOINT_WINDOW_MIN` |

Alerts go to Telegram through `notify-telegram.sh` (30-min dedup cooldown) and
send a ✅ RESOLVED automatically when the condition clears. Probes read the DB
**direct on :5432**, so they keep working when PgBouncer is the thing that broke.

## 3. First three things to check when `crawl-freshness` fires

```bash
# 1. What do the endpoints say? (ok/blocked/error per IP)
journalctl -u oper-worker --since "-15 min" | grep "scraper endpoint metrics" | tail -5
journalctl -u oper-worker --since "-15 min" | grep "scraper pool degraded" | tail -3

# 2. What pool is the worker actually using? (the 2026-07-24 root cause)
grep -E "^SCRAPER_URL" /etc/oper.env

# 3. Is each endpoint answering at all? (404 on / is HEALTHY — FastAPI has no root route)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/
curl -s -o /dev/null -w "%{http_code}\n" http://<mesh-ip>:80/
```

Then: `bash ops/ci/preflight.sh` — it validates the whole pool in one shot and
is what now blocks a deploy that would ship a dead crawl.

## 4. Worked example — the 2026-07-24 outage

**Symptom:** 0 listings/hour, 44,470 jobs pending, `oper-worker` active and busy.

**Cause:** `gen-env.sh`'s passthrough deny-list matched `^SCRAPER_URL` as a
*prefix*, so `SCRAPER_URLS` (the multi-endpoint pool) never reached
`/etc/oper.env`. The worker fell back to the single `SCRAPER_URL`, which pointed
at the detached box — unreachable since a rescue. Every scrape failed.

**Fixes shipped:**
- `gen-env.sh` emits `SCRAPER_URLS` explicitly, defaulting to the local scraper
  so the pool always has one working endpoint.
- **Fail-away** (`scraper-pool.ts`): N consecutive errors sideline an endpoint so
  a healthy one takes over. `error` still leaves *pacing* alone (a transient blip
  must not slow a good endpoint) — it is the *streak* that sidelines.
- **Never-empty guarantee**: if every endpoint is sidelined the pool still
  returns one. A single-endpoint pool that sidelined itself would stop crawling
  entirely — strictly worse than retrying slowly.
- `preflight.sh` fails a deploy when no endpoint answers.

## 5. Throughput and the backlog

Measured 2026-07-25 on a **single** endpoint:

- ~13 crawl jobs / 10 min ≈ **78 jobs/hour**
- ~273 listings / 10 min ≈ **1,640 listings/hour**
- Backlog at the time: **44,464 pending** ⇒ ~**24 days** to drain

**The answer to a backlog is more IPs, never a faster per-IP rate.** Politeness
settings (`CRAWL_JOB_MIN_INTERVAL_MS`, jitter, AIMD cool-off) are what kept us
un-blocked by Realtor.com for months; they are inviolable. Throughput scales by
adding scraper nodes, each with its own egress IP and its own AIMD pacing.

### Adding a scraper node

`ops/scraper-node/cloud-init.yaml` provisions one end-to-end (venv, service on
`eth1:80`, nftables restricted to the driver). Substitute at provision time:

| Placeholder | Value |
|---|---|
| `${SCRAPER_DB_PASSWORD}` | `/root/.oper_scraper_pw` on main (0600, never committed) |
| `${MAIN_MESH_IP}` | the crawl driver's mesh IP — **10.8.0.105** since the 2026-07-24 rebuild |
| `${DEPLOY_REF}` | the commit to pin the node to (never bare `main`) |

```bash
# NOTE the "$(cat ...)": --user-data takes the script BODY or a URL, never a
# local path. Passing a path makes the node receive the literal path string as
# its user-data and boot completely unprovisioned (2026-07-25).
upctl server create --title oper-scraper-N --hostname oper-scraper-N \
  --zone us-sjo1 --plan PREMIUM-1xCPU-2GB \
  --ssh-keys ~/.ssh/id_onepercent.pub \
  --user-data "$(cat /path/to/rendered-userdata.yaml)" --enable-metadata --wait
```

Two things silently produce an unprovisioned node — verify both:
- `#cloud-config` must be the **first line** of the rendered file.
- `cloud-init status` saying `done` means only that it ran, not that it did
  anything. Confirm with `systemctl is-active oper-scraper` on the node.

> **Trial account also caps IPv4 addresses at 5.** Stopped servers still hold
> theirs, so freeing an address means deleting a server, not just stopping it.

Then add its mesh IP to `SCRAPER_URLS` in `/opt/onepercent/.env`, re-run
`gen-env.sh`, and restart `oper-worker`. Verify with the endpoint metrics line.

> **Account limit:** the UpCloud account is on a **24 GB trial memory cap** and
> **custom plans are rejected**. Creating a node requires stopping something
> first; `upctl server stop/start` is gated and must be run by the operator.

## 6. Current fleet (2026-07-25)

Three endpoints, each its own egress IP:

| Endpoint | Host | Mesh IP | Notes |
|---|---|---|---|
| `http://127.0.0.1:8001` | main (`209.50.61.64`) | 10.8.0.105 | driver's own scraper |
| `http://10.8.0.182:80` | `oper-scraper-2` | 10.8.0.182 | 2GB cloud-init node |
| `http://10.8.0.246:80` | `oper-scraper-3` | 10.8.0.246 | 2GB cloud-init node |

The original detached box (`003b3b44`, 10.8.3.41) was **deleted** — it had lost
its SSH key and nothing on it was stateful. Its disk is retained as backup
`0138702c-875d-48df-9621-65bd49ca5ff7`. The superseded old main (`009821f6`) was
deleted too (backup `01ab0355-b8f1-4519-915c-3dfeb1e442db`); both deletions were
needed because **stopped servers still hold their IPv4 allocation**.

## 7. Known gaps
- `oper-worker-watchlist` is `Type=simple` but exits 0 immediately — it should be
  timer-driven. Harmless today (the healthcheck skips oneshots, not this), but it
  will keep showing as an inactive daemon.
