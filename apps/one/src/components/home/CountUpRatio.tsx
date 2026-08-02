'use client';
import { useEffect, useState } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';

const pct = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CountUpRatio({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  // Read the preference through the shared hook rather than a one-shot
  // matchMedia check inside the effect: this way flipping the OS setting
  // mid-session re-runs the effect and stops the animation immediately.
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setShown(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, reduce]);
  return <span className="figure figure--pass tabular-nums">{pct.format(shown)}</span>;
}
