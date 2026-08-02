'use client';
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * SSR-safe reduced-motion preference.
 *
 * This was copy-pasted as a raw matchMedia + useEffect block in five places
 * (CountUpRatio, MarketPulse, RatioTape, FirstDealHero, CompareTray) — five
 * listeners and five chances to drift apart.
 *
 * useSyncExternalStore returns the server snapshot (false) on the first client
 * render, so SSR and hydration agree and there is no flash, then live-updates
 * if the user flips the OS setting mid-session.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
