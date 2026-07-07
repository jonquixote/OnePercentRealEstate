import { NextResponse } from 'next/server';

// Wave 5: real healthz (the old path proxied localhost:3000 and ECONNRESET).
// Shallow by design — process is up + can answer; DB health is the app's
// concern at query time and postgres has its own healthcheck.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'two', ts: new Date().toISOString() });
}
