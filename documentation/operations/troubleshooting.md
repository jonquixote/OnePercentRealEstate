# Detailed Troubleshooting Diary

This diary captures specific, "finer" technical details and unexpected issues encountered during development.

## 🏗️ Docker & Infrastructure

### 1. The `pg_tileserv` Image Name Gotcha

- **Issue**: Attempting to pull `ramsey/pg_tileserv:latest` failed.
- **Fix**: The correct image is `pramsey/pg_tileserv:latest`.
- **Learning**: Always double-check Docker Hub usernames; "p" makes a difference!

### 2. Service Restart Priorities

- **Issue**: Restarting the entire stack with `docker compose restart` caused memory spikes and crashed the database.
- **Fix**: Use `restart_services.exp`.
- **Rule**: Never restart `ollama` during maintenance unless explicitly needed; it consumes ~6GB VRAM/RAM immediately upon loading models.

## 🛣️ API & Routing

### 1. The Cache Header Secret

- **Issue**: Users couldn't tell if they were seeing live or cached data on the viewport API.
- **Fix**: Implemented the `X-Cache` header (`HIT` / `MISS`).
- **Repetitive Check**: If you suspect the map isn't updating, check the Network tab in Chrome for `X-Cache: HIT`.

## 🛠️ Deployment Failures

### 1. Git "Dirty" Repo on Server

- **Issue**: `git pull` often failed on the server because of local permission changes or log file modifications.
- **Fix**: Add `git reset --hard` to the deployment script before `git pull`.
- **Warning**: This will wipe any manual edits made directly on the server. Always edit locally and push.

### 2. Wrong Service Name in `docker compose up`

- **Issue**: Trying to rebuild `infrastructure-app` failed because the service was named `app`.
- **Logic**: The service name in `docker-compose.yml` (the key) is what matters for targeted commands, e.g., `docker compose up -d --build app`.

## 📈 Financial Data

### 1. Interest Rate Defaults

- **Old Issue**: The frontpage used a hardcoded 5% rate while the calculator used 6.5%.
- **Current Config**: Both now pull from `DEFAULT_LOAN_OPTIONS` in `src/lib/calculators.ts`.
- **Repetitive Task**: If rates jump significantly (e.g., to 8%), update this ONE file and redeploy.
