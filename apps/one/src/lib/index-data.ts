import pool from '@/lib/db';
import { rankSnapshots, type RankedRow, type SnapshotRow } from '@oper/primitives';

export interface IndexData {
  month: string | null;
  rows: RankedRow[];
}

// Reads the latest snapshot month as a YYYY-MM-DD string. Uses to_char so the
// value is stable regardless of the server's timezone (a Postgres date parsed
// by node-postgres and re-serialized can shift a day in TZs ahead of UTC).
export async function getLatestIndexMonth(): Promise<string | null> {
  const latest = await pool.query(
    `SELECT to_char(max(month), 'YYYY-MM-DD') AS m FROM index_snapshots`,
  );
  return latest.rows[0]?.m ?? null;
}

export function toSnapshotRows(dbRows: Array<Record<string, unknown>>): SnapshotRow[] {
  return dbRows.map((r) => ({
    metroSlug: String(r.metro_slug),
    metroLabel: String(r.metro_label),
    pctClearing: Number(r.pct_clearing),
    medianRatio: r.median_ratio != null ? Number(r.median_ratio) : null,
    liveCount: Number(r.live_count),
  }));
}

// Fetches the current month's ranked snapshots plus the prior month for
// momentum. Shared by the public page and the /api/index route.
export async function getRankedSnapshots(): Promise<IndexData> {
  const month = await getLatestIndexMonth();
  if (!month) return { month: null, rows: [] };
  const [cur, prior] = await Promise.all([
    pool.query(`SELECT * FROM index_snapshots WHERE month = $1`, [month]),
    pool.query(
      `SELECT * FROM index_snapshots WHERE month = ($1::date - interval '1 month')`,
      [month],
    ),
  ]);
  return { month, rows: rankSnapshots(toSnapshotRows(cur.rows), toSnapshotRows(prior.rows)) };
}
