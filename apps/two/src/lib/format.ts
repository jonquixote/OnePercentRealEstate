/**
 * Tight, allocation-free formatters used everywhere in the terminal.
 * Bloomberg-y dense readout demands consistent decimal counts; anything that
 * misaligns a tabular-nums column gets caught here.
 */

const priceFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return priceFmt.format(n);
}

export function formatPpsf(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return `$${Math.round(n)}`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatBeds(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  // beds are sometimes ".5" — show one decimal only if non-integer
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatPct(
  n: number | null | undefined,
  decimals = 2,
): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return compactFmt.format(n);
}

/**
 * Tailwind color for the 1% rule cell.
 * >=1: emerald (deal pencils); 0.85–1: amber (marginal); <0.85: muted.
 */
export function onePctColor(n: number | null | undefined): string {
  if (n == null) return "text-zinc-500";
  if (n >= 1) return "text-emerald-400";
  if (n >= 0.85) return "text-amber-400";
  return "text-zinc-500";
}

/** Status pill color — small visual cue, keep palette tight. */
export function statusStyle(status: string | null | undefined): {
  bg: string;
  text: string;
  label: string;
} {
  const s = (status ?? "").toLowerCase();
  if (s === "for_sale" || s === "active") {
    return { bg: "bg-emerald-500/10", text: "text-emerald-300", label: "ACTIVE" };
  }
  if (s === "pending" || s === "under_contract") {
    return { bg: "bg-amber-500/10", text: "text-amber-300", label: "PENDING" };
  }
  if (s === "sold") {
    return { bg: "bg-zinc-500/10", text: "text-zinc-400", label: "SOLD" };
  }
  return {
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    label: (status ?? "—").toUpperCase().slice(0, 8),
  };
}
