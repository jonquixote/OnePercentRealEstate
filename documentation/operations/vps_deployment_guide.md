# VPS Deployment Guide

A practical orientation document for any agent (human or AI) operating the OnePercentRealEstate production VPS. Read this before running commands on the server.

## Quick Reference

| Item              | Value                                              |
| ----------------- | -------------------------------------------------- |
| Host              | Ubuntu 24.04 LTS, kernel 6.x                      |
| Plan              | Dedicated 16 GB (6 vCPU / 16 GB RAM / 320 GB NVMe) |
| Region            | (see `infrastructure/setup_server.sh` for the chosen DC) |
| Web app           | `https://<APP_DOMAIN>` → `infrastructure-app-1` (port 3001 → 3000) |
| n8n               | `https://<N8N_DOMAIN>` → `infrastructure-n8n-1` (port 5678) |
| Reverse proxy     | nginx 1.24 + certbot (host-level, not in Docker)   |
| Database          | PostGIS 3.4 / PostgreSQL 16 (port 5432, localhost only) |
| Cache             | Redis 7 alpine (port 6379, localhost only)         |
| Vector tiles      | pg_tileserv (port 7800, localhost only)            |
| Scraper service   | Python/FastAPI (port 8001, localhost only)         |
| Working dir       | `/opt/onepercent/`                                 |
| Env file          | `/opt/onepercent/.env` (chmod 600, root:root)      |
| Backups dir       | `/opt/onepercent/backups/`                         |

## ⚠️ Safety First

1. **Read before running.** Most commands below mutate state. When in doubt, dry-run (`docker compose config`, `ps`, `logs --tail`) before applying.
2. **Never commit `.env` or `.env.local`.** Both are gitignored. The build also excludes `.env*` via `.dockerignore` to keep secrets out of images.
3. **Never paste the `.env` into chat.** If a secret is shared, rotate it immediately (see "Rotation" below).
4. **Backup before destructive ops.** `pg_dump` the DB before running destructive migrations, and snapshot the nginx config before editing it.
5. **Multi-stage changes are additive.** When editing `Dockerfile` or `docker-compose.yml`, also re-sync to the server and rebuild — the server is the source of truth for the running containers, not the local repo.

## SSH Access

The deploy key lives in `~/.ssh/id_onepercent` on the local machine (no passphrase) and is configured in `~/.ssh/config` as `Host onepercent-prod` (or whatever alias is set).

```bash
# Quick test
ssh onepercent-prod "hostname && uptime"

# As root (default for the deploy key)
ssh onepercent-prod "sudo -i whoami"   # → root
```

If SSH fails, check (in order): (1) the deploy key on the server (`/root/.ssh/authorized_keys`), (2) `~/.ssh/config` for the correct hostname/user, (3) Linode firewall / LISH console for network issues.

## Directory Layout on the Server

```
/opt/onepercent/
├── .env                          # ALL secrets (chmod 600)
├── .env.example                  # Template with placeholders
├── Dockerfile                    # App image build
├── docker-compose.yml (in repo: infrastructure/docker-compose.yml)
├── package.json / package-lock.json
├── src/                          # Next.js source
├── public/
├── infrastructure/
│   ├── docker-compose.yml        # 6 services
│   ├── 000_base_schema.sql       # Idempotent base schema
│   ├── migrations/               # Numbered SQL files, applied by npm run migrate
│   ├── nginx/                    # nginx config snippets (copied to /etc/nginx/)
│   ├── n8n_workflow_with_rentals.json
│   ├── n8n_credentials/          # Imported via `n8n import:credentials`
│   ├── setup_server.sh           # One-shot server bootstrap
│   ├── deploy.sh                 # Wrapper: sources .env, then docker compose
│   └── scripts/                  # Helper shell scripts
├── documentation/                # This file's home
├── backups/                      # pg_dump output lives here
├── node_modules/                 # (NOT in repo, populated by `npm ci` inside Docker)
└── .next/                        # (NOT in repo, built inside Docker)
```

Host-level paths:

