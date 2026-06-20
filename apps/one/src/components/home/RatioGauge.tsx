'use client';

/**
 * The "line" motif at deal scale: the rule threshold drawn as a dashed line,
 * with a mark for this listing's rent/price ratio. Clears = emerald + halo;
 * below = amber. Ported from the prototype, parameterized by the resolved
 * threshold so it stays rule-aware (per property type / strategy), not a flat 1%.
 */
interface RatioGaugeProps {
  /** This listing's rent/price ratio, in percent (e.g. 1.12). */
  ratioPct: number | null;
  /** The applicable rule threshold, in percent. Defaults to 1.0. */
  thresholdPct?: number;
  width?: number;
  className?: string;
}

export function RatioGauge({ ratioPct, thresholdPct = 1.0, width = 96, className }: RatioGaugeProps) {
  const min = 0.4;
  const max = Math.max(1.4, thresholdPct + 0.3);
  const x = (v: number) =>
    ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (width - 8) + 4;
  const clears = ratioPct != null && ratioPct >= thresholdPct;
  const mark = clears ? '#0E9F6E' : '#A9761F';

  return (
    <svg
      width={width}
      height={26}
      viewBox={`0 0 ${width} 26`}
      aria-hidden
      className={className}
    >
      <line x1="4" y1="18" x2={width - 4} y2="18" stroke="rgba(23,32,51,0.14)" strokeWidth="1.5" />
      {/* the rule threshold line */}
      <line
        x1={x(thresholdPct)}
        y1="6"
        x2={x(thresholdPct)}
        y2="22"
        stroke="rgba(23,32,51,0.34)"
        strokeWidth="1.25"
        strokeDasharray="2 2"
      />
      {ratioPct != null && (
        <>
          <circle cx={x(ratioPct)} cy="18" r="4.5" fill={mark} />
          {clears && (
            <circle
              cx={x(ratioPct)}
              cy="18"
              r="8"
              fill="none"
              stroke={mark}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
          )}
        </>
      )}
    </svg>
  );
}
