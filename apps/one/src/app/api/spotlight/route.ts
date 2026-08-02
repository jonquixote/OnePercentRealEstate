import { NextRequest, NextResponse } from 'next/server';
import { spotlightFor } from '@/lib/spotlight';
import { metroFromHeaders } from '@/lib/geo';
import { metroByZip, type Metro } from '@/lib/metros';

export const dynamic = 'force-dynamic';

// This route now serves exactly one purpose: the SpotlightRotator pinning a ZIP
// the visitor typed. The `?all=1` batch mode is gone — the metro tour is
// rendered server-side by the hero via getSpotlightTour, which shares the same
// TTL cache in lib/spotlight, so a pin straight after page load is usually a
// cache hit even for a different metro (a cold tour warms every entry).
//
// The execution + caching that used to live here moved to lib/spotlight.ts so a
// server component would stop having to HTTP-fetch an API route on its own box.

export function resolveLoc(sp: URLSearchParams, headers: Headers): { metro: Metro } {
  const zip = sp.get('zip');
  if (zip && /^\d{5}$/.test(zip)) {
    const m = metroByZip(zip);
    if (m) return { metro: m };
  }
  return { metro: metroFromHeaders(headers) };
}

export async function GET(req: NextRequest) {
  const { metro } = resolveLoc(req.nextUrl.searchParams, req.headers);
  return NextResponse.json(await spotlightFor(metro));
}
