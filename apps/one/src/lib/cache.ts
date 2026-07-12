import redis from '@/lib/redis';

export const CACHE_VERSION_KEY = 'props:version';

/**
 * TTL taxonomy (seconds). Single source of truth — never inline a magic
 * number at a call site.
 *   listing data (properties / search) : 60
 *   stats (market aggregates)           : 300
 *   HUD / expensive computed            : 86400 (24h)
 */
export const CACHE_TTL = {
  listing: 60,
  stats: 300,
  hud: 86400,
} as const;

export async function getCacheVersion(): Promise<string> {
  try {
    let v = await redis.get(CACHE_VERSION_KEY);
    if (!v) {
      await redis.set(CACHE_VERSION_KEY, '1');
      v = '1';
    }
    return v;
  } catch {
    return '0';
  }
}

export async function bumpCacheVersion(): Promise<void> {
  try {
    await redis.incr(CACHE_VERSION_KEY);
  } catch (err) {
    console.warn('Redis cache version bump failed:', err);
  }
}

/**
 * Read-through cache. The shared `props:version` is prepended to `key` so a
 * single `bumpCacheVersion()` invalidates every entry at once. On redis
 * failure we degrade to a direct `fn()` call (never throw to the caller).
 *
 * `null`/`undefined` returns are intentionally NOT written — negative
 * caching would mask a later "no data" → "has data" transition (e.g. HUD
 * SAFMR lookups).
 */
export async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
): Promise<T> {
  const version = await getCacheVersion();
  const cacheKey = `v${version}:${key}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as T;
  } catch (err) {
    console.warn('Redis cache read failed:', err);
  }

  const value = await fn();

  if (value === null || value === undefined) return value;

  try {
    await redis.set(cacheKey, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    console.warn('Redis cache write failed:', err);
  }
  return value;
}
