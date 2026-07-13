"use client";

import * as React from "react";
import {
  capRate,
  grossYield,
  rentToPriceMonthly,
  noiAnnual,
  loanAmount,
  monthlyMortgage,
  annualCashflow,
  cashOnCash,
} from "@oper/primitives/underwriting";
import { cn } from "@oper/primitives";
import {
  formatBeds,
  formatInt,
  formatPct,
  formatPpsf,
  formatPrice,
  onePctColor,
  statusStyle,
} from "./format";
import type { PropertyRow } from "./types";

/**
 * W2 — the pro-terminal column registry.
 *
 * Every column the grid can show is defined here exactly once. The registry is
 * the single source of truth for label/width/alignment/sort behavior and — for
 * the investor-math columns — the render math (via `@oper/primitives`, the same
 * formulas the underwriting engine uses, so a cell can never disagree with the
 * inspector).
 *
 * SORT / PARITY CONTRACT
 * ----------------------
 * `sortKey` is a *server-side* order id (see the whitelist in
 * apps/one .../properties/query/route.ts). It is NOT the column id — it names
 * the raw SQL column the server may ORDER BY. Sorting is server-side, so a
 * computed column can only be sortable if it is a *monotonic* function of one
 * raw column. That holds for the rent-yield family:
 *
 *   let r = estimated_rent / price   (the rent_price_ratio generated column)
 *   onePct   = 100·r                 → monotonic in r
 *   ratio    = r
 *   grossYld = 12·r
 *   cap(50%) = 6·r                   (noi = rent·12·0.5; cap = noi/price)
 *   CoC      = 30·r − 48·mf          (mf = constant amort factor; see coc())
 *
 * All five increase with r, so ORDER BY rent_price_ratio DESC puts the true
 * max of each at the top — the client recompute matches the server order
 * (the acceptance parity check). Columns that are NOT a monotonic function of
 * a single raw column ($/sqft, band spread, flood) have no `sortKey` and are
 * not sortable.
 */

export type ColumnAlign = "left" | "right";

export interface ColumnDef {
  id: string;
  label: string;
  width: number;
  align: ColumnAlign;
  /** Server-side ORDER BY id (raw whitelist). Omit → column not sortable. */
  sortKey?: string;
  render: (row: PropertyRow) => React.ReactNode;
}

/* ------------------------------------------------------------------ */
/* Investor-math assumptions (documented, shared by every math cell)   */
/* ------------------------------------------------------------------ */

/** 50%-rule operating-expense ratio (matches underwriting.ts). */
const OPEX_RATIO = 0.5;
/** Down payment for the CoC proxy. */
const DOWN_PCT = 0.2;
/** Financing assumption for the CoC proxy. */
const INTEREST_RATE = 0.07;
const LOAN_TERM_YEARS = 30;

/**
 * Cash-on-cash proxy: 20% down, 7%/30yr amortizing loan, 50%-rule NOI.
 *   invested = price · 20%
 *   cashflow = NOI − annual debt service
 * Uses the same primitives as the underwriting engine so the number matches
 * the inspector. Monotonic in rent/price (see file header) → server-sortable
 * via rent_price_ratio.
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

/**
 * Rent-band spread: relative width of the rent confidence band, expressed as a
 * fraction of the point estimate. `(rent_high − rent_low) / estimated_rent`.
 * A tighter band (smaller %) means a more confident rent estimate.
 */
function bandSpread(row: PropertyRow): number | null {
  const { rent_low, rent_high, estimated_rent } = row;
  if (rent_low == null || rent_high == null || estimated_rent == null || estimated_rent <= 0) {
    return null;
  }
  return (rent_high - rent_low) / estimated_rent;
}

/** Render a fraction (0.012) as a percentage cell. */
function pctCell(fraction: number | null, decimals = 2, className = "text-zinc-300") {
  return (
    <span className={cn("num", className)}>
      {formatPct(fraction == null ? null : fraction * 100, decimals)}
    </span>
  );
}

