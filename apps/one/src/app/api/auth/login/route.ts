import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { issueSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { loginLimiter } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    try {
      await loginLimiter.consume(`login:${ip}`);
    } catch {
      return NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 });
    }

    const { email, password, anon_user_id } = await request.json().catch(() => ({}));
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const normalized = email.trim().toLowerCase();
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT id, email, password_hash, subscription_tier, stripe_customer_id FROM profiles WHERE email = $1`,
        [normalized],
      );
      const row = res.rows[0];
      // Constant-shape failure: hash compare even when the row is missing so
      // response timing doesn't reveal account existence.
      const hash = row?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
      const ok = await bcrypt.compare(password, hash);
      if (!row || !row.password_hash || !ok) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
      }
      const user = {
        id: row.id,
        email: row.email,
        tier: row.subscription_tier === 'pro' ? 'pro' as const : 'free' as const,
        stripeCustomerId: row.stripe_customer_id ?? null,
      };
      const token = await issueSession(user);
      if (!token) {
        return NextResponse.json({ error: 'Auth not configured (AUTH_SECRET missing)' }, { status: 503 });
      }
      // Claim any anonymous (localStorage UUID) saved searches for this account.
      const anonId = typeof anon_user_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(anon_user_id) ? anon_user_id : null;
      if (anonId) {
        try {
          await client.query('SELECT claim_anon_identity($1, $2)', [user.id, anonId]);
        } catch (claimErr) {
          // Non-fatal: a failed claim must never break login.
          console.error('identity claim failed (non-fatal):', claimErr);
        }
      }
      const resp = NextResponse.json({ user });
      resp.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return resp;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('login error:', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
