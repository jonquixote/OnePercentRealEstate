"use client";

import * as React from "react";

/**
 * W4 — market chart pane. Fetches `/api/market-series` for the selected row's
 * ZIP and renders three stacked sparkline-style series in hand-rolled SVG
 * (NO chart dependency — mirrors apps/one/src/components/property/PriceSparkline.tsx).
 *
 * Layout: three horizontal bands share a single numeric-year x-axis. Each band
 * normalizes its own y to its min/max. A single vertical crosshair tracks the
 * pointer and shows each visible series' nearest value + year in a tooltip.
 * Series toggles let the operator hide a noisy line.
 */

interface Pt {
  t: number; // numeric year (float for monthly unemployment)
  v: number;
}
interface SeriesData {
  hpi: Pt[];
  unemployment: Pt[];
  rent_psf: Pt[];
}
type SeriesKey = keyof SeriesData;

const META: Record<SeriesKey, { label: string; color: string; fmt: (v: number) => string }> = {
  hpi: {
    label: "HPI",
    color: "#c9a35c",
    fmt: (v) => v.toFixed(0),
  },
  unemployment: {
    label: "Unemployment %",
    color: "#e07a5f",
    fmt: (v) => `${v.toFixed(2)}%`,
  },
  rent_psf: {
    label: "Rent $/sqft",
    color: "#1f9d6e",
    fmt: (v) => `$${v.toFixed(4)}`,
  },
};

const ALL: SeriesKey[] = ["hpi", "unemployment", "rent_psf"];

