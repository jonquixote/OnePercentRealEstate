import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { ALL_COLUMN_IDS } from '@/lib/columns';

/**
 * Pro-terminal saved layouts (W4) — CRUD scoped to the session user.
 *
 * A layout is a named grid configuration: visible/visible+ordered columns, a
 * sort, and any pane sizes. We persist the whole blob in `terminal_layouts`
 * (created by the 2026_07_18 migration) but validate the column keys against
 * the canonical `COLUMNS` registry so a renamed/missing column can never
 * silently rot a saved layout.
 *
 * GET  /api/layouts          -> every layout for the user (id, name, layout)
 * PUT  /api/layouts          -> upsert-by-name; 400 on bad column key,
 *                               403 when over the tier cap (5 free / 20 pro)
 * DELETE /api/layouts?id=    -> delete one owned layout
 *
 * 401 when there is no session.
 */
const FREE_CAP = 5;
const PRO_CAP = 20;

/** A single column entry within a layout. */
interface LayoutColumn {
  key: string;
  visible?: boolean;
  width?: number;
}
interface LayoutPayload {
  columns?: unknown;
  sort?: { key?: string; dir?: 'asc' | 'desc' } | null;
  panes?: unknown;
}

function validateLayout(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return 'layout must be an object';
  const layout = input as LayoutPayload;
  if (layout.columns !== undefined) {
    if (!Array.isArray(layout.columns)) return 'layout.columns must be an array';
    for (const c of layout.columns) {
      if (typeof c !== 'object' || c === null) return 'layout.columns[] must be objects';
      const key = (c as LayoutColumn).key;
      if (typeof key !== 'string' || !ALL_COLUMN_IDS.includes(key)) {
        return `unknown column key: ${key}`;
      }
    }
  }
  if (layout.sort !== undefined && layout.sort !== null) {
    const s = layout.sort as { key?: string; dir?: string };
    if (typeof s.key !== 'string' || !ALL_COLUMN_IDS.includes(s.key)) {
      return `unknown sort key: ${s.key}`;
    }
    if (s.dir !== undefined && s.dir !== 'asc' && s.dir !== 'desc') {
      return 'sort.dir must be asc or desc';
    }
  }
  return null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    const res = await pool.query(
      `SELECT id, name, layout, updated_at
         FROM terminal_layouts WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user.id],
    );
    return NextResponse.json(res.rows);
  } catch (err) {
    console.error('GET /api/layouts error:', err);
    return NextResponse.json({ error: 'failed to load layouts' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return NextResponse.json({ error: 'name required (1-100 chars)' }, { status: 400 });
    }
    const err = validateLayout(body?.layout);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const cap = user.tier === 'pro' ? PRO_CAP : FREE_CAP;
    const count = await pool.query(
      'SELECT count(*) FROM terminal_layouts WHERE user_id = $1',
      [user.id],
    );
    // Upsert-by-name: an existing name does not count toward the cap.
    const exists = await pool.query(
      'SELECT 1 FROM terminal_layouts WHERE user_id = $1 AND name = $2',
      [user.id, name],
    );
    if (Number(count.rows[0].count) >= cap && exists.rowCount === 0) {
      return NextResponse.json(
        { error: `layout limit reached (${cap})`, code: 'LAYOUT_CAP' },
        { status: 403 },
      );
    }

    const res = await pool.query(
      `INSERT INTO terminal_layouts (user_id, name, layout)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()
       RETURNING id, name, layout, updated_at`,
      [user.id, name, JSON.stringify(body.layout)],
    );
    return NextResponse.json(res.rows[0], { status: 200 });
  } catch (err) {
    console.error('PUT /api/layouts error:', err);
    return NextResponse.json({ error: 'failed to save layout' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'id (numeric) required' }, { status: 400 });
  }
  try {
    const res = await pool.query(
      'DELETE FROM terminal_layouts WHERE id = $1 AND user_id = $2 RETURNING id',
      [Number(id), user.id],
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'layout not found or access denied' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/layouts error:', err);
    return NextResponse.json({ error: 'failed to delete layout' }, { status: 500 });
  }
}