```
/etc/nginx/
├── nginx.conf                    # Includes conf.d/*.conf and sites-enabled/*
├── conf.d/
│   └── 00-map-connection-upgrade.conf   # http context: map for WebSocket upgrade
├── snippets/
│   └── proxy-params.conf         # Reusable proxy_set_header / buffering
├── sites-available/
│   ├── <APP_DOMAIN>.conf
│   └── <N8N_DOMAIN>.conf
└── sites-enabled/                # Symlinks to sites-available

/etc/letsencrypt/
├── live/<APP_DOMAIN>/            # TLS cert (auto-renewed by certbot.timer)
└── live/<N8N_DOMAIN>/

/var/log/nginx/                   # Access + error logs
```

## Container Inventory

| Container                  | Image                          | Port           | Network          | Restart       |
| -------------------------- | ------------------------------ | -------------- | ---------------- | ------------- |
| `infrastructure-app-1`     | `infrastructure-app` (built)   | 3001 → 3000    | frontend+backend | always        |
| `infrastructure-n8n-1`     | `n8nio/n8n:1.85.0`             | 5678           | frontend+backend | always        |
| `infrastructure-postgres-1`| `postgis/postgis:16-3.4-alpine`| 5432 (127.0.0.1)| backend         | always        |
| `infrastructure-redis-1`   | `redis:alpine`                 | 6379 (127.0.0.1)| backend         | always        |
| `infrastructure-scraper-1` | `infrastructure-scraper` (built)| 8001 → 8000 (127.0.0.1)| backend  | always        |
| `infrastructure-pg_tileserv-1` | `pramsey/pg_tileserv:latest`| 7800 (127.0.0.1)| backend         | always        |

All ports are bound to localhost unless explicitly published to `0.0.0.0` (only `app:3001` and `n8n:5678` are public-facing via nginx).

Healthchecks are defined for `app` (HTTP GET `/api/healthz`), `postgres` (`pg_isready`), and `redis` (`redis-cli ping`).

## Standard Operating Procedures

### Deploy a code change

```bash
# 1. From the local repo, commit and push
git add -A
git commit -m "..."
git push origin main

# 2. Sync the working tree to the server (excludes .env, node_modules, .next)
rsync -avz --delete \
  --exclude='.env' --exclude='node_modules' --exclude='.next' \
  --exclude='.git' --exclude='*.log' --exclude='venv' --exclude='.agent' \
  -e ssh \
  ./ onepercent-prod:/opt/onepercent/

# 3. Rebuild and restart the affected services on the server
ssh onepercent-prod "cd /opt/onepercent && \
  set -a && . ./.env && set +a && \
  docker compose -f infrastructure/docker-compose.yml build --no-cache app scraper && \
  docker compose -f infrastructure/docker-compose.yml up -d --no-deps app scraper"

# 4. Verify
ssh onepercent-prod "cd /opt/onepercent && docker compose -f infrastructure/docker-compose.yml ps"
curl -s https://<APP_DOMAIN>/api/healthz
```

`set -a; . ./.env; set +a` exports all vars in `.env` to the shell so `${POSTGRES_PASSWORD}` substitution in `docker-compose.yml` works. This is wrapped in `infrastructure/deploy.sh` if you prefer to use the wrapper.

### Apply a SQL migration

```bash
# Sync the new file
rsync -avz -e ssh infrastructure/migrations/<FILE>.sql \
  onepercent-prod:/opt/onepercent/infrastructure/migrations/

# Apply directly via psql (the server has no node/npm, so the
# npm run migrate script cannot be used here)
ssh onepercent-prod "cd /opt/onepercent && \
  docker exec -i infrastructure-postgres-1 psql -U postgres < infrastructure/migrations/<FILE>.sql"

# Record it in schema_migrations (so future runs of `npm run migrate`
# know it's been applied)
ssh onepercent-prod "docker exec infrastructure-postgres-1 psql -U postgres -c \
  \"INSERT INTO schema_migrations (version) VALUES ('<VERSION>') ON CONFLICT DO NOTHING\""
```

