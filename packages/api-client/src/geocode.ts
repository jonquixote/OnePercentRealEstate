/**
 * Mapbox geocoding with token bucket rate limit + permanent cache.
 *
 * Token bucket: 10 req/sec ceiling per Mapbox SLA. Implement async
 * token-taking so workers can yield while waiting for capacity.
 *
 * Cache: permanent storage of (query_hash -> lat/lon). Misses expire
 * after 7d so transient outages don't poison the cache forever.
 *
 * This module is consumed by Node workers (today: future; tomorrow: scraper).
 * The Python scraper currently talks to Mapbox directly; Wave 8 will
 * retrofit it to use this service via HTTP.
 */

import type { Pool } from 'pg';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

/**
 * Simple async token bucket for rate limiting. Calls to `take()` resolve
 * when a token is available. Capacity is fixed at construction; refill rate
 * is tokens per second.
 *
 * Not a singleton — each caller (e.g., different worker instances) gets
 * their own bucket. In a multi-worker setup, consider moving the bucket to
 * a shared Redis instance.
 */
export class TokenBucket {
  private available: number;
  private lastRefillTime: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly waiters: Array<() => void> = [];

  constructor(capacity: number, refillPerSec: number) {
    if (capacity <= 0 || refillPerSec <= 0) {
      throw new Error('TokenBucket capacity and refillPerSec must be positive');
    }
    this.capacity = capacity;
    this.available = capacity;
    this.refillPerSec = refillPerSec;
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquire one token. If none available, returns a promise that resolves
   * when the next token is available.
   */
  async take(): Promise<void> {
    this.refill();

    if (this.available > 0) {
      this.available -= 1;
      return;
    }

    // Wait for a refill. Calculate how long to sleep: 1 / refillPerSec ms.
    const timePerToken = 1000 / this.refillPerSec;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(() => {
        this.refill();
        const next = this.waiters.shift();
        if (next) {
          next();
        } else if (this.available > 0) {
          this.available -= 1;
        }
      }, timePerToken);
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const tokensToAdd = elapsed * this.refillPerSec;

    if (tokensToAdd > 0) {
      this.available = Math.min(this.capacity, this.available + tokensToAdd);
      this.lastRefillTime = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Geocode Provider Interface
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export interface GeocodeProvider {
  lookup(query: string): Promise<GeocodeResult | null>;
}

// ---------------------------------------------------------------------------
// Mapbox Geocoder
// ---------------------------------------------------------------------------

/**
 * Fetch-based Mapbox geocoding. Calls the Places API forward search endpoint.
 * Returns the first feature's [lng, lat]; treats network errors and HTTP
 * errors as null (no throw).
 */
export class MapboxGeocoder implements GeocodeProvider {
  constructor(private token: string) {
    if (!token || token.length === 0) {
      throw new Error('Mapbox token required');
    }
  }

  async lookup(query: string): Promise<GeocodeResult | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${this.token}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        // 4xx, 5xx — treat as null, log if necessary
        return null;
      }

      const json = (await response.json()) as {
        features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
      };

      const features = json.features || [];
      if (features.length === 0) {
        return null;
      }

      const coords = features[0].geometry?.coordinates;
      if (!coords || coords.length < 2) {
        return null;
      }

      const [lng, lat] = coords;
      return {
        latitude: lat,
        longitude: lng,
      };
    } catch {
      // Network error, timeout, or parse error — return null
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Cached Geocoder
// ---------------------------------------------------------------------------

/**
 * Wraps a GeocodeProvider with PostgreSQL caching. On each lookup:
 *  1. Check if query_hash is in geocode_cache.
 *  2. On hit: return cached result (ignore expiry for successful lookups).
 *  3. On miss: acquire a token, call provider, upsert result into cache, return.
 *
 * Token bucket: one global instance per CachedGeocoder. Workers can share
 * a single CachedGeocoder to coordinate rate limiting.
 */
export class CachedGeocoder {
  private bucket: TokenBucket;

  constructor(
    private pool: Pool,
    private provider: GeocodeProvider,
    bucket?: TokenBucket
  ) {
    // Default: 10 req/sec per Mapbox SLA. Caller can override via ctor param.
    this.bucket = bucket || new TokenBucket(10, 10);
  }

  async lookup(query: string): Promise<GeocodeResult | null> {
    const queryHash = this.hashQuery(query);

    // Check cache
    const cached = await this.checkCache(queryHash);
    if (cached !== undefined) {
      return cached;
    }

    // Cache miss: acquire token, call provider, write result
    await this.bucket.take();

    const result = await this.provider.lookup(query);

    // Write to cache
    await this.writeCache(queryHash, query, result);

    return result;
  }

  private hashQuery(query: string): string {
    const lower = query.toLowerCase().trim();
    return crypto.createHash('sha256').update(lower).digest('hex').slice(0, 64);
  }

  private async checkCache(
    queryHash: string
  ): Promise<GeocodeResult | null | undefined> {
    try {
      const result = await this.pool.query(
        `SELECT latitude, longitude, miss, expires_at FROM geocode_cache
         WHERE query_hash = $1`,
        [queryHash]
      );

      if (result.rows.length === 0) {
        return undefined; // Not in cache
      }

      const row = result.rows[0] as {
        latitude: number | null;
        longitude: number | null;
        miss: boolean;
        expires_at: string | null;
      };

      // If it's a miss and expired, treat as cache miss
      if (row.miss && row.expires_at) {
        const expiresAt = new Date(row.expires_at);
        if (expiresAt < new Date()) {
          return undefined;
        }
      }

      // Successful lookup or non-expired miss
      if (!row.miss && row.latitude && row.longitude) {
        return {
          latitude: row.latitude,
          longitude: row.longitude,
        };
      }

      // Expired miss or successful null
      return null;
    } catch {
      return undefined; // Cache query failed; treat as miss
    }
  }

  private async writeCache(
    queryHash: string,
    query: string,
    result: GeocodeResult | null
  ): Promise<void> {
    try {
      if (result) {
        // Successful lookup — no expiry
        await this.pool.query(
          `INSERT INTO geocode_cache (query_hash, query, latitude, longitude, provider, miss, attempts)
           VALUES ($1, $2, $3, $4, $5, false, 1)
           ON CONFLICT (query_hash) DO UPDATE SET
             attempts = geocode_cache.attempts + 1,
             resolved_at = now()
           WHERE geocode_cache.miss = false`,
          [queryHash, query, result.latitude, result.longitude, 'mapbox']
        );
      } else {
        // Miss — expires after 7 days
        await this.pool.query(
          `INSERT INTO geocode_cache (query_hash, query, miss, attempts, expires_at)
           VALUES ($1, $2, true, 1, now() + interval '7 days')
           ON CONFLICT (query_hash) DO UPDATE SET
             attempts = geocode_cache.attempts + 1,
             expires_at = now() + interval '7 days'
           WHERE geocode_cache.miss = true`,
          [queryHash, query]
        );
      }
    } catch {
      // Cache write failed — don't crash, just skip caching this result
    }
  }
}
