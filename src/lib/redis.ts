import Redis from 'ioredis';

// Lazy-init: the Redis client must not be constructed at module load
// time, because the build graph (e.g. `next build` on Vercel) imports
// this file but doesn't have a real REDIS_URL in the build environment.
let _redis: Redis | null = null;

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set. Cannot initialize Redis client.');
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 100) return 5000;
      return Math.min(times * 100, 5000);
    },
    lazyConnect: true,
  });
  client.on('error', (err) => {
    console.warn('Redis connection error:', err.message);
  });
  return client;
}

const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    if (!_redis) _redis = createRedis();
    return Reflect.get(_redis, prop, receiver);
  },
});

export default redis;
