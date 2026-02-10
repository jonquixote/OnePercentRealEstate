
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { Redis } from 'ioredis';

export async function GET() {
    const healthStatus = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            database: 'unknown',
            redis: 'unknown',
        },
    };

    // Check Database
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        healthStatus.services.database = 'healthy';
    } catch (error) {
        console.error('Health Check - Database Error:', error);
        healthStatus.services.database = 'unhealthy';
        healthStatus.status = 'degraded';
    }

    // Check Redis
    try {
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        await redis.ping();
        redis.disconnect();
        healthStatus.services.redis = 'healthy';
    } catch (error) {
        console.error('Health Check - Redis Error:', error);
        healthStatus.services.redis = 'unhealthy';
        healthStatus.status = 'degraded';
    }

    return NextResponse.json(healthStatus, {
        status: healthStatus.status === 'ok' ? 200 : 503,
    });
}
