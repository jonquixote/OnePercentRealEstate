'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'oper:coach:search';

const STEPS = [
  {
    target: 'cards',
    title: 'The one number that matters',
    body: 'Each card shows rent ÷ price. Green means it clears the 1% line — the deal works.',
  },
  {
    target: 'map',
    title: 'See why an area prices as it does',
    body: 'Flip on Rent $/sqft in the map layers to shade every block by observed rent.',
  },
  {
    target: 'save',
    title: 'Save this search',
    body: 'Name it and we’ll email you when new deals match. Your searches live on the Shelf.',
  },
] as const;

interface Pos {
  top: number;
  left: number;
}

// One-time (per browser) 3-step coach marks for first /search visitors.
// Non-modal: no backdrop, so it never blocks input. Dismiss-all is always
// visible; after the 3rd step (or any dismiss) it never shows again.
export function FirstRunCoach() {
  const [step, setStep] = useState<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Coach marks show exactly once per browser. Read after mount so the
  // server and first client render both start at `null` (no hydration
  // mismatch); localStorage is only touched client-side.
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setStep(0);
    } catch {
      /* private mode — skip coaching */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setStep(null);
  };

  const place = (idx: number) => {
    const target = document.querySelector(`[data-coach="${STEPS[idx].target}"]`);
    const pop = popRef.current;
    const ph = pop?.offsetHeight ?? 130;
    const pw = pop?.offsetWidth ?? 300;
    if (!target || !pop) {
      setPos({ top: window.innerHeight - ph - 16, left: Math.max(8, (window.innerWidth - pw) / 2) });
      return;
    }
    const r = target.getBoundingClientRect();
    let top = r.bottom + 10;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 10);
    let left = r.left + Math.min(r.width / 2, 48);
    left = Math.min(Math.max(8, left), window.innerWidth - pw - 8);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (step === null) return;
    place(step);
    const onScroll = () => place(step);
    const onResize = () => place(step);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (step === null) return null;
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={`Tip ${step + 1} of ${STEPS.length}: ${s.title}`}
      className="fixed z-[55] w-[290px] rounded-xl border p-3.5 shadow-[var(--shadow-pop)]"
      style={{ top: pos?.top ?? 16, left: pos?.left ?? 16, background: 'var(--ink-panel)', borderColor: 'var(--line-hi)', color: 'var(--text)' }}
    >
      <p className="prov mb-1.5" style={{ color: 'var(--mute)' }}>
        tip {step + 1} of {STEPS.length}
      </p>
      <p className="text-[13px] font-semibold">{s.title}</p>
      <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--haze)' }}>
        {s.body}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={finish}
          className="text-[12px] font-medium hover:underline"
          style={{ color: 'var(--mute)' }}
        >
          Dismiss all
        </button>
        <button
          type="button"
          onClick={() => (isLast ? finish() : setStep(step + 1))}
          className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
          style={{ background: 'var(--pass)', color: 'var(--ink)' }}
        >
          {isLast ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  );
}
