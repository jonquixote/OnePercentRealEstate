import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { rankSnapshots, type SnapshotRow } from '@oper/primitives';

export const dynamic = 'force-dynamic';

export function toSnapshotRows(dbRows: Array<Record<string, unknown>>): SnapshotRow[] {
  return dbRows.map((r) => ({
    metroSlug: String(r.metro_slug),
    metroLabel: String(r.metro_label),
    pctClearing: Number(r.pct_clearing),
    medianRatio: r.median_ratio != null ? Number(r.median_ratio) : null,
    liveCount: Number(r.live_count),
  }));
}

export async function GET() {
  try {
    const latest = await pool.query(`SELECT max(month) AS m FROM index_snapshots`);
    const month: string | null = latest.rows[0]?.m ? new Date(latest.rows[0].m).toISOString().slice(0, 10) : null;
    if (!month) return NextResponse.json({ month: null, rows: [] });
    const [cur, prior] = await Promise.all([
      pool.query(`SELECT * FROM index_snapshots WHERE month = $1`, [month]),
      pool.query(`SELECT * FROM index_snapshots WHERE month = ($1::date - interval '1 month')`, [month]),
    ]);
    const rows = rankSnapshots(toSnapshotRows(cur.rows), toSnapshotRows(prior.rows));
    return NextResponse.json({ month, rows });
  } catch (err) {
    console.error('/api/index error:', err);
    return NextResponse.json({ month: null, rows: [] }, { status: 200 });
  }
}
