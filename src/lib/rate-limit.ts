import { RateLimiterRedis } from 'rate-limiter-flexible';
import redis from './redis';

function makeLimiter(points: number, duration: number, keyPrefix: string) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration,
    inMemoryBlockOnConsumed: points + 1,
  });
}

export const scrapeLimiter = makeLimiter(1, 30, 'rl:scrape');
export const fetchRentalsLimiter = makeLimiter(1, 30, 'rl:fetch');
export const checkoutLimiter = makeLimiter(5, 60, 'rl:checkout');
export const viewportLimiter = makeLimiter(100, 60, 'rl:viewport');

export async function checkRateLimit(
  limiter: RateLimiterRedis,
  key: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    await limiter.consume(key, 1);
    return { allowed: true };
  } catch (err: any) {
    if (err && typeof err.msBeforeNext === 'number') {
      return { allowed: false, retryAfter: Math.ceil(err.msBeforeNext / 1000) };
    }
    console.warn('Rate limit check failed, allowing request:', err);
    return { allowed: true };
  }
}
