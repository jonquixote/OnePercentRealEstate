import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { safeErrorResponse } from '@/lib/api-error';
import { timingSafeEqual } from 'crypto';

function isAdmin(req: Request): boolean {
  const provided = req.headers.get('x-api-key') || req.headers.get('x-admin-key');
  const expected = process.env.ADMIN_API_KEY;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
    if (!isAdmin(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client = await pool.connect();
    try {
        // Reset jobs that have been 'processing' for more than 5 minutes
        const result = await client.query(
            `UPDATE crawl_jobs 
             SET status = 'pending', started_at = NULL 
             WHERE status = 'processing' 
             AND started_at < NOW() - INTERVAL '5 minutes'
             RETURNING id, region_value, started_at`
        );

        return NextResponse.json({
            success: true,
            reset_count: result.rowCount,
            jobs: result.rows
        });

} catch (error: any) {
    return safeErrorResponse(error, 500);
  }
}
