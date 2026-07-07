import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { issueSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { loginLimiter } from '@/lib/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    try {
      await loginLimiter.consume(`signup:${ip}`);
    } catch {
      return NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 });
    }

    const { email, password } = await request.json().catch(() => ({}));
    const normalizedInput = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(normalizedInput) || normalizedInput.length > 254) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: 'Password must be 8–128 characters' }, { status: 400 });
    }

    const normalized = normalizedInput;
    const hash = await bcrypt.hash(password, 12);
    const id = randomUUID();

    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO profiles (id, email, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) WHERE email IS NOT NULL DO NOTHING
         RETURNING id, email, subscription_tier`,
        [id, normalized, hash],
      );
      if (res.rowCount === 0) {
        // Same message shape as a bad login — don't leak account existence.
        return NextResponse.json({ error: 'Unable to create account with those credentials' }, { status: 409 });
      }
      const user = { id: res.rows[0].id, email: res.rows[0].email, tier: res.rows[0].subscription_tier === 'pro' ? 'pro' as const : 'free' as const };
      const token = await issueSession(user);
      if (!token) {
        return NextResponse.json({ error: 'Auth not configured (AUTH_SECRET missing)' }, { status: 503 });
      }
      const resp = NextResponse.json({ user });
      resp.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      return resp;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('signup error:', err);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
