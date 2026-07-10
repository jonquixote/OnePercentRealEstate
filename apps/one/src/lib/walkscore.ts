import pool from '@/lib/db';

export interface WalkScoreResult {
  walk: number | null;
  transit: number | null;
  bike: number | null;
  link: string | null;
}

export async function getWalkScore(
  address: string,
  lat: number,
  lng: number,
): Promise<WalkScoreResult | null> {
  const apiKey = process.env.WALKSCORE_API_KEY;
  if (!apiKey) return null;

  // Normalize address for cache key
  const addrNorm = address.toLowerCase().replace(/\s+/g, ' ').trim();

  // Check cache (30-day TTL)
  const cached = await pool.query(
    `SELECT walk, transit, bike, ws_link FROM walkscore_cache
     WHERE addr_norm = $1 AND fetched_at > now() - interval '30 days'`,
    [addrNorm],
  );
  if (cached.rows.length > 0) {
    const r = cached.rows[0];
    return { walk: r.walk, transit: r.transit, bike: r.bike, link: r.ws_link };
  }

  // Fetch from Walk Score API
  try {
    const url = `https://api.walkscore.com/score?format=json&address=${encodeURIComponent(address)}&lat=${lat}&lon=${lng}&transit=1&bike=1&wsapikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    const result: WalkScoreResult = {
      walk: data.walkscore ?? null,
      transit: data.transit?.score ?? null,
      bike: data.bike?.score ?? null,
      link: data.walkscore_permalink ?? null,
    };

    // Upsert cache
    await pool.query(
      `INSERT INTO walkscore_cache (addr_norm, walk, transit, bike, ws_link, fetched_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (addr_norm) DO UPDATE SET
         walk = EXCLUDED.walk, transit = EXCLUDED.transit,
         bike = EXCLUDED.bike, ws_link = EXCLUDED.ws_link, fetched_at = now()`,
      [addrNorm, result.walk, result.transit, result.bike, result.link],
    );

    return result;
  } catch {
    return null;
  }
}