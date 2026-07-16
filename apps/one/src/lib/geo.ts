import { DEFAULT_METRO, nearestMetro, type Metro } from './metros';

export function metroFromHeaders(h: Headers): Metro {
  const lat = Number(h.get('x-vercel-ip-latitude'));
  const lng = Number(h.get('x-vercel-ip-longitude'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
    return nearestMetro(lat, lng);
  }
  return DEFAULT_METRO;
}
