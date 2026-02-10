
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';

export async function GET() {
    const healthStatus = {
        status: 'ok' as 'ok' | 'degraded',
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
        // Just check if we can ping the singleton
        await redis.ping();
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
