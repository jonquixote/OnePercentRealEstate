import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Wave 5 — session-scoped watchlist CRUD. A watchlist is a named criteria
 * query (query_json) that apps/worker/src/watchlist-alerts.ts evaluates
 * every ~15 min against new inventory; matches become alert rows (and
 * emails once user_alert_prefs.email is set).
 *
 * query_json values must fit the worker's compiler: scalar equality,
 * arrays (IN), or {min,max} ranges, over a strict column whitelist that
 * MUST stay in sync with validateWatchlistColumn() in the worker.
 */
const ALLOWED_COLUMNS = new Set([
  'price', 'bedrooms', 'bathrooms', 'sqft', 'estimated_rent', 'year_built',
  'state', 'city', 'zip_code',
  // Wave 5 additions (mirrored in the worker)
  'sale_type', 'price_cut_pct', 'days_on_market', 'property_type',
]);

function validateQueryJson(q: unknown): string | null {
  if (q == null || typeof q !== 'object' || Array.isArray(q)) return 'query must be an object';
  const entries = Object.entries(q as Record<string, unknown>);
  if (entries.length === 0) return 'query must have at least one condition';
  if (entries.length > 12) return 'too many conditions';
  for (const [k, v] of entries) {
    if (!ALLOWED_COLUMNS.has(k)) return `column not allowed: ${k}`;
    if (Array.isArray(v)) {
      if (v.length === 0 || v.length > 20) return `bad IN list for ${k}`;
      if (!v.every((x) => ['string', 'number'].includes(typeof x))) return `bad IN values for ${k}`;
    } else if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      const keys = Object.keys(r);
      if (!keys.every((x) => x === 'min' || x === 'max')) return `bad range keys for ${k}`;
      if (keys.length === 0) return `empty range for ${k}`;
      if (!keys.every((x) => typeof r[x] === 'number')) return `range values must be numbers for ${k}`;
    } else if (!['string', 'number', 'boolean'].includes(typeof v)) {
      return `bad value for ${k}`;
    }
  }
  return null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  const res = await pool.query(
    `SELECT id, name, query_json, created_at, last_evaluated_at
       FROM watchlists WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  return NextResponse.json(res.rows);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const err = validateQueryJson(body?.query);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const count = await pool.query('SELECT count(*) FROM watchlists WHERE user_id = $1', [user.id]);
    if (Number(count.rows[0].count) >= 25) {
      return NextResponse.json({ error: 'watchlist limit reached (25)' }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO watchlists (user_id, name, query_json)
       VALUES ($1, $2, $3) RETURNING id, name, query_json, created_at`,
      [user.id, name, JSON.stringify(body.query)],
    );
    // Ensure alert prefs exist so email digests can flow once the user has one.
    await pool.query(
      `INSERT INTO user_alert_prefs (user_id, email)
       VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
      [user.id, user.email || null],
    );
    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (err) {
    console.error('POST /api/watchlists error:', err);
    return NextResponse.json({ error: 'failed to create watchlist' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^\d{1,18}$/.test(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const res = await pool.query('DELETE FROM watchlists WHERE id = $1 AND user_id = $2', [id, user.id]);
  return NextResponse.json({ deleted: res.rowCount });
}
