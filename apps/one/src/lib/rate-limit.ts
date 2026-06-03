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
export const estimateRentLimiter = makeLimiter(10, 60, 'rl:estimate-rent');
export const clustersLimiter = makeLimiter(30, 60, 'rl:clusters');
export const propertiesLimiter = makeLimiter(60, 60, 'rl:properties');
export const seedLimiter = makeLimiter(5, 60, 'rl:seed');

// Auth brute-force defence: 5 attempts / minute / IP, then a 5-minute lockout.
export const loginLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login',
  points: 5,
  duration: 60,
  blockDuration: 300,
  inMemoryBlockOnConsumed: 6,
});

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
