import Redis from 'ioredis';
import { env } from '@/lib/env';

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 100) return 5000;
    return Math.min(times * 100, 5000);
  },
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.warn('Redis connection error:', err.message);
});

redis.on('connect', () => {
});

export default redis;