### Restart a single service

```bash
# App only
ssh onepercent-prod "cd /opt/onepercent && \
  set -a && . ./.env && set +a && \
  docker compose -f infrastructure/docker-compose.yml up -d --no-deps app"

# All services (full stack restart)
ssh onepercent-prod "cd /opt/onepercent && \
  set -a && . ./.env && set +a && \
  docker compose -f infrastructure/docker-compose.yml restart"
```

**Heads-up:** `docker compose up -d app` (without `--no-deps`) will also try to recreate postgres and redis, which can fail if they have been recreated manually (named vs unnamed containers). Use `--no-deps` to avoid this.

### Tail logs

```bash
# Last 100 lines from a service
ssh onepercent-prod "docker logs infrastructure-app-1 --tail 100"

# Follow logs
ssh onepercent-prod "docker logs -f infrastructure-n8n-1"

# Combined app + scraper
ssh onepercent-prod "cd /opt/onepercent && \
  docker compose -f infrastructure/docker-compose.yml logs -f app scraper"

# nginx access / error
ssh onepercent-prod "tail -f /var/log/nginx/access.log"
ssh onepercent-prod "tail -f /var/log/nginx/error.log"
```

### Connect to Postgres

```bash
# One-off query
ssh onepercent-prod "docker exec infrastructure-postgres-1 psql -U postgres -c 'SELECT count(*) FROM listings;'"

# Interactive shell
ssh onepercent-prod "docker exec -it infrastructure-postgres-1 psql -U postgres"

# From your local machine, using the env's DATABASE_URL
psql "$(grep '^DATABASE_URL=' /opt/onepercent/.env | cut -d= -f2-)"   # won't work — DATABASE_URL uses service name "postgres" not localhost
# Workaround: replace "postgres:" with "127.0.0.1:5432" and use SSH tunnel
ssh -L 5432:127.0.0.1:5432 onepercent-prod -N &
psql "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres"
```

### Connect to Redis

```bash
ssh onepercent-prod "docker exec -it infrastructure-redis-1 redis-cli -a <REDIS_PASSWORD>"
# Or set the password inline:
ssh onepercent-prod "docker exec infrastructure-redis-1 redis-cli -a <REDIS_PASSWORD> PING"
```

### Run a one-off command inside a container

```bash
# Run TypeScript migration script (if Node were installed — currently
# the server has no node, so use the container)
ssh onepercent-prod "docker run --rm -it \
  -v /opt/onepercent:/app \
  --network infrastructure_backend \
  --env-file /opt/onepercent/.env \
  node:20-alpine sh"

# psql from a separate container (rare; usually use docker exec instead)
ssh onepercent-prod "docker run --rm -it \
  --network infrastructure_backend \
  postgres:16-alpine \
  psql postgresql://postgres:<POSTGRES_PASSWORD>@postgres:5432/postgres"
```

## nginx and HTTPS

`nginx` runs on the host (not in Docker) and reverse-proxies to the two published container ports. Config is split:

- `/etc/nginx/nginx.conf` — main config; includes `conf.d/*.conf` and `sites-enabled/*`
- `/etc/nginx/conf.d/00-map-connection-upgrade.conf` — `map $http_upgrade $connection_upgrade` (must be in `http` context)
- `/etc/nginx/snippets/proxy-params.conf` — shared `proxy_set_header` / `proxy_buffering off` / `client_max_body_size 50m`
- `/etc/nginx/sites-available/<DOMAIN>.conf` — one per site, symlinked to `sites-enabled/`

### Reload nginx after a config change

```bash
ssh onepercent-prod "nginx -t"             # always validate first
ssh onepercent-prod "systemctl reload nginx"
```

### Renew Let's Encrypt certs

`certbot.timer` auto-renews. To force:

```bash
ssh onepercent-prod "certbot renew --dry-run"   # test
ssh onepercent-prod "certbot renew"             # real
ssh onepercent-prod "systemctl reload nginx"    # pick up new certs
```

Certs live in `/etc/letsencrypt/live/<DOMAIN>/{fullchain.pem,privkey.pem}`.

