
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';

export async function GET() {
  let db: 'up' | 'down' = 'down';
  let redis_status: 'up' | 'down' = 'down';

  // DB: SELECT 1 with 2s timeout
  try {
    const client = await pool.connect();
    try {
      await Promise.race([
        client.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DB health check timeout')), 2000)
        ),
      ]);
      db = 'up';
    } finally {
      client.release();
    }
  } catch {
    db = 'down';
  }

  // Redis: best-effort PING
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis health check timeout')), 2000)
      ),
    ]);
    redis_status = 'up';
  } catch {
    redis_status = 'down';
  }

  const status = db === 'up' && redis_status === 'up' ? 'ok' : 'degraded';
  const buildId = process.env.BUILD_ID || process.env.NEXT_PUBLIC_BUILD_ID || 'unknown';
  const uptimeMs = Math.floor(process.uptime() * 1000);

  return NextResponse.json(
    { status, db, redis: redis_status, buildId, uptimeMs },
    { status: status === 'ok' ? 200 : 503 }
  );
}
