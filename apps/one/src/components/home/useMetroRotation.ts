'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export type Rotation = {
  index: number;
  order: number[];
  pinned: boolean;
  paused: boolean;
  setPaused(p: boolean): void;
  pin(): void;
  advance(): void;
};

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useMetroRotation(
  count: number,
  opts?: { intervalMs?: number; reduceMotion?: boolean }
): Rotation {
  const intervalMs = opts?.intervalMs ?? 6000;
  const reduceMotion = opts?.reduceMotion ?? false;
  const order = useMemo(() => shuffle(Math.max(1, count)), [count]);
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [paused, setPaused] = useState(false);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (count <= 1 || pinned || paused || reduceMotion) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % countRef.current);
    }, intervalMs);
    return () => clearInterval(t);
  }, [count, pinned, paused, reduceMotion, intervalMs]);

  return {
    index,
    order,
    pinned,
    paused,
    setPaused,
    pin: () => setPinned(true),
    advance: () => setIndex((i) => (i + 1) % Math.max(1, countRef.current)),
  };
}