## n8n

n8n runs in a container, behind the same nginx. Authentication is two-layered:

1. **Basic auth** (outer): `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` (in `.env`). Prompts for these before the n8n login page.
2. **n8n user management** (inner): Owner account created via `POST /rest/owner/setup`. Login uses `emailOrLdapLoginId` + `password`.

The encryption key (`N8N_ENCRYPTION_KEY`) is set in `.env` and is stable across restarts. If it's lost or changed, all stored credentials become unreadable and must be re-imported.

```bash
# Restart n8n
ssh onepercent-prod "cd /opt/onepercent && \
  docker compose -f infrastructure/docker-compose.yml restart n8n"

# Import a workflow
ssh onepercent-prod "cd /opt/onepercent && \
  docker exec -i infrastructure-n8n-1 n8n import:workflow \
  --input=/data/n8n_workflow_with_rentals.json"

# Import credentials
ssh onepercent-prod "cd /opt/onepercent && \
  docker exec -i infrastructure-n8n-1 n8n import:credentials \
  --input=/data/n8n_credentials/postgres.json"

# Login (for API calls)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"emailOrLdapLoginId":"<N8N_USER_EMAIL>","password":"<N8N_PASSWORD>"}' \
  -c /tmp/cookies \
  https://<N8N_DOMAIN>/rest/login
```

## Database Migrations

The `npm run migrate` and `npm run migrate:status` scripts read from `infrastructure/migrations/*.sql` and apply any not yet recorded in the `schema_migrations` table. They require Node.js, which is **not** installed on the production server (the build happens in Docker). The two ways to apply migrations:

1. **Local + push**: Run `npm run migrate` on your local machine with `DATABASE_URL` pointed at a tunneled port. Then commit and push the new migration file.
2. **Direct on server**: rsync the file and run via `docker exec ... psql`, then `INSERT` into `schema_migrations` (see "Apply a SQL migration" above).

To see the current state:

```bash
ssh onepercent-prod "docker exec infrastructure-postgres-1 psql -U postgres -c \
  'SELECT version, applied_at FROM schema_migrations ORDER BY version;'"
```

## Backups

`pg_dump` is the only backup mechanism in place today (no offsite sync yet — see "Open items" in `documentation/done/`).

```bash
# Manual full backup
ssh onepercent-prod "cd /opt/onepercent && \
  docker exec infrastructure-postgres-1 pg_dump -U postgres -Fc postgres \
  > backups/manual-$(date +%Y%m%d-%H%M%S).dump"

# Restore
ssh onepercent-prod "cd /opt/onepercent && \
  cat backups/<FILE>.dump | docker exec -i infrastructure-postgres-1 \
  pg_restore -U postgres -d postgres --clean --if-exists"
```

The pre-launch backup runbook lives at `documentation/operations/backup-restore.md` (covers rclone + B2, not yet wired up).

## Rotation

When any secret is exposed (pasted in chat, leaked in a screenshot, etc.), rotate it immediately. The high-risk secrets and their sources of truth:

