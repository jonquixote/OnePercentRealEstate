import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export async function POST() {
  const resp = NextResponse.json({ ok: true });
  resp.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return resp;
}
