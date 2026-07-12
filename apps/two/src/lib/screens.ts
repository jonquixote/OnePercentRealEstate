/**
 * Screen definitions for the pro terminal (W1). A "screen" is a saved scan:
 * a query-lang expression plus an ordered column set and a sort. Built-in
 * screens are shipped as constants (never rows) and are read-only; they also
 * serve as the free-tier demo. User screens are persisted rows in
 * `terminal_screens` and are full CRUD for pro accounts.
 */

export interface ScreenSort {
  col: string;
  dir: 'asc' | 'desc';
}

export interface BuiltinScreen {
  id: string;
  name: string;
  expression: string;
  columns: string[];
  sort: ScreenSort | null;
}

/** Column ids in the order the grid renders them (see PropertyTable). */
export const BUILTIN_COLUMNS = [
  'address',
  'price',
  'ppsf',
  'beds',
  'baths',
  'sqft',
  'onePct',
  'estRent',
  'cap',
  'dom',
  'status',
] as const;

export const DEFAULT_SORT: ScreenSort = { col: 'onePct', dir: 'desc' };

/**
 * The four built-in read-only screens. Expressions are stored verbatim and
 * re-compiled server-side when executed (never trusted from the client).
 */
export const BUILTIN_SCREENS: BuiltinScreen[] = [
  {
    id: 'builtin:clears',
    name: 'Clears the line',
    expression: 'rent_price_ratio >= 0.01',
    columns: [...BUILTIN_COLUMNS],
    sort: DEFAULT_SORT,
  },
  {
    id: 'builtin:price-cuts',
    name: 'Price cuts',
    expression: 'price_cut_pct > 0.05',
    columns: [...BUILTIN_COLUMNS],
    sort: { col: 'price_cut_pct', dir: 'desc' },
  },
  {
    id: 'builtin:stale-motivated',
    name: 'Stale + motivated',
    expression: 'days_on_market > 90 AND price_cut_pct > 0',
    columns: [...BUILTIN_COLUMNS],
    sort: { col: 'dom', dir: 'desc' },
  },
  {
    id: 'builtin:fresh-today',
    name: 'Fresh today',
    expression: 'days_on_market <= 1',
    columns: [...BUILTIN_COLUMNS],
    sort: { col: 'dom', dir: 'asc' },
  },
];

/** A persisted (user) screen as returned by /api/screens. */
export interface UserScreen {
  id: number;
  user_id: string;
  name: string;
  expression: string;
  columns: string[];
  sort: ScreenSort | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Unified shape used by ScreenTabs regardless of source. */
export type ScreenLike =
  | ({ kind: 'builtin' } & BuiltinScreen)
  | ({ kind: 'user' } & UserScreen);
