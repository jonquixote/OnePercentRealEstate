import pool from '@/lib/db';
import redis from '@/lib/redis';

export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await pool.query('SELECT 1');
    checks.postgres = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.postgres = { ok: false, error: err.message };
  }

  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err: any) {
    checks.redis = { ok: false, error: err.message };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  return Response.json(
    { ok: allOk, checks, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
}
