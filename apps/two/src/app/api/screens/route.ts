import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

/**
 * Pro-terminal screens (W1) CRUD.
 *
 * SECURITY: identity is the session user (`getSessionUser()`). The legacy
 * `x-user-id` / `?user_id=` fallback is only available outside production
 * (mirrors apps/one saved-searches) so local prototypes keep working.
 *
 * GATING: reads (GET) require a logged-in user. Writes (POST/PATCH/DELETE)
 * require a `pro` account — free users get the built-in read-only screens
 * client-side but cannot create or save custom ones. This is enforced
 * server-side; client hiding is cosmetic only.
 *
 * The `expression` column stores query-lang SOURCE TEXT only. It is
 * re-parsed + re-compiled server-side when executed; the client never ships
 * SQL.
 */

const PROD_GATE_HEADER = 'authorization';

function devGateBlocked(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: 'screens disabled: ADMIN_API_KEY not configured' },
      { status: 501 },
    );
  }
  const header = request.headers.get(PROD_GATE_HEADER) ?? '';
  if (header !== `Bearer ${adminKey}`) {
    return NextResponse.json(
      { error: 'screens requires auth' },
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

function parseColumns(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return null;
  if (!input.every((c) => typeof c === 'string')) return null;
  return input as string[];
}

function parseSort(input: unknown): { col: string; dir: 'asc' | 'desc' } | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (typeof o.col !== 'string' || (o.dir !== 'asc' && o.dir !== 'desc')) {
    return null;
  }
  return { col: o.col, dir: o.dir };
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
      `SELECT id, user_id, name, expression, columns, sort, position,
              created_at, updated_at
         FROM terminal_screens
        WHERE user_id = $1
        ORDER BY position ASC, created_at ASC`,
      [userId],
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET /api/screens error:', error);
    return NextResponse.json({ error: 'Failed to fetch screens' }, { status: 500 });
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
      { error: 'Pro required to create screens', code: 'PRO_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const userId = sessionUser?.id ?? readUserId(request, typeof body?.user_id === 'string' ? body.user_id : undefined);
    if (!userId) {
      return NextResponse.json({ error: 'user_id required' }, { status: 400 });
    }
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return NextResponse.json({ error: 'name required (1-100 chars)' }, { status: 400 });
    }
    const expression = typeof body?.expression === 'string' ? body.expression : '';
    const columns = parseColumns(body?.columns) ?? [];
    const sort = parseSort(body?.sort);

    const max = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM terminal_screens WHERE user_id = $1',
      [userId],
    );
    const position = typeof body?.position === 'number' ? body.position : max.rows[0].next;

    const result = await pool.query(
      `INSERT INTO terminal_screens (user_id, name, expression, columns, sort, position)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, name, expression, columns, sort, position, created_at, updated_at`,
      [userId, name, expression, JSON.stringify(columns), JSON.stringify(sort), position],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('POST /api/screens error:', error);
    return NextResponse.json({ error: 'Failed to create screen' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    const gate = devGateBlocked(request);
    if (gate) return gate;
  }
  if (sessionUser && sessionUser.tier !== 'pro') {
    return NextResponse.json(
      { error: 'Pro required to edit screens', code: 'PRO_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const id = request.nextUrl.searchParams.get('id');
    const userId = sessionUser?.id ?? readUserId(request);
    if (!id || !/^\d+$/.test(id) || !userId) {
      return NextResponse.json({ error: 'id (numeric) and user_id required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > 100) {
        return NextResponse.json({ error: 'name must be 1-100 chars' }, { status: 400 });
      }
      sets.push(`name = $${i++}`);
      values.push(name);
    }
    if (typeof body.expression === 'string') {
      sets.push(`expression = $${i++}`);
      values.push(body.expression);
    }
    const cols = parseColumns(body.columns);
    if (cols) {
      sets.push(`columns = $${i++}`);
      values.push(JSON.stringify(cols));
    }
    const sort = parseSort(body.sort);
    if (sort !== null || body.sort === null) {
      sets.push(`sort = $${i++}`);
      values.push(JSON.stringify(sort));
    }
    if (typeof body.position === 'number') {
      sets.push(`position = $${i++}`);
      values.push(body.position);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }
    sets.push(`updated_at = now()`);

    const result = await pool.query(
      `UPDATE terminal_screens SET ${sets.join(', ')}
        WHERE id = $${i} AND user_id = $${i + 1}
        RETURNING id, user_id, name, expression, columns, sort, position, created_at, updated_at`,
      [...values, Number(id), userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Screen not found or access denied' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('PATCH /api/screens error:', error);
    return NextResponse.json({ error: 'Failed to update screen' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    const gate = devGateBlocked(request);
    if (gate) return gate;
  }
  if (sessionUser && sessionUser.tier !== 'pro') {
    return NextResponse.json(
      { error: 'Pro required to delete screens', code: 'PRO_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const id = request.nextUrl.searchParams.get('id');
    const userId = sessionUser?.id ?? readUserId(request);
    if (!id || !/^\d+$/.test(id) || !userId) {
      return NextResponse.json({ error: 'id (numeric) and user_id required' }, { status: 400 });
    }

    const result = await pool.query(
      'DELETE FROM terminal_screens WHERE id = $1 AND user_id = $2 RETURNING id',
      [Number(id), userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Screen not found or access denied' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/screens error:', error);
    return NextResponse.json({ error: 'Failed to delete screen' }, { status: 500 });
  }
}
