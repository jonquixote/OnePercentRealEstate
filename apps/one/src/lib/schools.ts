export interface SchoolInfo {
  name: string;
  distance?: string;
  rating?: string;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isObjectArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'object' && s !== null && !Array.isArray(s));
}

function extractName(obj: Record<string, unknown>): string {
  return typeof obj.name === 'string' ? obj.name : typeof obj.school === 'string' ? obj.school : '';
}

function extractDistance(obj: Record<string, unknown>): string | undefined {
  const d = obj.distance;
  if (typeof d === 'number') return `${d.toFixed(1)} mi`;
  if (typeof d === 'string') return d;
  return undefined;
}

function extractRating(obj: Record<string, unknown>): string | undefined {
  const r = obj.rating;
  if (typeof r === 'number') return `${r}`;
  if (typeof r === 'string') return r;
  return undefined;
}

export function parseSchools(raw: unknown): SchoolInfo[] {
  if (raw == null || raw === 'null') return [];

  // String array — simplest case
  if (isStringArray(raw)) {
    return raw.map((name): SchoolInfo => ({ name }));
  }

  // Object array with {name, distance?, rating?}
  if (isObjectArray(raw)) {
    const result: SchoolInfo[] = [];
    for (const obj of raw) {
      const name = extractName(obj);
      if (name) {
        result.push({
          name,
          distance: extractDistance(obj),
          rating: extractRating(obj),
        });
      }
    }
    return result;
  }

  // Nested list ([[name, dist, rating], ...])
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    const result: SchoolInfo[] = [];
    for (const entry of raw as unknown[][]) {
      if (!Array.isArray(entry)) continue;
      const [name, dist, rating] = entry;
      const n = name != null ? String(name) : '';
      if (!n) continue;
      const s: SchoolInfo = { name: n };
      if (dist != null) s.distance = String(dist);
      if (rating != null) s.rating = String(rating);
      result.push(s);
    }
    return result;
  }

  // Comma-separated string
  if (typeof raw === 'string') {
    return raw.split(',').map((s) => s.trim()).filter(Boolean).map((name): SchoolInfo => ({ name }));
  }

  return [];
}
