import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const NameSchema = z.object({
  name: z.string().min(1).max(50),
});

/**
 * List the current user's own API keys. Never returns `key_hash` or the
 * plaintext key — only metadata needed to manage them.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, created_at, last_used_at, revoked
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error('GET /api/v1/keys error:', err);
    return NextResponse.json({ error: 'failed to list keys' }, { status: 500 });
  }
}

/**
 * Create a new API key for the current (pro) user. The plaintext key is
 * returned exactly once; only its sha256 hash is persisted.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (user.tier !== 'pro') {
    return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });
  }

  let body: z.infer<typeof NameSchema>;
  try {
    const json = await req.json();
    const parsed = NameSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid body', details: parsed.error.format() },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const plaintext = `opk_${randomBytes(32).toString('base64url')}`;
  const keyHash = createHash('sha256').update(plaintext).digest('hex');

  try {
    const result = await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id, name, created_at`,
      [user.id, keyHash, body.name]
    );
    // The plaintext is shown ONCE here and never stored.
    return NextResponse.json(
      { ...result.rows[0], key: plaintext },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST /api/v1/keys error:', err);
    return NextResponse.json({ error: 'failed to create key' }, { status: 500 });
  }
}

/**
 * Revoke a key owned by the current user. Revocation is a soft flag so the
 * row history is preserved.
 */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'id (numeric) required' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE api_keys SET revoked = true
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
      [id, user.id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'key not found or access denied' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/v1/keys error:', err);
    return NextResponse.json({ error: 'failed to revoke key' }, { status: 500 });
  }
}
