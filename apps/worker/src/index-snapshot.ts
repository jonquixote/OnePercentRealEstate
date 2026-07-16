import { Pool } from 'pg';
import { loadEnv } from './env.js';

export type IndexMetro = { slug: string; label: string; zip3: string[]; repZip: string };
export type SnapshotInsert = {
  metro_slug: string; metro_label: string; month: string;
  live_count: number; clearing_count: number; pct_clearing: number; median_ratio: number | null;
};

// NOTE: keep this list in sync with apps/one/src/lib/index-metros.ts. The two
// apps do not share a runtime package for this reference; see plan sync note.
export const INDEX_METROS: IndexMetro[] = [
  { slug: 'houston', label: 'Houston', zip3: ['770','772','773','774','775'], repZip: '77002' },
  { slug: 'san-antonio', label: 'San Antonio', zip3: ['780','782'], repZip: '78201' },
  { slug: 'memphis', label: 'Memphis', zip3: ['380','381'], repZip: '38106' },
  { slug: 'cleveland', label: 'Cleveland', zip3: ['441'], repZip: '44102' },
  { slug: 'columbus', label: 'Columbus', zip3: ['432','430','431'], repZip: '43206' },
  { slug: 'atlanta', label: 'Atlanta', zip3: ['303','300','301'], repZip: '30310' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336','335'], repZip: '33604' },
  { slug: 'indianapolis', label: 'Indianapolis', zip3: ['462','461'], repZip: '46201' },
  { slug: 'kansas-city', label: 'Kansas City', zip3: ['641','640'], repZip: '64127' },
  { slug: 'birmingham', label: 'Birmingham', zip3: ['352'], repZip: '35211' },
  { slug: 'los-angeles', label: 'Los Angeles', zip3: ['900','910','913'], repZip: '90004' },
  { slug: 'chicago', label: 'Chicago', zip3: ['606','604'], repZip: '60620' },
];

// Maps each live listing to a metro via zip3, then aggregates clearing share and
// median ratio per metro in one pass. Metro membership is a VALUES join so it is
// fully parameterized and index-friendly on left(zip_code,3).
export function buildSnapshotQuery(metros: IndexMetro[]): { sql: string; params: unknown[] } {
  const pairs: string[] = [];
  const params: unknown[] = [];
  metros.forEach((m) => {
    m.zip3.forEach((z) => { params.push(z, m.slug); pairs.push(`($${params.length - 1}, $${params.length})`); });
  });
  const sql = `
    WITH metro_zip(zip3, metro_slug) AS (VALUES ${pairs.join(', ')})
    SELECT mz.metro_slug,
           count(*)::int AS live_count,
           count(*) FILTER (WHERE (l.estimated_rent / l.price) >= 0.01)::int AS clearing_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (l.estimated_rent / l.price)) AS median_ratio
    FROM listings l
    JOIN metro_zip mz ON mz.zip3 = left(l.zip_code, 3)
    WHERE l.listing_type = 'for_sale' AND public.is_rentable(l.property_type)
      AND l.price > 0 AND l.estimated_rent > 0
    GROUP BY mz.metro_slug`;
  return { sql, params };
}

export function shapeSnapshotRows(
  dbRows: Array<Record<string, unknown>>, metros: IndexMetro[], month: string,
): SnapshotInsert[] {
  // Always iterate over every committed metro and zero-fill any that the DB
  // query did not return, so the monthly snapshot has no gaps.
  const bySlug = new Map(dbRows.map((r) => [String(r.metro_slug), r]));
  return metros.map((m) => {
    const r = bySlug.get(m.slug);
    const live = r ? Number(r.live_count) : 0;
    const clearing = r ? Number(r.clearing_count) : 0;
    const median = r && r.median_ratio != null ? Number(r.median_ratio) : null;
    return {
      metro_slug: m.slug, metro_label: m.label, month,
      live_count: live, clearing_count: clearing,
      pct_clearing: live > 0 ? clearing / live : 0,
      median_ratio: median,
    };
  });
}

function currentMonthUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Entry point: compute + upsert the current month, then exit (run by a timer).
export async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const month = currentMonthUTC();
    const { sql, params } = buildSnapshotQuery(INDEX_METROS);
    const res = await pool.query(sql, params);
    const rows = shapeSnapshotRows(res.rows, INDEX_METROS, month);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO index_snapshots (metro_slug, metro_label, month, live_count, clearing_count, pct_clearing, median_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (metro_slug, month) DO UPDATE
           SET live_count=EXCLUDED.live_count, clearing_count=EXCLUDED.clearing_count,
               pct_clearing=EXCLUDED.pct_clearing, median_ratio=EXCLUDED.median_ratio`,
        [r.metro_slug, r.metro_label, r.month, r.live_count, r.clearing_count, r.pct_clearing, r.median_ratio],
      );
    }
    console.log(JSON.stringify({ msg: 'index snapshot built', month, metros: rows.length }));
  } finally {
    await pool.end();
  }
}

// Run when invoked directly (tsx src/index-snapshot.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
