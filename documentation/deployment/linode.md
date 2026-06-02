# Deployment Runbook — Linode 16GB

## Overview

Target: **Linode Dedicated 16GB** ($96/mo) on Ubuntu 24.04 LTS
Specs: 6 vCPU / 16 GB RAM / 320 GB NVMe SSD / 8 TB transfer
Region: pick closest to your users (default: `us-east`)

## Stack

| Service | Port (public) | Port (internal) | Memory | Purpose |
|---|---|---|---|---|
| app (Next.js) | 3001 | 3000 | 2 GB | Web app |
| postgres + postgis | — | 5432 | 4 GB | Listings DB, profiles |
| redis | — | 6379 | 1 GB | Cache, idempotency, rate limit |
| scraper | — | 8000 | 1 GB | Python FastAPI scraper |
| pg_tileserv | — | 7800 | 512 MB | MVT tiles for map |
| n8n | 5678 (optional) | 5678 | 512 MB | Workflow automation |

All services are on Docker networks `frontend` (app, n8n) and `backend` (app, postgres, redis, scraper, pg_tileserv). DB and Redis are NOT exposed publicly — they bind to `127.0.0.1` only.

## Step 1 — Provision the Linode

1. Create Linode: Dedicated 16GB, Ubuntu 24.04 LTS, region of choice
2. Note the public IP (e.g., `192.0.2.10`)
3. Set the Linode's `hostname` and `label` to `onepercent-prod` (or similar)
4. **Add a 4 GB swap disk** (Linode → Disks → Add Disk → 4096 MB, swap filesystem). This is critical for 16 GB under load.

   Alternative: use the `setup_server.sh` script which creates a swap file automatically.

## Step 2 — DNS

Point your domain to the Linode IP:

| Host | Type | Value |
|---|---|---|
| `onepercent.example.com` | A | `192.0.2.10` |
| `n8n.example.com` | A | `192.0.2.10` |

## Step 3 — SSH Access

From your **local machine** (NOT the server):

```bash
# Generate an SSH key if you don't have one
test -f ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# Push your public key to the server (Linode gives you root password initially)
ssh-copy-id root@192.0.2.10

# Test passwordless access
ssh root@192.0.2.10 "echo connection_ok"
```

**Disable password auth** (security):

```bash
ssh root@192.0.2.10 "sed -i 's/^#\\?PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd"
```

## Step 4 — Run Setup

From the project root on your local machine:

```bash
# Verify .env.example is current
cat .env.example

# Run setup
REMOTE_HOST=192.0.2.10 REMOTE_USER=root ./infrastructure/setup_server.sh
```

This will:
1. Update Ubuntu + install base packages
2. Configure UFW firewall (allow 22, 80, 443, 3001)
3. Create 4 GB swap
4. Tune kernel parameters for Postgres + network
5. Install Docker + Compose plugin
6. Configure Docker daemon (log rotation, userland-proxy off)
7. Sync project files (excludes .env, secrets, build artifacts)
8. Build and start all containers
9. Apply SQL migrations
10. Wait for healthchecks

## Step 5 — Configure Environment

```bash
ssh root@192.0.2.10
cd /opt/onepercent
nano .env
```

Required values:

```bash
# Database
POSTGRES_PASSWORD=<32-char random>
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@postgres:5432/postgres

# Redis
REDIS_PASSWORD=<32-char random>
REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379

# Auth
ADMIN_API_KEY=<openssl rand -base64 32>

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=<from mapbox.com>

# External APIs
HUD_API_TOKEN=<from huduser.gov>
FRED_API_KEY=<from fred.stlouisfed.org>

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_ANNUAL=price_...

# Site
NEXT_PUBLIC_SITE_URL=https://onepercent.example.com
```

Restart after editing `.env`:

```bash
docker compose -f infrastructure/docker-compose.yml restart
```

## Step 6 — Reverse Proxy

Use **nginx-proxy-manager** (Linode One-Click App) or **Caddy** to expose:
- `onepercent.example.com` → `http://localhost:3001` (Next.js)
- `n8n.example.com` → `http://localhost:5678` (n8n)

For Caddy, a minimal config:

```caddy
onepercent.example.com {
  reverse_proxy localhost:3001
}

n8n.example.com {
  reverse_proxy localhost:5678
}
```

## Step 7 — First-Run Data

If you have an existing database dump:

```bash
# On local machine
scp listings.dump.sql root@192.0.2.10:/opt/onepercent/

# On server
cd /opt/onepercent
docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  psql -U postgres -d postgres < listings.dump.sql
```

If starting fresh, the seed scripts will populate:

```bash
docker compose -f infrastructure/docker-compose.yml exec app \
  curl -X POST http://localhost:3000/api/admin/seed-jobs \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"locations": ["Cleveland, OH", "Pittsburgh, PA", "Detroit, MI"]}'
```

## Step 8 — Verify

```bash
# Health check (should return 200 with all checks ok:true)
curl https://onepercent.example.com/api/healthz

# Database connectivity
ssh root@192.0.2.10 "cd /opt/onepercent && docker compose -f infrastructure/docker-compose.yml exec postgres psql -U postgres -c 'SELECT COUNT(*) FROM listings;'"

# Map tiles
curl http://localhost:7800/public.cities.json | head
```

## Step 9 — Backups (See `../operations/backup-restore.md`)

Configure daily automated backups of Postgres + Redis to Backblaze B2 or S3.

## Step 10 — Monitoring

Recommended (not required):

```bash
# Prometheus node exporter
docker run -d --restart=always --net=host \
  -v /proc:/host/proc:ro -v /sys:/host/sys:ro -v /:/rootfs:ro \
  prom/node-exporter --path.procfs=/host/proc --path.sysfs=/host/sys --path.rootfs=/rootfs

# Watch resource usage
ssh root@192.0.2.10 "docker stats --no-stream"
```

## Updating the App

```bash
# Local: commit + push
git add -A && git commit -m "..." && git push

# Server: pull and redeploy
ssh root@192.0.2.10 "cd /opt/onepercent && git pull && docker compose -f infrastructure/docker-compose.yml up -d --build"
```

## Troubleshooting

See `../operations/troubleshooting.md` for common issues.

## Cost Summary

- Linode Dedicated 16GB: $96/mo
- Domain: ~$12/yr
- Backups (Backblaze B2, 100 GB): ~$5/mo
- **Total: ~$108/mo**
