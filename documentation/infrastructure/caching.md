# Caching & Performance

To ensure reliability during high traffic and protect external APIs, we use **Redis** as a caching and rate-limiting layer.

## 🔴 Redis Integration

Redis is deployed as a Docker service and used by the Next.js application via the `ioredis` client.

### Use Cases

1. **API Rate Limiting**: Prevents abuse of property search and rent estimation endpoints.
2. **Data Caching**: Caches expensive database queries and HUD API responses.

## 🛡️ Rate Limiting

We use `rate-limiter-flexible` with Redis to enforce limits per IP.

- **Endpoints Protected**:
  - `/api/estimate-rent`
  - `/api/properties`
  - `/api/scrape`

## ⚡ Performance Optimization

- **MVT Caching**: `pg_tileserv` handles the heavy lifting for map data, reducing the load on the main Next.js API.
- **Connection Pooling**: Uses `pg-pool` to manage database connections efficiently.
