export type IndexMetro = { slug: string; label: string; zip3: string[]; repZip: string };

// ZIP3 prefixes approximate each metro. repZip is a central ZIP with inventory.
export const INDEX_METROS: IndexMetro[] = [
  { slug: 'houston', label: 'Houston', zip3: ['770', '772', '773', '774', '775'], repZip: '77002' },
  { slug: 'san-antonio', label: 'San Antonio', zip3: ['780', '782'], repZip: '78201' },
  { slug: 'memphis', label: 'Memphis', zip3: ['380', '381'], repZip: '38106' },
  { slug: 'cleveland', label: 'Cleveland', zip3: ['441'], repZip: '44102' },
  { slug: 'columbus', label: 'Columbus', zip3: ['432', '430', '431'], repZip: '43206' },
  { slug: 'atlanta', label: 'Atlanta', zip3: ['303', '300', '301'], repZip: '30310' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336', '335'], repZip: '33604' },
  { slug: 'indianapolis', label: 'Indianapolis', zip3: ['462', '461'], repZip: '46201' },
  { slug: 'kansas-city', label: 'Kansas City', zip3: ['641', '640'], repZip: '64127' },
  { slug: 'birmingham', label: 'Birmingham', zip3: ['352'], repZip: '35211' },
  { slug: 'los-angeles', label: 'Los Angeles', zip3: ['900', '910', '913'], repZip: '90004' },
  { slug: 'chicago', label: 'Chicago', zip3: ['606', '604'], repZip: '60620' },
];

export function indexMetroBySlug(slug: string): IndexMetro | null {
  return INDEX_METROS.find((m) => m.slug === slug) ?? null;
}