const NA = <span className="num text-zinc-600">—</span>;

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const COLUMNS: ColumnDef[] = [
  {
    id: "address",
    label: "Address",
    width: 280,
    align: "left",
    sortKey: "address",
    render: (r) => <span className="line-clamp-1 text-zinc-200">{r.address}</span>,
  },
  {
    id: "price",
    label: "Price",
    width: 100,
    align: "right",
    sortKey: "price",
    render: (r) => <span className="num text-zinc-100">{formatPrice(r.price)}</span>,
  },
  {
    id: "estRent",
    label: "Est. Rent",
    width: 90,
    align: "right",
    sortKey: "estimated_rent",
    render: (r) => <span className="num text-zinc-300">{formatPrice(r.estimated_rent)}</span>,
  },
  {
    id: "beds",
    label: "Bd",
    width: 44,
    align: "right",
    sortKey: "bedrooms",
    render: (r) => <span className="num text-zinc-300">{formatBeds(r.bedrooms)}</span>,
  },
  {
    id: "baths",
    label: "Ba",
    width: 44,
    align: "right",
    sortKey: "bathrooms",
    render: (r) => <span className="num text-zinc-300">{formatBeds(r.bathrooms)}</span>,
  },
  {
    id: "sqft",
    label: "Sqft",
    width: 70,
    align: "right",
    sortKey: "sqft",
    render: (r) => <span className="num text-zinc-300">{formatInt(r.sqft)}</span>,
  },
  {
    // COMPUTED: $/sqft = price / sqft. Not a monotonic function of one raw
    // column → not server-sortable.
    id: "ppsf",
    label: "$/sqft",
    width: 70,
    align: "right",
    render: (r) => <span className="num text-zinc-300">{formatPpsf(r.ppsf)}</span>,
  },
  {
    // COMPUTED: monthly 1% rule = (rent/price)·100. Sorts via rent_price_ratio.
    id: "onePct",
    label: "1%",
    width: 64,
    align: "right",
    sortKey: "rent_price_ratio",
    render: (r) => (
      <span className={cn("num font-medium", onePctColor(r.onePct))}>{formatPct(r.onePct, 2)}</span>
    ),
  },
  {
    // COMPUTED: rent/price ratio (the underwriting primitive; equals the
    // rent_price_ratio generated column).
    id: "ratio",
    label: "Ratio",
    width: 64,
    align: "right",
    sortKey: "rent_price_ratio",
    render: (r) => pctCell(r.rent_price_ratio ?? rentToPriceMonthly(r.price ?? 0, r.estimated_rent ?? NaN), 2),
  },
  {
    // COMPUTED: cap rate under the 50% rule (noi = rent·12·0.5; cap = noi/price).
    id: "cap",
    label: "Cap",
    width: 60,
    align: "right",
    sortKey: "rent_price_ratio",
    render: (r) => pctCell(capRate(r.price ?? 0, r.estimated_rent ?? NaN, OPEX_RATIO), 1),
  },
  {
    // COMPUTED: cash-on-cash proxy, 20% down (see coc()).
    id: "coc",
    label: "CoC",
    width: 64,
    align: "right",
    sortKey: "rent_price_ratio",
    render: (r) => pctCell(coc(r.price, r.estimated_rent), 1),
  },
  {
    // COMPUTED: gross yield = rent·12/price.
    id: "grossYield",
    label: "Gross Yld",
    width: 74,
    align: "right",
    sortKey: "rent_price_ratio",
    render: (r) => pctCell(grossYield(r.price ?? 0, r.estimated_rent ?? NaN), 1),
  },
  {
    // COMPUTED: rent-band spread % (see bandSpread()). Not server-sortable.
    id: "bandSpread",
    label: "Band %",
    width: 68,
    align: "right",
    render: (r) => pctCell(bandSpread(r), 1, "text-zinc-400"),
  },
  {
    id: "motivated",
    label: "Motiv.",
    width: 60,
    align: "right",
    sortKey: "motivated_score",
    render: (r) => <span className="num text-zinc-300">{formatInt(r.motivated_score)}</span>,
  },
  {
    id: "dom",
    label: "DOM",
    width: 52,
    align: "right",
    sortKey: "days_on_market",
    render: (r) => <span className="num text-zinc-400">{formatInt(r.dom)}</span>,
  },
  {
    id: "cut",
    label: "Cut %",
    width: 60,
    align: "right",
    sortKey: "price_cut_pct",
    render: (r) => pctCell(r.price_cut_pct, 1, "text-zinc-400"),
  },
  {
    id: "yearBuilt",
    label: "Built",
    width: 56,
    align: "right",
    sortKey: "year_built",
    render: (r) => <span className="num text-zinc-400">{r.year_built == null ? "—" : String(r.year_built)}</span>,
  },
  {
    // No flood field on `listings` — SFHA is always N/A for now (spec).
    id: "flood",
    label: "SFHA",
    width: 56,
    align: "right",
    render: () => NA,
  },
  {
    id: "saleType",
    label: "Sale",
    width: 90,
    align: "left",
    render: (r) => (
      <span className="text-zinc-400">{r.sale_type ? r.sale_type.replace(/_/g, " ") : "—"}</span>
    ),
  },
  {
    id: "status",
    label: "Status",
    width: 78,
    align: "left",
    render: (r) => {
      const s = statusStyle(r.status);
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[9px] tracking-wider",
            s.bg,
            s.text,
          )}
        >
          {s.label}
        </span>
      );
    },
  },
];

/** id → ColumnDef lookup. */
export const COLUMN_MAP: Record<string, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c]),
);

/** All column ids (registry order). */
export const ALL_COLUMN_IDS = COLUMNS.map((c) => c.id);

/**
 * Default visible columns (the classic tape view: identity + the headline
 * investor metrics), in render order. Screens override this via their
 * `columns` JSONB.
 */
export const DEFAULT_COLUMN_IDS = [
  "address",
  "price",
  "ppsf",
  "beds",
  "baths",
  "sqft",
  "onePct",
  "cap",
  "coc",
  "estRent",
  "dom",
  "cut",
  "motivated",
  "status",
];

/**
 * Resolve an ordered list of column ids to their defs, dropping unknown ids.
 * Used to render the grid from a screen's `columns` array.
 */
export function resolveColumns(ids: string[] | null | undefined): ColumnDef[] {
  const source = ids && ids.length > 0 ? ids : DEFAULT_COLUMN_IDS;
  return source.map((id) => COLUMN_MAP[id]).filter((c): c is ColumnDef => Boolean(c));
}

/**
 * Translate a sort col (a column id, or an already-raw server column name from a
 * legacy W1 screen sort) into the server-side ORDER BY id. Returns null when the
 * column is not sortable — the caller should then omit `orderBy` (server falls
 * back to id DESC). The server independently whitelists the returned id, so an
 * unknown value is harmless.
 */
export function serverSortKey(col: string | null | undefined): string | null {
  if (!col) return null;
  const def = COLUMN_MAP[col];
  if (def) return def.sortKey ?? null;
  // Legacy / raw column name (e.g. a W1 screen stored col:'price_cut_pct').
  return col;
}
