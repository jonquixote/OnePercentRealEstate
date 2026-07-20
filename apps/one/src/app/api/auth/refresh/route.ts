import { NextResponse } from 'next/server';
import { getSessionUser, issueSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';
import pool from '@/lib/db';

/**
 * Re-issues the session cookie from the freshest `profiles` row. The JWT
 * bakes `tier` + `stripe_customer_id` in at login time, so after a Stripe
 * webhook flips a user to `pro` (or back to `free`), the client's cookie is
 * stale until this runs. The checkout success redirect lands on
 * `/?upgrade_success=true`; the client calls this route to rotate the cookie
 * and then re-reads `/api/auth/me`.
 *
 * Single-writer invariant is preserved: this route only READS `subscription_tier`
 * from `profiles` (written exclusively by the webhook) and re-encodes it into a
 * cookie. It never writes `subscription_tier`.
 */
export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ user: null }, { status: 200 });

  try {
    const res = await pool.query(
      `SELECT subscription_tier, stripe_customer_id FROM profiles WHERE id = $1`,
      [sessionUser.id],
    );
    const row = res.rows[0];
    if (!row) return NextResponse.json({ user: null }, { status: 200 });

    const refreshed = {
      id: sessionUser.id,
      email: sessionUser.email,
      tier: (row.subscription_tier === 'pro' ? 'pro' : 'free') as 'free' | 'pro',
      stripeCustomerId: row.stripe_customer_id ?? null,
    };

    const token = await issueSession(refreshed);
    if (!token) return NextResponse.json({ error: 'Session unavailable' }, { status: 500 });

    const res_ = NextResponse.json({ user: refreshed });
    res_.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res_;
  } catch (err) {
    console.error('Session refresh error:', err);
    return NextResponse.json({ error: 'Session refresh failed' }, { status: 500 });
  }
}
