import { DEFAULT_METRO, nearestMetro, type Metro } from './metros';

function coordsFrom(h: Headers, latKey: string, lngKey: string): { lat: number; lng: number } | null {
  const latRaw = h.get(latKey);
  const lngRaw = h.get(lngKey);
  // h.get() → null or '' both become NaN/0; require finite and not the 0,0
  // "null island", and reject empty strings so nginx's spoof-proof overwrite
  // (which sets "" on a miss) reads as "no geo".
  if (latRaw === null || latRaw === '' || lngRaw === null || lngRaw === '') return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    return { lat, lng };
  }
  return null;
}

export function metroFromHeaders(h: Headers): Metro {
  // nginx-injected (self-hosted prod; spoof-proof — nginx overwrites inbound
  // values) first, Vercel edge headers (preview deploys) second.
  const geo = coordsFrom(h, 'x-geo-latitude', 'x-geo-longitude')
    ?? coordsFrom(h, 'x-vercel-ip-latitude', 'x-vercel-ip-longitude');
  return geo ? nearestMetro(geo.lat, geo.lng) : DEFAULT_METRO;
}
