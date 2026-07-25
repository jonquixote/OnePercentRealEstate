import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { cachedSWR } from '@/lib/cache-swr';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

/**
 * Data pipeline health endpoint. Returns counts of rent_calc_status
 * by state so ops can monitor backfill progress and catch stuck rows.
 *
 * CACHED, deliberately. This aggregate FILTERs over ~1.3M rows and was
 * measured at 9.98s on prod — and `oper-healthcheck` calls it every 2 minutes,
 * so an uncached version spends ~8% of wall-clock time full-scanning `listings`
 * to produce numbers that move on a 10-minute backfill cadence.
 *
 * 30 min fresh / 24 h stale puts the duty cycle near 0.5% while readers still
 * get an instant answer. Freshness is not the point here: nobody diagnoses a
 * stuck backfill from a 30-second-old count.
 */
export async function GET() {
  return withSpan('api.stats.health', () => handleGet());
}

async function handleGet() {
  try {
    const payload = await cachedSWR('stats:health:v1', 1800, 86_400, computeHealth);
    return NextResponse.json(
      { ...payload, checkedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('/api/stats/health error:', err);
    return NextResponse.json({ error: 'health check failed' }, { status: 500 });
  }
}

async function computeHealth() {
  {
    const client = await pool.connect();
    try {
      const sql = `
        SELECT
          count(*) FILTER (WHERE rent_calc_status = 'pending')::int AS pending,
          count(*) FILTER (WHERE rent_calc_status = 'done')::int AS done,
          count(*) FILTER (WHERE rent_calc_status = 'failed')::int AS failed,
          -- Rows with nothing to estimate (vacant land etc). Counted separately
          -- so they stop inflating 'done' — 88,188 of them once did.
          count(*) FILTER (WHERE rent_calc_status = 'not_applicable')::int AS not_applicable,
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

      return ({
        pending: Number(row.pending) || 0,
        done: Number(row.done) || 0,
        failed: Number(row.failed) || 0,
        not_applicable: Number(row.not_applicable) || 0,
        totalListings: Number(row.total_listings) || 0,
        lastCompleted: row.last_completed ?? null,
      });
    } finally {
      client.release();
    }
  }
}