| Secret                | Source of truth                          | Rotation steps |
| --------------------- | ---------------------------------------- | --------------- |
| Server root password  | Linode dashboard → Settings → Reset Root | SSH in with the new password, update `~/.ssh/config` if it embedded the old one |
| Server SSH key        | `/root/.ssh/authorized_keys` on VPS     | `ssh-copy-id` the new key, remove the old one |
| `POSTGRES_PASSWORD`   | `/opt/onepercent/.env`                   | `ALTER USER postgres PASSWORD '<NEW>'` in psql, update `.env`, restart `app` (env_file is re-read on recreate) |
| `REDIS_PASSWORD`      | `/opt/onepercent/.env`                   | `--requirepass <NEW>` requires recreating the redis container (data preserved in `redis_data` volume) |
| `N8N_PASSWORD`        | `/opt/onepercent/.env`                   | Update via n8n owner password reset; remember it gates the basic auth layer too |
| `N8N_ENCRYPTION_KEY`  | `/opt/onepercent/.env`                   | **Do not rotate casually** — invalidates all stored credentials. If you must, re-import all credentials after rotation. |
| `STRIPE_SECRET_KEY`   | Stripe Dashboard → Developers → API keys | Roll key, update `.env`, restart `app` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → Endpoint | Re-create endpoint, update `.env` |
| `STRIPE_PRICE_*`      | Stripe Dashboard → Products              | Update IDs in `.env` (PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD means it's not set yet) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox account page                 | Public token — low blast radius, but update + rebuild + redeploy if rotated |
| `ADMIN_API_KEY`       | `/opt/onepercent/.env`                   | Used by `/api/admin/*` routes; rotate + redeploy |
| `FRED_API_KEY`        | FRED (St. Louis Fed)                     | Update `.env` |
| `HUD_API_TOKEN`       | HUD User                 | Update `.env` |

**Deployment key**: the local `~/.ssh/id_onepercent` is treated as sensitive even though it's only in the deploy agent's possession. Treat it as a password.

## Troubleshooting

| Symptom                                                     | Likely cause / first thing to check |
| ----------------------------------------------------------- | ----------------------------------- |
| `502 Bad Gateway` from nginx                                | The app container isn't listening on 3000. `docker ps` and `docker logs infrastructure-app-1`. |
| `connection refused` to Postgres from app container          | Postgres isn't healthy: `docker ps` shows it restarting. Check the password in `command:` matches `.env`. |
| `connection refused` to Redis from app container            | Same — redis often has the password get out of sync. `docker inspect infrastructure-redis-1 --format '{{.Config.Cmd}}'`. |
| Map renders blank / "Mapbox Token Missing"                   | `NEXT_PUBLIC_MAPBOX_TOKEN` build arg wasn't set. Rebuild: see "Deploy a code change" but ensure the `args:` block in `infrastructure/docker-compose.yml` has the token sourced from `.env`. |
| `relation "listings" does not exist` during build           | The build is trying to query the DB at build time. `force-dynamic` the page or lazy-import the DB. |
| `429 Too Many Requests` from an API route                    | Rate limiter triggered. Wait 60s or raise the limit in `src/lib/rate-limit.ts`. |
| `git submodule` warning during clone                         | `.agent/skills` was an unmaintained submodule entry — now removed. The warning is benign if you see it on old clones. |
| Certbot renewal fails                                       | Check port 80 is open. The `--nginx` plugin needs to reach nginx on 80 to validate. |
| n8n shows "Owner setup required"                            | Re-run the owner-setup POST: see "n8n" above. The `N8N_INITIAL_USER_*` env vars are ignored in n8n 1.85.0+; the REST endpoint is the only way. |
| Vercel commit status check fails                            | This is a separate Vercel integration (not our deploy). We made the build portable (no DB at build time) so Vercel preview deploys succeed. The actual deploy target is the Linode VPS via the procedures above. |

## Open Items (Status)

- [ ] Wire `pg_dump` to offsite storage (B2 + rclone) — runbook at `documentation/operations/backup-restore.md`, automation not yet set up.
- [ ] Rotate the server root password and Stripe live key (both were pasted in chat prior to this guide).
- [ ] Replace the `STRIPE_PRICE_*` placeholders in `.env` (currently `PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD`).
- [ ] Decide whether the Vercel integration should stay (currently it's just a status check) or be removed.

## See Also

- `documentation/architecture/overview.md` — system architecture
- `documentation/infrastructure/database.md` — DB schema and `pg_tileserv`
- `documentation/infrastructure/environment-variables.md` — full env var reference
- `documentation/operations/backup-restore.md` — backup runbook
- `documentation/operations/database-access.md` — Postgres/Redis access patterns
- `documentation/operations/troubleshooting.md` — historical bug journal
- `documentation/deployment/linode.md` — full deploy runbook (older)
- `infrastructure/deploy.sh` — env-aware `docker compose` wrapper
- `infrastructure/setup_server.sh` — one-shot server bootstrap (idempotent)
