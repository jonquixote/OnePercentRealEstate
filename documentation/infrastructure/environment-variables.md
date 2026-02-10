# Environment Variables

The application requires specific environment variables to be set in a `.env` file (local) or within the `docker-compose.yml` environment section (production).

## 🔑 Core Application Variables

| Variable | Description | Example |
| :------- | :---------- | :------ |
| `DATABASE_URL` | Postgres connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `MAPBOX_TOKEN` | Public Mapbox GL token | `pk.eyJ1Ijo...` |
| `NEXT_PUBLIC_TILE_SERVER_URL` | URL of the MVT server | `http://157.245.184.89:7800` |

## 📡 External API Keys

| Variable | Description | Source |
| :------- | :---------- | :----- |
| `HUD_API_TOKEN` | Used for FMR benchmarks | [HUD User Data](https://www.huduser.gov/portal/dataset/fmr-api.html) |
| `FRED_API_KEY` | Real-time mortgage rates | [ST. Louis FED](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `BRAVE_SEARCH_API_KEY` | For property research | [Brave Search](https://api.search.brave.com/app/dashboard) |

## 🏗️ Infrastructure Defaults

| Variable | Default Value | Usage |
| :------- | :------------ | :---- |
| `NODE_ENV` | `production` | Enables build optimizations |
| `PORT` | `3000` | Internal Next.js port |
| `PGPORT` | `5432` | Postgres port |

## 📝 Important Notes

- **Next.js Client-Side**: Any variable prefixed with `NEXT_PUBLIC_` will be exposed to the browser. Do NOT put secret keys (like `HUD_API_TOKEN`) in `NEXT_PUBLIC_` variables.
- **Docker Compose**: Variables in `docker-compose.yml` can be passed using `${VARIABLE_NAME}` which will pull values from a local `.env` file in the same directory.
