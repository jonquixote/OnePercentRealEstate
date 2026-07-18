import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Pro Deal Flow — in-app deal-alert inbox.
 *
 * GET: newest 50 alert rows for the session user, JOINED to listings for
 * address / primary_photo (with the worker-stored `ratio`/`price` as the
 * authoritative figures, falling back to the live listing if needed). Also
 * returns `unread` = count of rows where read_at IS NULL.
 *
 * POST: { ids: [...] } marks those rows read_at = now(), scoped to the
 * session user (WHERE user_id = $1 AND id = ANY($2)) so a user can never
 * mark another user's alerts read.
 *
 * 401 when there is no session.
 */
const INBOX_SQL = `
  SELECT
    a.id,
    a.source,
    a.source_label,
    a.ratio,
    a.price,
    a.created_at,
    a.read_at,
    l.address,
    l.primary_photo,
    l.property_url,
    l.city,
    l.state,
    l.zip_code
  FROM alert_events a
  LEFT JOIN listings l ON l.id = a.listing_id
  WHERE a.user_id = $1
  ORDER BY a.created_at DESC
  LIMIT 50
`;

const UNREAD_SQL = `
  SELECT count(*)::int AS unread
  FROM alert_events
  WHERE user_id = $1 AND read_at IS NULL
`;

const MARK_READ_SQL = `
  UPDATE alert_events
  SET read_at = now()
  WHERE user_id = $1 AND id = ANY($2)
`;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });

  const [rows, unread] = await Promise.all([
    pool.query(INBOX_SQL, [user.id]),
    pool.query(UNREAD_SQL, [user.id]),
  ]);

  return NextResponse.json({
    alerts: rows.rows,
    unread: Number(unread.rows[0]?.unread ?? 0),
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number)
      : [];
    if (ids.length === 0) return NextResponse.json({ updated: 0 });

    const res = await pool.query(MARK_READ_SQL, [user.id, ids]);
    return NextResponse.json({ updated: res.rowCount ?? 0 });
  } catch (err) {
    console.error('POST /api/alerts error:', err);
    return NextResponse.json({ error: 'failed to mark read' }, { status: 500 });
  }
}
