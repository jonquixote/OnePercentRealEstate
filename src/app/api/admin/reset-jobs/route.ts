import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: Request) {
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
