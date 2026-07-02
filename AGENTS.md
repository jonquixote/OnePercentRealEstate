# OnePercentRealEstate

## Architecture
- **Monorepo** (pnpm workspaces): `apps/one` (Next.js frontend), `apps/worker` (crawl worker), `packages/api-client` (shared hooks/schemas/geocode), `services/scraper_service` (FastAPI geocoding).
- **Database**: Postgres with PostGIS (MVT tiles via pg_tileserv), Redis for Bull queues.
- **Maps**: MapLibre GL JS + OpenFreeMap dark tiles (replaced Mapbox). MVT vector tiles from pg_tileserv at low zoom, GeoJSON fallback for clusters/filters.
- **Geocoding**: Census Bureau (batched, thread pool) + Nominatim (1 req/s fallback), cached in `geocode_cache`.

## Key Files
- `infrastructure/docker-compose.yml`: all 19 services (app, worker, scraper, postgres, redis, n8n, prometheus, grafana, alertmanager, pg_tileserv, unpollutr)
- `infrastructure/deploy.sh`: deploy wrapper (sources .env first)
- `apps/one/src/components/PropertyMap.tsx`: map component (maplibregl + OpenFreeMap + MVT)
- `packages/api-client/src/geocode.ts`: geocoding providers (CensusGeocoder, NominatimGeocoder, FallbackGeocoder, CachedGeocoder)
- `packages/api-client/src/hooks.ts`: TanStack Query hooks (useStats, useFeatured, etc.)
- `packages/api-client/src/schemas.ts`: Zod schemas (StatsResponseSchema, FeaturedResponseSchema, etc.)
- `apps/worker/src/crawl.ts`: worker that processes for_sale + for_rent per crawl job

## Deploy
```bash
./infrastructure/deploy.sh              # build + restart all containers
./infrastructure/deploy.sh app worker   # build + restart specific services
```

## Commands
- `pnpm dev` — local dev
- `pnpm build` — build all
- `pnpm lint` — lint all
- `pnpm typecheck` — typecheck all

## Migration Convention
SQL migrations in `infrastructure/migrations/` are named `<date>_<description>.sql`. Apply via psql against the production DB. After changing `listings_mvt` function, restart pg_tileserv container.

## Security
- No Mapbox tokens (replaced with OpenFreeMap + Census/Nominatim)
- `.env` file never committed; `.env.local` removed from history
- Git history purged of leaked secrets via `git filter-repo`
- All secrets must be rotated before decommissioning old server
