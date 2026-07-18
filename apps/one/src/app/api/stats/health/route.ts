import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Data pipeline health endpoint. Returns counts of rent_calc_status
 * by state so ops can monitor backfill progress and catch stuck rows.
 * No caching — always returns fresh data.
 */
export async function GET() {
  try {
    const client = await pool.connect();
    try {
      const sql = `
        SELECT
          count(*) FILTER (WHERE rent_calc_status = 'pending')::int AS pending,
          count(*) FILTER (WHERE rent_calc_status = 'done')::int AS done,
          count(*) FILTER (WHERE rent_calc_status = 'failed')::int AS failed,
          count(*)::int AS total_listings,
          max(updated_at) FILTER (WHERE rent_calc_status = 'done') AS last_completed
        FROM listings
        WHERE listing_type = 'for_sale'
          -- Lifecycle filter (issue #51): health tracks the ACTIVE backfill
          -- queue. Off-market rows (sold/stale/rental_misfiled) no longer need
          -- a rent estimate, so excluding them keeps pending/done/failed honest.
          AND listing_status NOT IN ('sold','stale','rental_misfiled')
      `;
      const result = await client.query(sql);
      const row = result.rows[0] ?? {};

      return NextResponse.json({
        pending: Number(row.pending) || 0,
        done: Number(row.done) || 0,
        failed: Number(row.failed) || 0,
        totalListings: Number(row.total_listings) || 0,
        lastCompleted: row.last_completed ?? null,
        checkedAt: new Date().toISOString(),
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/stats/health error:', err);
    return NextResponse.json({ error: 'health check failed' }, { status: 500 });
  }
}
