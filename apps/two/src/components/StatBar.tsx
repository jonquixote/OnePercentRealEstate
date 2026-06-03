"use client";

import * as React from "react";
import { median } from "@/lib/coerce";
import { formatCompact, formatPct, formatPpsf, formatPrice } from "@/lib/format";
import type { PropertyRow } from "@/lib/types";

interface Props {
  rows: PropertyRow[];
}

/**
 * One-line aggregate readout above the table. Recomputes when the row set
 * changes (filters, refetches). Kept inline + mono so it reads like a
 * terminal tape rather than a "dashboard".
 */
export const StatBar = React.memo(function StatBar({ rows }: Props) {
  const stats = React.useMemo(() => {
    return {
      count: rows.length,
      medPrice: median(rows, (r) => r.price),
      medPpsf: median(rows, (r) => r.ppsf),
      medOnePct: median(rows, (r) => r.onePct),
      medCap: median(rows, (r) => r.cap),
      medDom: median(rows, (r) => r.dom),
    };
  }, [rows]);

  return (
    <div className="flex items-center gap-3 border-y border-zinc-800/60 bg-zinc-950/80 px-3 py-1.5 font-mono text-[11px]">
      <Stat label="N" value={formatCompact(stats.count)} />
      <Dot />
      <Stat label="MED PRICE" value={formatPrice(stats.medPrice)} />
      <Dot />
      <Stat label="MED $/SQFT" value={formatPpsf(stats.medPpsf)} />
      <Dot />
      <Stat label="MED 1%" value={formatPct(stats.medOnePct, 2)} />
      <Dot />
      <Stat label="MED CAP" value={formatPct(stats.medCap, 1)} />
      <Dot />
      <Stat label="MED DOM" value={stats.medDom != null ? Math.round(stats.medDom).toString() : "—"} />
      <span className="ml-auto text-zinc-600">live · 60s ttl</span>
    </div>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <span className="num text-zinc-100">{value}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-zinc-700">·</span>;
}
