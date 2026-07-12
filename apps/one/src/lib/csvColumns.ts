/**
 * X1 — server-side CSV column registry for the pro terminal export.
 *
 * This is the SERVER counterpart of apps/two/src/lib/columns.tsx. That file is
 * a React render registry ("use client"); this one is plain, React-free
 * functions used by the streamed CSV export route
 * (apps/one/src/app/api/properties/export/route.ts).
 *
 * PARITY CONTRACT
 * ---------------
 * The investor-math columns (cap / CoC / gross-yield / 1% / ratio / band-spread)
 * derive from the SAME `@oper/primitives` formulas the client table uses, with
 * the SAME assumptions (50%-rule opex, 20% down, 7%/30yr). `motivated` uses the
 * `motivatedSellerScore` primitive (the TS twin of MOTIVATED_SELLER_SCORE_SQL,
 * parity-tested), so an exported cell can never disagree with the on-screen cell.
 *
 * Every column emits a MACHINE-READABLE value (a number without $/% symbols, or
 * a plain string) so the CSV loads cleanly into a spreadsheet. Percent columns
 * emit the percent *number* (e.g. 5.2 for 5.2%) at the same decimal precision
 * the table renders. Nulls / missing data emit an empty string.
 *
 * All 20 registry ids are covered so an arbitrary visible-column set exports.
 */

import {
  capRate,
  grossYield,
  noiAnnual,
  loanAmount,
  monthlyMortgage,
  annualCashflow,
  cashOnCash,
  motivatedSellerScore,
} from '@oper/primitives/underwriting';

/** A raw `listings` row as returned by the export SELECT (pg may hand back
 *  numeric columns as strings — the value functions coerce defensively). */
export type CsvExportRow = Record<string, unknown>;

export interface CsvColumnDef {
  /** CSV header cell — mirrors the on-screen column label. */
  header: string;
  /** Machine-readable cell value; empty string for missing data. */
  value: (row: CsvExportRow) => string | number;
}

/* ------------------------------------------------------------------ */
/* Investor-math assumptions (must match apps/two/src/lib/columns.tsx) */
/* ------------------------------------------------------------------ */

const OPEX_RATIO = 0.5;
const DOWN_PCT = 0.2;
const INTEREST_RATE = 0.07;
const LOAN_TERM_YEARS = 30;

/* ------------------------------------------------------------------ */
/* Null-safe coercion + formatting helpers                             */
/* ------------------------------------------------------------------ */

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Render a fraction (0.052) as a rounded percent number (5.2). */
function pct(fraction: number | null, decimals: number): number | '' {
  if (fraction == null || !Number.isFinite(fraction)) return '';
  return Number((fraction * 100).toFixed(decimals));
}

/**
 * Cash-on-cash proxy: 20% down, 7%/30yr amortizing loan, 50%-rule NOI. Mirrors
 * the `coc()` helper in apps/two/src/lib/columns.tsx line-for-line.
 */
function coc(price: number | null, rent: number | null): number | null {
  if (price == null || price <= 0 || rent == null) return null;
  const noi = noiAnnual(rent, OPEX_RATIO);
  if (noi == null) return null;
  const loan = loanAmount(price, DOWN_PCT);
  const debtService = monthlyMortgage(loan, INTEREST_RATE, LOAN_TERM_YEARS) * 12;
  const cashflow = annualCashflow(noi, debtService);
  const invested = price * DOWN_PCT;
  return cashOnCash(cashflow, invested);
}

/** Rent-band spread: (rent_high − rent_low) / estimated_rent. */
function bandSpread(row: CsvExportRow): number | null {
  const low = num(row.rent_low);
  const high = num(row.rent_high);
  const rent = num(row.estimated_rent);
  if (low == null || high == null || rent == null || rent <= 0) return null;
  return (high - low) / rent;
}

/* ------------------------------------------------------------------ */
/* The registry — one entry per column id in columns.tsx (20 total)    */
/* ------------------------------------------------------------------ */

