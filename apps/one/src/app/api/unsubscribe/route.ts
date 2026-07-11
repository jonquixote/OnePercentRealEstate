import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import pool from '@/lib/db';

/**
 * One-click email unsubscribe (Tasks 2.1 & 2.2). No login required.
 *
 * The digest worker mints a link containing a signed token: HMAC-SHA256 over
 * `${id}|${email}` using UNSUBSCRIBE_SECRET. We recompute it here with a
 * constant-time compare and, on success, clear that saved search's
 * email_digest flag and set the user's global email_optout.
 */

function getSecret(): string | null {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (s && s.length > 0) return s;
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-unsub-secret-change-me';
  }
  return null;
}

function verifyToken(token: string, id: string, email: string): boolean {
  const secret = getSecret();
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`${id}|${email}`).digest('hex');
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const id = request.nextUrl.searchParams.get('id') ?? '';
  const email = request.nextUrl.searchParams.get('e') ?? '';

  const ok = token && id && email && verifyToken(token, id, email);

  if (ok) {
    try {
      const owner = await pool.query(
        'SELECT user_id FROM saved_searches WHERE id = $1',
        [id]
      );
      if (owner.rows.length > 0) {
        const userId = owner.rows[0].user_id;
        await pool.query(
          'UPDATE saved_searches SET email_digest = false WHERE id = $1 AND user_id = $2',
          [id, userId]
        );
        await pool.query(
          `INSERT INTO user_alert_prefs (user_id, email_optout)
           VALUES ($1, true)
           ON CONFLICT (user_id) DO UPDATE SET email_optout = true`,
          [userId]
        );
      }
    } catch (err) {
      console.error('Unsubscribe error:', err);
      return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
    }
  }

  const body = ok
    ? `<p style="font-family:sans-serif">You're unsubscribed. We won't email these digests again.</p>`
    : `<p style="font-family:sans-serif;color:#b91c1c">This unsubscribe link is invalid or expired.</p>`;

  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head>
     <body style="font-family:sans-serif;padding:2rem">
       <h2>Email digest preferences</h2>
       ${body}
     </body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
