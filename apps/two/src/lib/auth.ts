/**
 * Pro-terminal session auth. Mirrors apps/one/src/lib/auth.ts so the two
 * apps verify the same `oper_session` cookie (HS256 JWT, jose). The seam is
 * intentionally identical so sessions issued by apps/one are trusted here.
 *
 * Session = HS256 JWT in an httpOnly SameSite=Lax secure cookie. AUTH_SECRET
 * is required in production — without it the app fails closed (no dev secret).
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'oper_session';
const SESSION_TTL_S = 30 * 24 * 3600;

function secretKey(): Uint8Array | null {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV !== 'production') {
    return new TextEncoder().encode('dev-only-secret-do-not-use-in-prod!!');
  }
  return null;
}

export interface SessionUser {
  id: string;
  email: string;
  tier: 'free' | 'pro';
}

export async function issueSession(user: SessionUser): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ email: user.email, tier: user.tier })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return {
      id: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : '',
      tier: payload.tier === 'pro' ? 'pro' : 'free',
    };
  } catch {
    return null;
  }
}

/** Server-side session lookup from the request cookies (RSC/route handlers). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function sessionCookieOptions() {
  // SESSION_COOKIE_DOMAIN (prod: ".octavo.press") shares the session across
  // one.octavo.press and two.octavo.press. Unset (dev/tests) = host-only,
  // exactly the pre-2026-07-20 behavior.
  const domain = process.env.SESSION_COOKIE_DOMAIN;
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_S,
    ...(domain ? { domain } : null),
  };
}
