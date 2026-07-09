# Systemd Migration Plan — Docker → systemd on VPS

> Created: 2026-07-09
> Purpose: Reclaim ~2-3 GB Docker overhead, simplify service management,
> enable bigger LightGBM tree budget.

## Current Docker Resource Budget (baseline freeze)

| Container | CPU | Mem Limit | Actual RSS | Port | Restart | Notes |
|-----------|-----|-----------|------------|------|---------|-------|
| postgres | — | 6G | ~4.7G | 5432 | always | PostGIS + pg_tileserv |
| ml | 2 | 4G | ~706M | 8000 | always | 3 uvicorn workers + retrain subprocess |
| app (Next.js) | 2 | 2G | ~119M | 3001→3000 | always | Main frontend |
| two (Next.js) | 2 | 1G | ~61M | 3002→3000 | always | Secondary frontend |
| scraper | — | 1G | ~225M | — | always | FastAPI geocoding |
| redis | — | 1G | ~22M | 6379 | always | Bull queues |
| n8n | — | 512M | ~150M | 5678 | always | Automation |
| worker | — | 512M | ~28M | — | always | Crawl worker |
| worker-rent | — | 512M | ~29M | — | always | Rent estimation worker |
| worker-refresh | — | 512M | ~16M | — | always | Refresh worker |
| worker-media-health | — | 384M | ~16M | — | always | Media health checker |
| worker-watchlist-alerts | — | 256M | ~18M | — | always | Watchlist alerts |
| worker-ml-scheduler | — | 128M | ~12M | — | always | ML nightly scheduler |
| pg_tileserv | — | 512M | ~11M | 7800 | always | MVT vector tiles |
| prometheus | — | — | ~172M | 9090 | always | Metrics |
| grafana | — | — | ~39M | 3100 | always | Dashboards |
| alertmanager | — | — | ~14M | 9093 | always | Alerts |
| cadvisor | — | — | ~67M | 8080 | always | Container metrics |
| postgres-exporter | — | — | ~9M | 9187 | always | PG metrics |
| redis-exporter | — | — | ~12M | 9121 | always | Redis metrics |

**Total host**: 16 GB RAM, ~7.2 GB used, ~2.1 GB free, ~10 GB buff/cache.
**Docker overhead**: ~2-3 GB (daemon, overlay2, container runtimes, shim processes).

## Migration Order (one at a time, verify health between each)

1. **Postgres** (heaviest, most critical) — systemd-native postgres
2. **Redis** — systemd-native redis-server
3. **ML service** — direct uvicorn via systemd
4. **Workers** (all 6) — node processes via systemd
5. **Frontends** (app, two) — node processes via systemd
6. **Scraper** — uvicorn via systemd
7. **pg_tileserv** — direct binary via systemd
8. **n8n** — direct binary via systemd
9. **Monitoring stack** (prometheus, grafana, alertmanager) — keep as Docker initially
10. **cadvisor, exporters** — remove cadvisor (no longer needed), keep exporters

## Networking Changes

- Docker: containers use docker-compose network names (e.g., `postgres:5432`)
- Systemd: everything binds to `127.0.0.1:<port>`, services connect via `localhost`
- `DATABASE_URL` changes from `postgres:5432` to `localhost:5432`
- `REDIS_URL` changes from `redis:6379` to `localhost:6379`

## Post-Migration ML Budget

- Current: ML limited to 4G Docker cgroup
- Target: ML gets 6-8G of real RAM (no cgroup overhead)
- Enables: `num_leaves` up to 4× current, `n_estimators` up to 2.5× current

## Rollback Plan

1. All systemd units have `systemctl stop <unit>` + `systemctl disable <unit>`
2. Re-enable Docker containers: `docker compose up -d <service>`
3. Keep Docker installed until systemd survives one full nightly cycle
