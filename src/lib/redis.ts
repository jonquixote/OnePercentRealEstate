import Redis from 'ioredis';

// Use environment variable or default to localhost for development
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    // Retry strategy: exponential backoff up to 2 seconds, max 3 retries
    retryStrategy: (times) => {
        if (times > 3) {
            console.warn('Redis retry limit reached. Caching may be disabled.');
            return null; // Stop retrying
        }
        return Math.min(times * 50, 2000);
    }
});

redis.on('error', (err) => {
    // Log error but don't crash application
    console.warn('Redis connection error:', err.message);
});

redis.on('connect', () => {
    console.log('Connected to Redis');
});

export default redis;
