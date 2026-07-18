import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Wave 6 — session-scoped per-listing saves (the "Investor's Shelf").
 * A saved property is a user↔listing scrapbook row (saved_properties); it is
 * NOT a criteria watchlist. POST is idempotent (ON CONFLICT DO NOTHING) and
 * returns the existing id when already saved. DELETE only removes the session
 * user's own row. GET hydrates the listing card via a JOIN.
 *
 * The listings JOIN references listing_status/sold_price/sold_date which ship
 * with the Listing Truth plan; if those columns are absent (SQLSTATE 42703)
 * we fall back to a SELECT without them and serve cards without a badge.
 *
 * Session identity (`getSessionUser()`) is the only source of user_id; no
 * client-supplied user ids. 401 without a session.
 */

const SELECT_WITH_STATUS = `
  SELECT sp.id AS save_id, sp.note, sp.created_at AS saved_at,
         l.id::text AS id, l.address, l.price, l.estimated_rent, l.rent_price_ratio,
         l.listing_status, l.sold_price, l.sold_date,
         COALESCE(l.primary_photo, l.images->>0) AS primary_photo, l.zip_code
    FROM saved_properties sp JOIN listings l ON l.id = sp.listing_id
   WHERE sp.user_id = $1 ORDER BY sp.created_at DESC LIMIT 200
`;

const SELECT_WITHOUT_STATUS = `
  SELECT sp.id AS save_id, sp.note, sp.created_at AS saved_at,
         l.id::text AS id, l.address, l.price, l.estimated_rent, l.rent_price_ratio,
         COALESCE(l.primary_photo, l.images->>0) AS primary_photo, l.zip_code
    FROM saved_properties sp JOIN listings l ON l.id = sp.listing_id
   WHERE sp.user_id = $1 ORDER BY sp.created_at DESC LIMIT 200
`;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    let rows: Record<string, unknown>[];
    try {
      const res = await pool.query(SELECT_WITH_STATUS, [user.id]);
      rows = res.rows;
    } catch (err) {
      // Missing column(s) (42703) — Listing Truth plan hasn't shipped yet.
      if ((err as { code?: string })?.code === '42703') {
        const res = await pool.query(SELECT_WITHOUT_STATUS, [user.id]);
        rows = res.rows;
      } else {
        throw err;
      }
    }
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/saved-properties error:', err);
    return NextResponse.json({ error: 'failed to load saved properties' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const listingId = Number(body?.listingId);
    if (!Number.isInteger(listingId) || listingId <= 0) {
      return NextResponse.json({ error: 'listingId required' }, { status: 400 });
    }
    const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : null;

    const res = await pool.query(
      `INSERT INTO saved_properties (user_id, listing_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, listing_id) DO NOTHING
       RETURNING id`,
      [user.id, listingId, note],
    );
    if (res.rows[0]?.id != null) {
      return NextResponse.json({ id: res.rows[0].id, created: true }, { status: 201 });
    }
    // Already saved — return the existing id, idempotent 200.
    const existing = await pool.query(
      'SELECT id FROM saved_properties WHERE user_id = $1 AND listing_id = $2',
      [user.id, listingId],
    );
    const existingId = existing.rows[0]?.id ?? null;
    return NextResponse.json({ id: existingId, created: false }, { status: 200 });
  } catch (err) {
    console.error('POST /api/saved-properties error:', err);
    return NextResponse.json({ error: 'failed to save property' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^\d{1,18}$/.test(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  try {
    // Only the session user's own row (user_id bound to the WHERE).
    const res = await pool.query(
      'DELETE FROM saved_properties WHERE id = $1 AND user_id = $2',
      [id, user.id],
    );
    return NextResponse.json({ deleted: res.rowCount });
  } catch (err) {
    console.error('DELETE /api/saved-properties error:', err);
    return NextResponse.json({ error: 'failed to delete saved property' }, { status: 500 });
  }
}
