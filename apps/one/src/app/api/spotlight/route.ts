import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildSpotlightQuery, shapeSpotlight } from '@/lib/spotlight';
import { metroFromHeaders } from '@/lib/geo';
import { metroByZip, type Metro } from '@/lib/metros';

export const dynamic = 'force-dynamic';

export function resolveLoc(sp: URLSearchParams, headers: Headers): { metro: Metro } {
  const zip = sp.get('zip');
  if (zip && /^\d{5}$/.test(zip)) {
    const m = metroByZip(zip);
    if (m) return { metro: m };
  }
  return { metro: metroFromHeaders(headers) };
}

// Single-instance TTL cache keyed by metro zip (5 min). Acceptable for one box.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const { metro } = resolveLoc(req.nextUrl.searchParams, req.headers);
  const hit = cache.get(metro.zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  try {
    const { sql, params } = buildSpotlightQuery({ zip: metro.zip, lat: metro.lat, lng: metro.lng });
    const res = await pool.query(sql, params);
    const deal = res.rows[0] ? shapeSpotlight(res.rows[0], metro.zip) : null;
    const body = { metro: { label: metro.label, zip: metro.zip }, deal };
    cache.set(metro.zip, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    console.error('/api/spotlight error:', err);
    return NextResponse.json({ metro: { label: metro.label, zip: metro.zip }, deal: null }, { status: 200 });
  }
}
