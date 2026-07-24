import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { safeErrorResponse } from '@/lib/api-error';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

// Read-only surface for slow-query + index-usage analysis. Gated on
// ADMIN_API_KEY like the other /api/admin routes. To establish a fresh
// measurement baseline, an operator runs ops/db/reset-stats.sh once after
// deploying. The endpoint itself never mutates stats.

function isAdmin(req: Request): boolean {
  const provided = req.headers.get('x-api-key') || req.headers.get('x-admin-key');
  const expected = process.env.ADMIN_API_KEY;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const [totalTime, meanTime, idxUsage] = await Promise.all([
      client.query(
        `SELECT query, calls, mean_exec_time, total_exec_time
         FROM pg_stat_statements
         ORDER BY total_exec_time DESC
         LIMIT 20`,
      ),
      client.query(
        `SELECT query, calls, mean_exec_time, total_exec_time
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC
         LIMIT 20`,
      ),
      client.query(
        `SELECT s.schemaname, s.relname, s.indexrelname, s.idx_scan,
                t.idx_blks_read,
                pg_relation_size(s.indexrelid) AS size_bytes
         FROM pg_stat_user_indexes s
         LEFT JOIN pg_statio_user_indexes t
           ON s.indexrelid = t.indexrelid
         ORDER BY size_bytes DESC
         LIMIT 50`,
      ),
    ]);

    return NextResponse.json({
      topByTotalTime: totalTime.rows,
      topByMeanTime: meanTime.rows,
      indexUsage: idxUsage.rows,
    });
  } catch (error) {
    return safeErrorResponse(error, 500);
  } finally {
    client.release();
  }
}
