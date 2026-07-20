export type Metro = { slug: string; label: string; zip: string; lat: number; lng: number; city: string; state: string };

// Top investor metros. zip = a representative central ZIP that has listings
// (these mirror FOOTER_MARKETS in lib/nav.ts — keep in sync).
export const METROS: Metro[] = [
  { slug: 'los-angeles', label: 'Los Angeles', zip: '90004', lat: 34.076, lng: -118.31, city: 'Los Angeles', state: 'CA' },
  { slug: 'houston', label: 'Houston', zip: '77002', lat: 29.756, lng: -95.363, city: 'Houston', state: 'TX' },
  { slug: 'atlanta', label: 'Atlanta', zip: '30310', lat: 33.727, lng: -84.42, city: 'Atlanta', state: 'GA' },
  { slug: 'tampa', label: 'Tampa', zip: '33604', lat: 27.998, lng: -82.457, city: 'Tampa', state: 'FL' },
  { slug: 'columbus', label: 'Columbus', zip: '43206', lat: 39.94, lng: -82.966, city: 'Columbus', state: 'OH' },
  { slug: 'memphis', label: 'Memphis', zip: '38106', lat: 35.107, lng: -90.03, city: 'Memphis', state: 'TN' },
  { slug: 'cleveland', label: 'Cleveland', zip: '44102', lat: 41.47, lng: -81.74, city: 'Cleveland', state: 'OH' },
  { slug: 'san-antonio', label: 'San Antonio', zip: '78201', lat: 29.46, lng: -98.53, city: 'San Antonio', state: 'TX' },
];

export const DEFAULT_METRO: Metro = METROS[1]; // Houston — deep 1%-clearing inventory

export function metroByZip(zip: string): Metro | null {
  return METROS.find((m) => m.zip === zip) ?? null;
}

export function nearestMetro(lat: number, lng: number): Metro {
  let best = DEFAULT_METRO;
  let bestD = Infinity;
  for (const m of METROS) {
    const d = (m.lat - lat) ** 2 + (m.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
