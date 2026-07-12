"use client";

import * as React from "react";
import { median, percentile } from "@/lib/coerce";
import { formatCompact, formatPct, formatPpsf, formatPrice } from "@/lib/format";
import type { PropertyRow } from "@/lib/types";

interface Props {
  rows: PropertyRow[];
  /** Last query round-trip latency (ms), or null when unknown. */
  latencyMs?: number | null;
  /** Name of the active screen, or a fallback label for ad-hoc/live modes. */
  screenName?: string | null;
}

/**
 * One-line aggregate readout above the table. Recomputes when the row set
 * changes (filters, refetches). Kept inline + mono so it reads like a
 * terminal tape rather than a "dashboard".
 */
export const StatBar = React.memo(function StatBar({
  rows,
  latencyMs,
  screenName,
}: Props) {
  const stats = React.useMemo(() => {
    return {
      count: rows.length,
      medPrice: median(rows, (r) => r.price),
      medPpsf: median(rows, (r) => r.ppsf),
      medOnePct: median(rows, (r) => r.onePct),
      medCap: median(rows, (r) => r.cap),
      medDom: median(rows, (r) => r.dom),
      q1Price: percentile(rows, (r) => r.price, 25),
      q3Price: percentile(rows, (r) => r.price, 75),
      q1OnePct: percentile(rows, (r) => r.onePct, 25),
      q3OnePct: percentile(rows, (r) => r.onePct, 75),
    };
  }, [rows]);

  return (
    <div className="flex flex-col border-y border-zinc-800/60 bg-zinc-950/80 px-3 py-1.5 font-mono text-[11px]">
      {/* Median row */}
      <div className="flex items-center gap-3">
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
        <span className="ml-auto flex items-center gap-3 text-zinc-600">
          {screenName ? (
            <span className="text-zinc-400">⟨{screenName}⟩</span>
          ) : null}
          {latencyMs != null ? <span className="text-zinc-500">⌚{latencyMs}ms</span> : null}
          <span>live · 60s ttl</span>
        </span>
      </div>

      {/* IQR row */}
      <div className="flex items-center gap-3 pt-1.5 text-[10px]">
        <span className="flex items-baseline gap-1.5">
          <span className="text-zinc-500">IQR PRICE</span>
          <span className="num text-zinc-100">
            {stats.q1Price != null && stats.q3Price != null
              ? `${formatPrice(stats.q1Price)} – ${formatPrice(stats.q3Price)}`
              : "—"}
          </span>
        </span>
        <Dot />
        <span className="flex items-baseline gap-1.5">
          <span className="text-zinc-500">IQR 1%</span>
          <span className="num text-zinc-100">
            {stats.q1OnePct != null && stats.q3OnePct != null
              ? `${formatPct(stats.q1OnePct, 2)} – ${formatPct(stats.q3OnePct, 2)}`
              : "—"}
          </span>
        </span>
      </div>
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
