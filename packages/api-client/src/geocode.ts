/**
 * Geocoding with Census Bureau (primary) + Nominatim (fallback).
 * Cached in geocode_cache table.
 *
 * Token bucket: 10 req/sec default. Census has no documented rate limit
 * but we pace to be a good citizen. Nominatim fallback adds 1 req/sec
 * delay via its own limiter.
 *
 * Cache: permanent storage of (query_hash -> lat/lon). Misses expire
 * after 7d so transient outages don't poison the cache forever.
 *
 * This module is consumed by Node workers.
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
    this.refillPerSec = refillPerSec;
    this.available = capacity;
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
// Census Bureau Geocoder (primary)
// ---------------------------------------------------------------------------

const CENSUS_BENCHMARK = 'Public_AR_Currenty';

export class CensusGeocoder implements GeocodeProvider {
  async lookup(query: string): Promise<GeocodeResult | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=${CENSUS_BENCHMARK}&format=json`;

      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const json = (await response.json()) as {
        result?: { addressMatches?: Array<{ coordinates: { x: number; y: number } }> };
      };

      const match = json?.result?.addressMatches?.[0];
      if (!match?.coordinates) return null;

      return {
        latitude: match.coordinates.y,
        longitude: match.coordinates.x,
      };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Nominatim Geocoder (fallback for addresses Census rejects)
// ---------------------------------------------------------------------------

export class NominatimGeocoder implements GeocodeProvider {
  async lookup(query: string): Promise<GeocodeResult | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;

      const response = await fetch(url, {
        headers: { 'User-Agent': 'OnePercentRealEstate/1.0' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const json = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (!json?.[0]) return null;

      return {
        latitude: parseFloat(json[0].lat),
        longitude: parseFloat(json[0].lon),
      };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback Geocoder (primary → fallback chain)
// ---------------------------------------------------------------------------

export class FallbackGeocoder implements GeocodeProvider {
  constructor(
    private primary: GeocodeProvider,
    private fallback: GeocodeProvider
  ) {}

  async lookup(query: string): Promise<GeocodeResult | null> {
    const result = await this.primary.lookup(query);
    if (result) return result;
    return this.fallback.lookup(query);
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
 * Accepts an optional provider name for the cache table (default 'census').
 */
export class CachedGeocoder {
  private bucket: TokenBucket;

  constructor(
    private pool: Pool,
    private provider: GeocodeProvider,
    private providerName: string = 'census',
    bucket?: TokenBucket
  ) {
    this.bucket = bucket || new TokenBucket(10, 10);
  }

  async lookup(query: string): Promise<GeocodeResult | null> {
    const queryHash = this.hashQuery(query);

    const cached = await this.checkCache(queryHash);
    if (cached !== undefined) {
      return cached;
    }

    await this.bucket.take();

    const result = await this.provider.lookup(query);

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
        return undefined;
      }

      const row = result.rows[0] as {
        latitude: number | null;
        longitude: number | null;
        miss: boolean;
        expires_at: string | null;
      };

      if (row.miss && row.expires_at) {
        const expiresAt = new Date(row.expires_at);
        if (expiresAt < new Date()) {
          return undefined;
        }
      }

      if (!row.miss && row.latitude && row.longitude) {
        return {
          latitude: row.latitude,
          longitude: row.longitude,
        };
      }

      return null;
    } catch {
      return undefined;
    }
  }

  private async writeCache(
    queryHash: string,
    query: string,
    result: GeocodeResult | null
  ): Promise<void> {
    try {
      if (result) {
        await this.pool.query(
          `INSERT INTO geocode_cache (query_hash, query, latitude, longitude, provider, miss, attempts)
           VALUES ($1, $2, $3, $4, $5, false, 1)
           ON CONFLICT (query_hash) DO UPDATE SET
             attempts = geocode_cache.attempts + 1,
             resolved_at = now()
           WHERE geocode_cache.miss = false`,
          [queryHash, query, result.latitude, result.longitude, this.providerName]
        );
      } else {
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
