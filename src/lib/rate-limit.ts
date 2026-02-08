import { RateLimiterRedis } from 'rate-limiter-flexible';
import redis from './redis';

const rateLimiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'ratelimit',
    points: 100, // 100 requests
    duration: 60, // per 1 minute
});

export async function checkRateLimit(ip: string) {
    try {
        await rateLimiter.consume(ip);
        return true;
    } catch (rejRes) {
        return false;
    }
}
