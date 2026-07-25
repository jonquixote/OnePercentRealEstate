import redis from '@/lib/redis';

/**
 * Stale-while-revalidate cache with single-flight.
 *
 * Deliberately separate from `cached()` in ./cache.ts — that helper's
 * behaviour is relied on by many call sites and is left untouched.
 *
 * Why this exists: a plain TTL cache makes every expiry a user-visible stall.
 * The homepage hero aggregate takes ~18s, so with a 120s TTL a real user ate
 * the full cost every couple of minutes, and because nothing coalesced the
 * misses, every visitor who arrived during that window ran their own copy of
 * the same query. Here:
 *
 *   fresh  (age <= ttl)          -> serve, no work
 *   stale  (ttl < age <= staleTtl) -> serve the STALE value immediately,
 *                                     refresh in the background (one winner)
 *   absent                        -> compute inline, but only one caller does;
 *                                     the rest wait for that single result
 */

interface Envelope<T> {
  value: T;
  computedAt: number; // epoch ms
}

const LOCK_TTL_MS = 60_000;

const keyOf = (key: string) => `swr:${key}`;
const lockOf = (key: string) => `swr:lock:${key}`;

async function readEnvelope<T>(key: string): Promise<Envelope<T> | null> {
  try {
    const raw = await redis.get(keyOf(key));
    if (!raw) return null;
    return JSON.parse(raw) as Envelope<T>;
  } catch {
    return null; // treat unreadable/corrupt cache as a miss
  }
}

async function writeEnvelope<T>(key: string, value: T): Promise<void> {
  try {
    await redis.set(keyOf(key), JSON.stringify({ value, computedAt: Date.now() } satisfies Envelope<T>));
  } catch {
    /* cache write failures must never fail the request */
  }
}

/** Try to become the single refresher. Returns true if we won the lock. */
async function acquireLock(key: string): Promise<boolean> {
  try {
    const res = await redis.set(lockOf(key), '1', 'PX', LOCK_TTL_MS, 'NX');
    return res === 'OK';
  } catch {
    // If the lock store is unavailable, allow the refresh rather than stall.
    return true;
  }
}

async function releaseLock(key: string): Promise<void> {
  try {
    await redis.del(lockOf(key));
  } catch {
    /* the PX expiry is the backstop */
  }
}

/**
 * @param ttlS      age (seconds) below which the value is considered fresh
 * @param staleTtlS age (seconds) beyond which a stale value is no longer served
 */
export async function cachedSWR<T>(
  key: string,
  ttlS: number,
  staleTtlS: number,
  loader: () => Promise<T>,
): Promise<T> {
  const env = await readEnvelope<T>(key);
  const ageS = env ? (Date.now() - env.computedAt) / 1000 : Infinity;

  // FRESH — nothing to do.
  if (env && ageS <= ttlS) return env.value;

  // STALE but usable — serve immediately, refresh behind the request.
  if (env && ageS <= staleTtlS) {
    if (await acquireLock(key)) {
      void (async () => {
        try {
          const fresh = await loader();
          await writeEnvelope(key, fresh);
        } catch {
          // Keep serving the last good value; the next request retries.
        } finally {
          await releaseLock(key);
        }
      })();
    }
    return env.value;
  }

  // ABSENT (or too stale to serve) — exactly one caller computes.
  if (await acquireLock(key)) {
    try {
      const fresh = await loader();
      await writeEnvelope(key, fresh);
      return fresh;
    } finally {
      await releaseLock(key);
    }
  }

  // Lost the race: wait briefly for the winner's result rather than
  // duplicating an expensive query.
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const retry = await readEnvelope<T>(key);
    if (retry) return retry.value;
  }

  // Winner never landed a value — fall back to computing ourselves.
  return loader();
}
