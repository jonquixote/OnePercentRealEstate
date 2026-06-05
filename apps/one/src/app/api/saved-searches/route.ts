import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Wave 5 minimal saved searches endpoint.
 *
 * SECURITY: User identity comes from a request-controlled field (header
 * `x-user-id` or `?user_id=`) because Wave 8 auth is not yet wired. This
 * is a known IDOR/spoofing surface — any caller can read or delete any
 * row by supplying the matching user_id. Mitigations until Wave 8:
 *
 *   1. Production builds (NODE_ENV=production) require ADMIN_API_KEY in
 *      the `Authorization: Bearer <key>` header. Without it the route
 *      returns 501 so the endpoint is unreachable from the public web.
 *   2. Dev/test builds pass through with the spoofable user_id so the
 *      UI prototype keeps working locally.
 *
 * When Wave 8 lands, derive userId from `getServerSession()` and remove
 * the env-gated bypass.
 */

const PROD_GATE_HEADER = 'authorization';

function devGateBlocked(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: 'saved-searches disabled: ADMIN_API_KEY not configured' },
      { status: 501 }
    );
  }
  const header = request.headers.get(PROD_GATE_HEADER) ?? '';
  const expected = `Bearer ${adminKey}`;
  if (header !== expected) {
    return NextResponse.json(
      { error: 'saved-searches requires auth (Wave 8 pending)' },
      { status: 501 }
    );
  }
  return null;
}

function readUserId(request: NextRequest, fallback?: string): string | null {
  const id =
    request.headers.get('x-user-id') ||
    request.nextUrl.searchParams.get('user_id') ||
    fallback ||
    null;
  // Constrain shape: alphanumeric, dash, underscore, max 64 chars. Anything
  // else is a likely injection attempt. Reject early.
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

export async function GET(request: NextRequest) {
  const gate = devGateBlocked(request);
  if (gate) return gate;

  try {
    const userId = readUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id required (alphanumeric, max 64 chars)' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      'SELECT id, user_id, name, params, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [userId]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved searches' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = devGateBlocked(request);
  if (gate) return gate;

  try {
    const body = await request.json().catch(() => ({}));
    const { user_id, name, params } = body ?? {};

    const userId = readUserId(request, typeof user_id === 'string' ? user_id : undefined);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id required (alphanumeric, max 64 chars)' },
        { status: 400 }
      );
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      return NextResponse.json(
        { error: 'name required (1-100 chars)' },
        { status: 400 }
      );
    }
    if (params == null || typeof params !== 'object') {
      return NextResponse.json(
        { error: 'params required (object)' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO saved_searches (user_id, name, params)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE
       SET params = $3
       RETURNING id, user_id, name, params, created_at`,
      [userId, name.trim(), JSON.stringify(params)]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('POST /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to save search' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const gate = devGateBlocked(request);
  if (gate) return gate;

  try {
    const id = request.nextUrl.searchParams.get('id');
    const userId = readUserId(request);

    if (!id || !/^\d+$/.test(id) || !userId) {
      return NextResponse.json(
        { error: 'id (numeric) and user_id required' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Saved search not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/saved-searches error:', error);
    return NextResponse.json(
      { error: 'Failed to delete saved search' },
      { status: 500 }
    );
  }
}
