import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { parsePrefs } from '@/lib/prefs';

/**
 * Session-scoped investor prefs (profiles.prefs jsonb). GET returns the parsed
 * (clamped, default-merged) object; PUT validates via parsePrefs and writes the
 * CLEANED object — raw client json is never stored.
 *
 * Session identity (`getSessionUser()`) is the only source of user_id; no
 * client-supplied user ids. 401 without a session.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    const res = await pool.query('SELECT prefs FROM profiles WHERE id = $1', [user.id]);
    const raw = res.rows[0]?.prefs ?? {};
    return NextResponse.json(parsePrefs(raw));
  } catch (err) {
    console.error('GET /api/prefs error:', err);
    return NextResponse.json({ error: 'failed to load prefs' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const cleaned = parsePrefs(body); // never store raw client json
    await pool.query('UPDATE profiles SET prefs = $1 WHERE id = $2', [
      JSON.stringify(cleaned),
      user.id,
    ]);
    return NextResponse.json(cleaned);
  } catch (err) {
    console.error('PUT /api/prefs error:', err);
    return NextResponse.json({ error: 'failed to save prefs' }, { status: 500 });
  }
}
