import Redis, { type Redis as RedisType } from 'ioredis';

// Lazy-init: the Redis client must not be constructed at module load
// time, because the build graph (e.g. `next build` on Vercel) imports
// this file but doesn't have a real REDIS_URL in the build environment.
//
// We export a Proxy that creates the underlying client on first property
// access and forwards everything else. The Proxy is needed because the
// `rate-limiter-flexible` library does `instanceof Redis` checks, so we
// also implement `getPrototypeOf` to expose the real Redis prototype.

let _redis: RedisType | null = null;

function createRedis(): RedisType {
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

const handler: ProxyHandler<RedisType> = {
  get(_target, prop, receiver) {
    if (!_redis) _redis = createRedis();
    const value = Reflect.get(_redis, prop, _redis);
    return typeof value === 'function' ? value.bind(_redis) : value;
  },
  has(_target, prop) {
    if (!_redis) _redis = createRedis();
    return Reflect.has(_redis, prop);
  },
  getPrototypeOf() {
    if (!_redis) _redis = createRedis();
    return Reflect.getPrototypeOf(_redis);
  },
};

const redis = new Proxy({} as RedisType, handler) as RedisType;

export default redis;