function nearest(pts: Pt[], t: number): Pt | null {
  if (pts.length === 0) return null;
  let best = pts[0];
  let bestD = Math.abs(pts[0].t - t);
  for (const p of pts) {
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function ChartPane({ zip }: { zip: string | null }) {
  const [data, setData] = React.useState<SeriesData | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [visible, setVisible] = React.useState<Record<SeriesKey, boolean>>({
    hpi: true,
    unemployment: true,
    rent_psf: true,
  });
  const [hoverT, setHoverT] = React.useState<number | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  // Track container size so the SVG renders at true pixels (no viewBox scaling
  // distortion of strokes / text).
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(0, Math.floor(r.width)), h: Math.max(0, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!zip) {
      setData(null);
      setStatus("idle");
      return;
    }
    let alive = true;
    setStatus("loading");
    fetch(`/api/market-series?zip=${encodeURIComponent(zip)}&series=${ALL.join(",")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`market-series ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        const series = d?.series ?? {};
        setData({
          hpi: Array.isArray(series.hpi) ? series.hpi : [],
          unemployment: Array.isArray(series.unemployment) ? series.unemployment : [],
          rent_psf: Array.isArray(series.rent_psf) ? series.rent_psf : [],
        });
        setStatus("idle");
      })
      .catch(() => {
        if (alive) {
          setData(null);
          setStatus("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [zip]);

  if (!zip) {
    return (
      <div
        id="terminal-chart"
        data-chart-slot
        className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">Chart</p>
        <p className="mt-1 font-mono text-[10px] text-zinc-600">select a row to plot market series</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div id="terminal-chart" data-chart-slot className="flex h-full w-full items-center justify-center bg-zinc-950">
        <p className="font-mono text-[10px] text-zinc-600">loading {zip}…</p>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div id="terminal-chart" data-chart-slot className="flex h-full w-full items-center justify-center bg-zinc-950">
        <p className="font-mono text-[10px] text-rose-400">series load failed for {zip}</p>
      </div>
    );
  }

  const active = ALL.filter((k) => visible[k]);
  const hasData = active.some((k) => data[k].length > 0);

  // Shared x domain across all series (numeric years).
  let minT = Infinity;
  let maxT = -Infinity;
  for (const k of active) {
    for (const p of data[k]) {
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
    }
  }
  if (!Number.isFinite(minT)) {
    minT = 0;
    maxT = 1;
  }
  const tSpan = maxT - minT || 1;

  const padL = 56;
  const padR = 70;
  const padTop = 24;
  const padBottom = 18;
  const { w, h } = size;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padTop - padBottom);
  const bandH = active.length > 0 ? plotH / active.length : plotH;

  const xOf = (t: number) => padL + ((t - minT) / tSpan) * plotW;

  function bandScale(pts: Pt[], bandTop: number) {
    const ys = pts.map((p) => p.v);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const span = hi - lo || 1;
    const innerPad = bandH * 0.18;
    const usable = bandH - innerPad * 2;
    const yOf = (v: number) => bandTop + innerPad + (1 - (v - lo) / span) * usable;
    return { yOf, lo, hi };
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = minT + ((x - padL) / plotW) * tSpan;
    setHoverT(t);
  };

  // Tooltip anchor: vertical line x + first active band's top for label.
  const hoverX = hoverT != null ? xOf(hoverT) : null;

  return (
    <div id="terminal-chart" data-chart-slot className="flex h-full w-full flex-col bg-zinc-950">
      {/* Toggle chips */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-800/60 px-2 py-1">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          {zip}
        </span>
        {ALL.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              visible[k]
                ? "border-transparent text-zinc-100"
                : "border-zinc-800 text-zinc-600 line-through"
            }`}
            style={visible[k] ? { backgroundColor: `${META[k].color}22`, color: META[k].color } : undefined}
            aria-pressed={visible[k]}
          >
            {META[k].label}
          </button>
        ))}
        {!hasData ? (
          <span className="ml-auto font-mono text-[10px] text-zinc-600">no series data</span>
        ) : null}
      </div>

      {/* Chart body */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {w > 0 && h > 0 && hasData ? (
          <svg
            width={w}
            height={h}
            className="block touch-none"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverT(null)}
            role="img"
            aria-label={`Market series for ${zip}`}
          >
            {active.map((k, i) => {
              const pts = data[k];
              const bandTop = padTop + i * bandH;
              const { yOf, lo, hi } = bandScale(pts, bandTop);
              const xy = pts.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`);
              const color = META[k].color;
              const last = pts[pts.length - 1];
              return (
                <g key={k}>
                  {/* band separator */}
                  {i > 0 ? (
                    <line x1={padL} x2={w - padR} y1={bandTop} y2={bandTop} stroke="#27272a" strokeWidth={1} />
                  ) : null}
                  {/* y range labels */}
                  <text x={padL - 6} y={bandTop + 10} textAnchor="end" className="fill-zinc-500" style={{ fontSize: 9 }} fontFamily="monospace">
                    {META[k].fmt(hi)}
                  </text>
                  <text x={padL - 6} y={bandTop + bandH - 4} textAnchor="end" className="fill-zinc-500" style={{ fontSize: 9 }} fontFamily="monospace">
                    {META[k].fmt(lo)}
                  </text>
                  {/* baseline */}
                  <line x1={padL} x2={w - padR} y1={bandTop + bandH - 4} y2={bandTop + bandH - 4} stroke="#18181b" strokeWidth={1} />
                  {xy.length > 0 ? (
                    <>
                      <polyline
                        points={xy.join(" ")}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.75}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <circle cx={xOf(last.t)} cy={yOf(last.v)} r={2.5} fill={color} />
                    </>
                  ) : null}
                  {/* series label */}
                  <text x={w - padR + 6} y={bandTop + bandH / 2} className="fill-zinc-400" style={{ fontSize: 9 }} fontFamily="monospace">
                    {META[k].label}
                  </text>
                  {/* hover marker for this series */}
                  {hoverT != null && hoverX != null ? (() => {
                    const np = nearest(pts, hoverT);
                    if (!np) return null;
                    const hx = xOf(np.t);
                    const hy = yOf(np.v);
                    const onScreen = hx >= padL && hx <= w - padR;
                    return onScreen ? (
                      <g>
                        <circle cx={hx} cy={hy} r={3} fill={color} stroke="#0a0a0a" strokeWidth={1} />
                      </g>
                    ) : null;
                  })() : null}
                </g>
              );
            })}

            {/* shared crosshair */}
            {hoverX != null && hoverX >= padL && hoverX <= w - padR ? (
              <line x1={hoverX} x2={hoverX} y1={padTop} y2={h - padBottom} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
            ) : null}

            {/* x-axis year ticks (first + last) */}
            <text x={padL} y={h - 5} textAnchor="start" className="fill-zinc-500" style={{ fontSize: 9 }} fontFamily="monospace">
              {Math.round(minT)}
            </text>
            <text x={w - padR} y={h - 5} textAnchor="end" className="fill-zinc-500" style={{ fontSize: 9 }} fontFamily="monospace">
              {Math.round(maxT)}
            </text>
          </svg>
        ) : null}

        {/* tooltip */}
        {hoverT != null ? (
          <Tooltip zip={zip} data={data} active={active} t={hoverT} />
        ) : null}
      </div>
    </div>
  );
}

function Tooltip({
  zip,
  data,
  active,
  t,
}: {
  zip: string;
  data: SeriesData;
  active: SeriesKey[];
  t: number;
}) {
  const rows = active
    .map((k) => ({ k, p: nearest(data[k], t) }))
    .filter((r) => r.p != null) as { k: SeriesKey; p: Pt }[];
  if (rows.length === 0) return null;
  const year = Math.round(t);
  return (
    <div className="pointer-events-none absolute left-2 top-2 rounded-sm border border-zinc-800 bg-zinc-900/95 px-2 py-1 font-mono text-[10px] shadow-lg">
      <div className="mb-0.5 text-zinc-400">{zip} · ~{year}</div>
      {rows.map(({ k, p }) => (
        <div key={k} className="flex items-center gap-2">
          <span style={{ color: META[k].color }}>{META[k].label}</span>
          <span className="tabular-nums text-zinc-100">{META[k].fmt(p.v)}</span>
        </div>
      ))}
    </div>
  );
}
