"use client";

import * as React from "react";
import { Button, cn } from "@oper/primitives";
import { sparkSeries } from "@/lib/coerce";
import {
  formatBeds,
  formatInt,
  formatPct,
  formatPrice,
  onePctColor,
  statusStyle,
} from "@/lib/format";
import { useSelection } from "@/lib/selection";

/**
 * Right-pane property inspector.
 *
 * Reads selection from context — the table sets the selected row when clicked
 * (or when j/k is pressed at the page level). The inspector is fully
 * self-contained: zero props, all data flows through `useSelection()` which
 * carries the full `PropertyRow`, not just an id. This avoids the secondary
 * dataset context the brief sketched out; the selection object itself is the
 * envelope.
 */
export function PropertyInspector() {
  const { selected } = useSelection();

  if (!selected) {
    return (
      <aside className="flex h-full w-full items-center justify-center border-l border-zinc-800/60 bg-zinc-950 px-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
          Select a row to inspect
        </p>
      </aside>
    );
  }

  const status = statusStyle(selected.status);
  const consumerHref = `https://one.octavo.press/property/${encodeURIComponent(
    selected.id,
  )}`;

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-zinc-800/60 bg-zinc-950">
      {/* Label strip */}
      <header className="border-b border-zinc-800/60 px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Property
        </p>
        <h2
          className="mt-0.5 line-clamp-1 text-sm font-medium text-zinc-100"
          title={selected.address}
        >
          {selected.address}
        </h2>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {/* The viewport payload doesn't currently break city/state out — show
              the lat/lon so the caption isn't empty. Replaced when address
              parts land in the v2 of the schema. */}
          {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}
        </p>
      </header>

      {/* 2x2 stat grid */}
      <section className="grid grid-cols-2 gap-px bg-zinc-800/40">
        <StatCell label="Price" value={formatPrice(selected.price)} />
        <StatCell label="Est. Rent" value={formatPrice(selected.estimated_rent)} />
        <StatCell
          label="1%"
          value={formatPct(selected.onePct, 2)}
          tone={onePctColor(selected.onePct)}
        />
        <StatCell label="Cap" value={formatPct(selected.cap, 1)} />
      </section>

      {/* Sparkline */}
      <section className="border-b border-zinc-800/60 px-4 py-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Trend
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
            MOCK · listings_history seeds next
          </span>
        </div>
        <Sparkline id={selected.id} />
      </section>

      {/* Specs strip */}
      <section className="border-b border-zinc-800/60 px-4 py-3">
        <p className="font-mono text-[11px] tabular-nums text-zinc-300">
          <span>{formatBeds(selected.bedrooms)} bd</span>
          <Dot />
          <span>{formatBeds(selected.bathrooms)} ba</span>
          <Dot />
          <span>{formatInt(selected.sqft)} sqft</span>
          <Dot />
          {/* year_built isn't carried on the viewport schema; placeholder. */}
          <span>—</span>
        </p>
      </section>

      {/* Status + DOM */}
      <section className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] tracking-widest",
            status.bg,
            status.text,
          )}
        >
          {status.label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">
          DOM {formatInt(selected.dom)}
        </span>
      </section>

      {/* CTA row */}
      <section className="mt-auto flex items-center gap-2 border-t border-zinc-800/60 px-4 py-3">
        <Button asChild size="sm" variant="default" className="flex-1">
          <a href={consumerHref} target="_blank" rel="noreferrer noopener">
            Open in consumer site
          </a>
        </Button>
        <WatchButton id={selected.id} />
      </section>
    </aside>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="bg-zinc-950 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl tabular-nums",
          tone ?? "text-zinc-100",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Dot() {
  return <span className="mx-1.5 text-zinc-700">·</span>;
}

/**
 * Deterministic placeholder sparkline. Builds a smooth cubic path through a
 * 30-point series seeded from the property id (see `sparkSeries`). When
 * listings_history (Wave 3) lands, swap the series source and keep the
 * rendering — the path math is generic.
 */
function Sparkline({ id }: { id: string }) {
  const points = React.useMemo(() => sparkSeries(id, 30), [id]);
  const path = React.useMemo(() => buildSmoothPath(points, 200, 60), [points]);
  return (
    <svg
      viewBox="0 0 200 60"
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label="Mock 30-point price trend sparkline"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Convert a [0,1] series into an SVG path with cubic smoothing. The control
 * points are derived from neighbouring slopes, which gives the line a
 * tape-readout feel without the rigidity of straight segments.
 */
function buildSmoothPath(series: number[], w: number, h: number): string {
  if (series.length === 0) return "";
  const pad = 4;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const n = series.length;
  const xs = series.map((_, i) => pad + (i * innerW) / (n - 1));
  const ys = series.map((v) => pad + innerH - v * innerH);

  let d = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    const x0 = xs[i - 1];
    const y0 = ys[i - 1];
    const x1 = xs[i];
    const y1 = ys[i];
    const xPrev = i >= 2 ? xs[i - 2] : x0;
    const yPrev = i >= 2 ? ys[i - 2] : y0;
    const xNext = i + 1 < n ? xs[i + 1] : x1;
    const yNext = i + 1 < n ? ys[i + 1] : y1;
    const cp1x = x0 + (x1 - xPrev) / 6;
    const cp1y = y0 + (y1 - yPrev) / 6;
    const cp2x = x1 - (xNext - x0) / 6;
    const cp2y = y1 - (yNext - y0) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

/**
 * Watch is a no-op for v1. Visual feedback only — the button briefly
 * inverts so the user gets a click confirmation, and we log the intent so
 * a future implementer has a breadcrumb.
 */
function WatchButton({ id }: { id: string }) {
  const [pulsed, setPulsed] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        setPulsed(true);
        // eslint-disable-next-line no-console
        console.log("[watch] would persist watchlist add for", id);
        window.setTimeout(() => setPulsed(false), 180);
      }}
      className={cn(
        "transition-colors",
        pulsed && "bg-primary text-primary-foreground",
      )}
    >
      Watch
    </Button>
  );
}
