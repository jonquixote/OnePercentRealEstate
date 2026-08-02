'use client';
import { useState, type ReactNode, type FormEvent } from 'react';
// TYPE-ONLY import: lib/spotlight imports `pool`, so a runtime import here
// would pull pg into the browser bundle and fail the build.
import type { TourEntry } from '@/lib/spotlight';
import { useMetroRotation } from './useMetroRotation';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SpotlightCard } from './SpotlightCard';

interface Props {
  entries: TourEntry[];
  /** Index of the visitor's metro within `entries`, resolved on the server. */
  startIndex: number;
  /** Server-rendered first frame. */
  children: ReactNode;
}

/**
 * Rotation, hover/focus pause, and ZIP pinning — nothing else.
 *
 * The server-rendered child stays on screen until the first rotation tick or a
 * pin, so hydration never replaces real content with a skeleton. useMetroRotation
 * starts `index` at 0 and places `startIndex` first in `order`, so "the client
 * has taken over" is index !== 0.
 */
export function SpotlightRotator({ entries, startIndex, children }: Props) {
  const reduceMotion = useReducedMotion();
  const rot = useMetroRotation(entries.length, { reduceMotion, startIndex });
  const [pinned, setPinned] = useState<TourEntry | null>(null);
  const [tookOver, setTookOver] = useState(false);
  const [pinState, setPinState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [q, setQ] = useState('');

  if (!tookOver && !pinned && rot.index !== 0 && entries.length > 1) setTookOver(true);

  const current: TourEntry | null =
    pinned ?? (entries.length ? entries[rot.order[rot.index] % entries.length] : null);

  async function loadPinned(zip: string) {
    setPinState('loading');
    try {
      const res = await fetch(`/api/spotlight?zip=${encodeURIComponent(zip)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const e = (await res.json()) as { deal: unknown };
      if (!e.deal) { setPinState('error'); return; }
      setPinned(e as TourEntry);
      rot.pin();
      setPinState('idle');
    } catch {
      // The previous implementation console.error'd and reset silently, so the
      // tour carried on as if nothing had happened and the user never knew.
      setPinState('error');
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const zip = q.trim().match(/^\d{5}$/)?.[0];
    if (zip) void loadPinned(zip);
  }

  return (
    <div
      onMouseEnter={() => rot.setPaused(true)}
      onMouseLeave={() => rot.setPaused(false)}
      onFocusCapture={() => rot.setPaused(true)}
      onBlurCapture={() => rot.setPaused(false)}
    >
      <div aria-live={pinned ? 'polite' : 'off'}>
        {pinned || tookOver
          ? current && (
              <SpotlightCard
                key={`${current.metro.zip}${pinned ? '-pin' : ''}`}
                entry={current}
                animate
              />
            )
          : children}
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px]" style={{ color: 'var(--mute)' }}>
        {/* Plain text, not aria-live: announcing every 6s rotation would be
            hostile to screen readers. Only a user-initiated pin announces. */}
        <p>
          {pinned ? (
            <>
              Your pick ·{' '}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => { setPinned(null); setPinState('idle'); }}
              >
                resume tour
              </button>
            </>
          ) : (
            `Touring the markets${rot.paused || reduceMotion ? ' · paused' : ''} · ${current?.metro.label ?? ''}`
          )}
        </p>

        <form onSubmit={onSubmit} className="flex items-center gap-1.5">
          <label htmlFor="tour-zip" className="sr-only">Pin a ZIP code</label>
          <input
            id="tour-zip"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pin a ZIP"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            className="mat h-7 w-20 px-2 text-[12px]"
            style={{ color: 'var(--text)' }}
          />
          <button
            type="submit"
            disabled={pinState === 'loading'}
            className="h-7 rounded-[5px] px-2 text-[12px] font-medium"
            style={{ background: 'var(--ink-2)', color: 'var(--haze)' }}
          >
            {pinState === 'loading' ? '…' : 'Go'}
          </button>
        </form>
      </div>

      {pinState === 'error' && (
        <p role="alert" className="mt-1.5 text-[12px]" style={{ color: 'var(--haze)' }}>
          No live deal in that ZIP yet — the tour keeps rolling.
        </p>
      )}
    </div>
  );
}
