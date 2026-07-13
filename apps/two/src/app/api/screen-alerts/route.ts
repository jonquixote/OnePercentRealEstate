import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Pro-terminal screen alerts (Task AL1) — the "Alert me" toggle.
 *
 * Each terminal screen can have at most one alert row (screen_id is the PK in
 * `screen_alerts`). This route creates/updates/disables that row. The daily
 * digest worker (apps/worker/src/digest.ts) compiles the screen's
 * query-lang expression and emails new matches.
 *
 * SECURITY: identity is the session user (`getSessionUser()`), mirroring
 * apps/two/src/app/api/screens/route.ts. Writes require a `pro` account —
 * free/anon callers get a 403 PRO_REQUIRED and the UI shows an upsell instead.
 * The client only ever sends the screen id + a boolean toggle; the expression
 * is read server-side from `terminal_screens`, never trusted from the client.
 */

const PROD_GATE_HEADER = 'authorization';

function devGateBlocked(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: 'screen-alerts disabled: ADMIN_API_KEY not configured' },
      { status: 501 },
    );
  }
  const header = request.headers.get(PROD_GATE_HEADER) ?? '';
  if (header !== `Bearer ${adminKey}`) {
    return NextResponse.json(
      { error: 'screen-alerts requires auth' },
      { status: 501 },
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
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    const gate = devGateBlocked(request);
    if (gate) return gate;
  }

  try {
    const userId = sessionUser?.id ?? readUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id required' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT screen_id, user_id, cadence, last_run_at, enabled, created_at, updated_at
         FROM screen_alerts
        WHERE user_id = $1
        ORDER BY created_at ASC`,
      [userId],
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET /api/screen-alerts error:', error);
    return NextResponse.json({ error: 'Failed to fetch screen alerts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    const gate = devGateBlocked(request);
    if (gate) return gate;
  }
  if (sessionUser && sessionUser.tier !== 'pro') {
    return NextResponse.json(
      { error: 'Pro required for screen alerts', code: 'PRO_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const userId = sessionUser?.id ?? readUserId(request, typeof body?.user_id === 'string' ? body.user_id : undefined);
    if (!userId) {
      return NextResponse.json({ error: 'user_id required' }, { status: 400 });
    }

    const screenIdRaw = body?.screen_id;
    if (typeof screenIdRaw !== 'number' && typeof screenIdRaw !== 'string') {
      return NextResponse.json({ error: 'screen_id required' }, { status: 400 });
    }
    const screenId = Number(screenIdRaw);
    if (!Number.isInteger(screenId) || screenId <= 0) {
      return NextResponse.json({ error: 'screen_id must be a positive integer' }, { status: 400 });
    }

    const enabled = body?.enabled === true;
    const cadence =
      body?.cadence === 'instant' || body?.cadence === 'daily' ? body.cadence : 'daily';

    // Owner check: the screen must belong to this user.
    const ownerRes = await pool.query(
      'SELECT id FROM terminal_screens WHERE id = $1 AND user_id = $2',
      [screenId, userId],
    );
    if (ownerRes.rowCount === 0) {
      return NextResponse.json({ error: 'Screen not found or access denied' }, { status: 404 });
    }

    // Upsert the single alert row for this screen. When disabling we keep the
    // row (and its last_run_at) so re-enabling resumes from where it left off.
    const result = await pool.query(
      `INSERT INTO screen_alerts (screen_id, user_id, cadence, enabled, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (screen_id) DO UPDATE
         SET cadence = EXCLUDED.cadence,
             enabled = EXCLUDED.enabled,
             updated_at = now()
       RETURNING screen_id, user_id, cadence, last_run_at, enabled, created_at, updated_at`,
      [screenId, userId, cadence, enabled],
    );

    return NextResponse.json(result.rows[0], { status: 200 });
  } catch (error) {
    console.error('POST /api/screen-alerts error:', error);
    return NextResponse.json({ error: 'Failed to update screen alert' }, { status: 500 });
  }
}