export const CSV_COLUMNS: Record<string, CsvColumnDef> = {
  address: { header: 'Address', value: (r) => str(r.address) },
  price: { header: 'Price', value: (r) => num(r.price) ?? '' },
  estRent: { header: 'Est. Rent', value: (r) => num(r.estimated_rent) ?? '' },
  beds: { header: 'Bd', value: (r) => num(r.bedrooms) ?? '' },
  baths: { header: 'Ba', value: (r) => num(r.bathrooms) ?? '' },
  sqft: { header: 'Sqft', value: (r) => num(r.sqft) ?? '' },
  ppsf: {
    // COMPUTED: $/sqft = price / sqft (same as the table; not a listings column).
    header: '$/sqft',
    value: (r) => {
      const p = num(r.price);
      const s = num(r.sqft);
      return p != null && s != null && s > 0 ? Math.round(p / s) : '';
    },
  },
  onePct: {
    // COMPUTED: monthly 1% rule = (rent / price) * 100.
    header: '1%',
    value: (r) => {
      const p = num(r.price);
      const rent = num(r.estimated_rent);
      return p != null && p > 0 && rent != null ? Number(((rent / p) * 100).toFixed(2)) : '';
    },
  },
  ratio: {
    // COMPUTED: rent/price ratio (the rent_price_ratio generated column) as %.
    header: 'Ratio',
    value: (r) => {
      const ratio = num(r.rent_price_ratio);
      if (ratio != null) return pct(ratio, 2);
      const p = num(r.price);
      const rent = num(r.estimated_rent);
      return p != null && p > 0 && rent != null ? pct(rent / p, 2) : '';
    },
  },
  cap: {
    // COMPUTED: cap rate under the 50% rule (@oper/primitives capRate).
    header: 'Cap',
    value: (r) => pct(capRate(num(r.price) ?? 0, num(r.estimated_rent) ?? NaN, OPEX_RATIO), 1),
  },
  coc: {
    // COMPUTED: cash-on-cash proxy (@oper/primitives amortization primitives).
    header: 'CoC',
    value: (r) => pct(coc(num(r.price), num(r.estimated_rent)), 1),
  },
  grossYield: {
    // COMPUTED: gross yield = rent*12/price (@oper/primitives grossYield).
    header: 'Gross Yld',
    value: (r) => pct(grossYield(num(r.price) ?? 0, num(r.estimated_rent) ?? NaN), 1),
  },
  bandSpread: {
    // COMPUTED: rent-band spread % (see bandSpread()).
    header: 'Band %',
    value: (r) => pct(bandSpread(r), 1),
  },
  motivated: {
    // COMPUTED: 0–100 motivated-seller score via the @oper/primitives helper
    // (the TS twin of MOTIVATED_SELLER_SCORE_SQL — parity-tested).
    header: 'Motiv.',
    value: (r) =>
      motivatedSellerScore(
        num(r.price_cut_pct),
        num(r.price_cut_count),
        num(r.days_on_market),
        typeof r.sale_type === 'string' ? r.sale_type : null,
      ),
  },
  dom: { header: 'DOM', value: (r) => num(r.days_on_market) ?? '' },
  cut: {
    // Fractional price cut rendered as %.
    header: 'Cut %',
    value: (r) => pct(num(r.price_cut_pct), 1),
  },
  yearBuilt: { header: 'Built', value: (r) => num(r.year_built) ?? '' },
  flood: {
    // No flood/SFHA data source on `listings` yet (mirrors columns.tsx, which
    // renders N/A). Emitted empty so the column still appears when selected.
    header: 'SFHA',
    value: () => '',
  },
  saleType: { header: 'Sale', value: (r) => str(r.sale_type) },
  status: { header: 'Status', value: (r) => str(r.listing_status) },
};

/** All ids the export understands (registry order). */
export const CSV_COLUMN_IDS = Object.keys(CSV_COLUMNS);

/**
 * Default visible columns when a screen carries none — mirrors
 * DEFAULT_COLUMN_IDS in apps/two/src/lib/columns.tsx.
 */
export const DEFAULT_EXPORT_COLUMN_IDS = [
  'address',
  'price',
  'ppsf',
  'beds',
  'baths',
  'sqft',
  'onePct',
  'cap',
  'coc',
  'estRent',
  'dom',
  'cut',
  'motivated',
  'status',
];

/**
 * Escape a single CSV field. Quotes when the value contains a comma, quote, or
 * newline, and neutralizes spreadsheet formula injection (a leading = + - @ or
 * tab/CR would execute as a formula in Excel/Sheets — cell values include
 * scraped external data like addresses).
 */
export function csvEscape(value: string | number): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Resolve an ordered id list to export column defs, dropping unknown ids and
 * falling back to the default set when nothing valid remains.
 */
export function resolveExportColumns(ids: string[] | null | undefined): Array<{ id: string; def: CsvColumnDef }> {
  const source = ids && ids.length > 0 ? ids : DEFAULT_EXPORT_COLUMN_IDS;
  const resolved = source
    .filter((id) => CSV_COLUMNS[id])
    .map((id) => ({ id, def: CSV_COLUMNS[id] }));
  if (resolved.length > 0) return resolved;
  return DEFAULT_EXPORT_COLUMN_IDS.map((id) => ({ id, def: CSV_COLUMNS[id] }));
}
