'use client';

import { useEffect, useMemo, useState } from 'react';

interface HistogramBin {
  loPct: number;
  hiPct: number;
  count: number;
}

interface RatioTapeProps {
  bins: HistogramBin[];
  thresholdPct: number; // the rule line, in percent
  clears: number;
  total: number;
  loading?: boolean;
}

/* deterministic PRNG so the scatter is stable across renders */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = new Intl.NumberFormat('en-US');

/**
 * The hero "tape": every listing plotted by rent/price against the rule line.
 * Marks are derived from the real /api/stats histogram (count per ratio bin),
 * scattered with deterministic jitter and settling outward from the line on
 * load. Deals that clear the line glow emerald; those below sit in brass.
 */
export function RatioTape({ bins, thresholdPct, clears, total, loading }: RatioTapeProps) {
  const [lit, setLit] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);

  useEffect(() => {
    if (reduced) {
      setLit(true);
      return;
    }
    setLit(false);
    const t = setTimeout(() => setLit(true), 200);
    return () => clearTimeout(t);
  }, [reduced, bins]);

  const W = 520;
  const H = 300;
  const padL = 18;
  const padR = 18;
  const min = 0.2;
  const max = 1.75;
  const xOf = (v: number) => padL + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (W - padL - padR);
  const lineX = xOf(thresholdPct);

  // Turn bin counts into ~170 marks, proportional to each bin's share.
  const marks = useMemo(() => {
    const totalCount = bins.reduce((a, b) => a + b.count, 0) || 1;
    const TARGET = 170;
    const rnd = mulberry32(7);
    const out: { x: number; y: number; clears: boolean }[] = [];
    for (const b of bins) {
      const n = Math.round((b.count / totalCount) * TARGET);
      for (let i = 0; i < n; i++) {
        const r = b.loPct + rnd() * (b.hiPct - b.loPct);
        out.push({ x: xOf(r), y: 30 + rnd() * (H - 78), clears: r >= thresholdPct });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins, thresholdPct]);

  const ticks = [0.4, 0.7, 1.0, 1.3, 1.6];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-ink-panel to-ink-2 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)]">
      {/* radial pass glow near the line */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 h-80 w-80"
        style={{
          left: `${(lineX / W) * 100}%`,
          transform: 'translateX(-50%)',
          background: 'radial-gradient(circle, rgba(52,224,161,0.13) 0%, transparent 65%)',
        }}
      />
      <div className="flex items-baseline justify-between px-5 pt-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Live ratio tape
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          rent &divide; price
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="block"
        role="img"
        aria-label={`${num.format(clears)} of ${num.format(total)} listings clear the ${thresholdPct.toFixed(2)}% line`}
      >
        {/* the line */}
        <line x1={lineX} y1="20" x2={lineX} y2={H - 38} stroke="var(--pass-hi)" strokeOpacity="0.55" strokeWidth="1.25" strokeDasharray="3 3" />
        <text x={lineX} y="15" fill="var(--pass-hi)" fontFamily="var(--font-geist-mono)" fontSize="11" textAnchor="middle" letterSpacing="0.05em">
          {thresholdPct.toFixed(2)}%
        </text>

        {/* axis ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xOf(t)} y1={H - 32} x2={xOf(t)} y2={H - 28} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            <text x={xOf(t)} y={H - 14} fill="var(--muted-foreground)" fontFamily="var(--font-geist-mono)" fontSize="10" textAnchor="middle">
              {t.toFixed(1)}%
            </text>
          </g>
        ))}

        {/* marks */}
        {marks.map((m, i) => (
          <circle
            key={i}
            cx={lit ? m.x : lineX}
            cy={m.y}
            r={m.clears ? 3.1 : 2.2}
            fill={m.clears ? 'var(--pass-hi)' : 'rgba(216,162,74,0.6)'}
            opacity={lit ? (m.clears ? 0.95 : 0.5) : 0}
            style={{
              transition: reduced
                ? 'none'
                : `cx 700ms cubic-bezier(.2,.7,.2,1) ${(i % 30) * 12}ms, opacity 500ms ease ${(i % 30) * 12}ms`,
            }}
          />
        ))}
      </svg>

      <div className="flex items-center gap-2.5 border-t border-line px-5 py-3.5">
        <span className="h-2 w-2 rounded-full bg-pass-hi shadow-[0_0_10px_var(--pass-hi)]" />
        <span className="font-mono text-[13px] tabular-nums text-foreground">
          {loading ? '—' : num.format(clears)}
        </span>
        <span className="text-[13px] text-muted-foreground">
          of {loading ? '—' : num.format(total)} clear the line
        </span>
      </div>
    </div>
  );
}
