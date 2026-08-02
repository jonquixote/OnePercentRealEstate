# Home Server-First Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home page render its proof — a real deal, real numbers — as server HTML at TTFB, instead of a skeleton that waits on seven client fetches.

**Architecture:** `apps/one/src/app/page.tsx` is 380 lines of `'use client'`, and **all twelve** home components are client components. Nothing streams, nothing is crawlable, and LCP waits on hydration plus `useStats` plus two `useEffect` fetches. This plan lifts data access into `lib/`, converts the page shell and the read-only sections to server components, and confines interactivity to small islands.

**Tech Stack:** Next 16 App Router (React Server Components), TypeScript, vitest, PostgreSQL 16.

## Global Constraints

- **`lib/spotlight.ts` will import `pool`.** Any *runtime* import of it from a `'use client'` file pulls `pg` into the browser bundle and fails the build. Client files must use `import type` only.
- **Geo comes from nginx-injected `x-geo-*` headers, never client input.** `snippets/geo-headers.conf` overwrites them precisely so a client cannot spoof its metro. Read geo only via `metroFromHeaders(await headers())`.
- **`headers()` is async in Next 16** — always `await headers()`.
- **Do not change what a number means.** This plan moves computation, never redefines it. `rent_price_ratio` is a generated column with a `price >= 10000` guard; treat it as read-only truth.
- **Reduced motion is honored across the codebase.** Any new animation must respect it; do not regress this.
- **Latency budgets in `docs/perf/perf-budgets.md` bind.** The home route has a budget; LCP target < 2.5 s on 4G.
- **Every new server function must be unit-tested against a mocked `pool`** — no test may hit the live database.

---

## Task 1: `useReducedMotion` — one implementation, four call sites

**Files:**
- Create: `apps/one/src/lib/useReducedMotion.ts`
- Create: `apps/one/src/lib/useReducedMotion.test.ts`
- Modify: `apps/one/src/components/home/FirstDealHero.tsx`, `MarketPulse.tsx`, `RatioTape.tsx`, `CountUpRatio.tsx`

**Interfaces:**
- Produces: `useReducedMotion(): boolean`

- [ ] **Step 1: Write the failing test.**

```ts
// apps/one/src/lib/useReducedMotion.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './useReducedMotion';

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches, media: q,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  return listeners;
}
afterEach(() => vi.unstubAllGlobals());

describe('useReducedMotion', () => {
  it('reports the OS preference', () => {
    mockMatchMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
  });

  it('reports false when motion is allowed', () => {
    mockMatchMedia(false);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it('removes its listener on unmount — four components mounting must not leak', () => {
    const listeners = mockMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

Run: `cd apps/one && npx vitest run src/lib/useReducedMotion.test.ts`
Expected: FAIL — cannot resolve `./useReducedMotion`.

- [ ] **Step 3: Implement it.**

```ts
// apps/one/src/lib/useReducedMotion.ts
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
 * This was copy-pasted as a raw matchMedia + useEffect block in four
 * components (FirstDealHero, MarketPulse, RatioTape, CountUpRatio), which meant
 * four listeners and four chances to drift. useSyncExternalStore gives the
 * server snapshot (false) on first render — so SSR and the client agree and
 * there is no hydration flash — then live-updates if the user flips the OS
 * setting mid-session.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
```

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5: Replace the four inline copies.** In each of `FirstDealHero.tsx`, `MarketPulse.tsx`, `RatioTape.tsx`, `CountUpRatio.tsx`: delete the local `matchMedia` state/effect and use `const reduceMotion = useReducedMotion();`.

Verify none remain:

```bash
grep -rn "prefers-reduced-motion" apps/one/src/components/ | grep -v useReducedMotion
```

Expected: no output.

- [ ] **Step 6: Run the whole home suite** — `cd apps/one && npx vitest run src/components/home` — expect PASS, then commit.

```bash
git add apps/one/src/lib/useReducedMotion.ts apps/one/src/lib/useReducedMotion.test.ts apps/one/src/components/home
git commit -m "refactor(home): one useReducedMotion hook, four call sites"
```

---

## Task 2: Lift spotlight data access into `lib/`

**Files:**
- Modify: `apps/one/src/lib/spotlight.ts`
- Create: `apps/one/src/lib/spotlight.test.ts`
- Modify: `apps/one/src/app/api/spotlight/route.ts`

**Interfaces:**
- Consumes: existing `buildSpotlightQuery(loc)`, `shapeSpotlight(row)`, `SpotlightEntry` in the same file.
- Produces:
  - `type TourEntry = SpotlightEntry & { deal: NonNullable<SpotlightEntry['deal']> }`
  - `spotlightFor(metro: Metro): Promise<SpotlightEntry>`
  - `getSpotlightTour(geoMetro: Metro): Promise<{ entries: TourEntry[]; startIndex: number }>`

- [ ] **Step 1: Write the failing test.** The parallel-fan-out case is the regression guard — the old route awaited inside a `for` loop, costing N × query latency.

```ts
// apps/one/src/lib/spotlight.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: h.query } }));
vi.mock('@/lib/metros', () => ({
  METROS: [
    { label: 'Houston', zip: '77002', lat: 29.76, lng: -95.37 },
    { label: 'Cleveland', zip: '44113', lat: 41.48, lng: -81.7 },
    { label: 'Tampa', zip: '33602', lat: 27.95, lng: -82.46 },
  ],
  metroByZip: (z: string) => null,
}));

const row = (addr: string) => ({
  id: '1', address: addr, listing_price: 90000, estimated_rent: 1200,
  rent_price_ratio: 0.0133, primary_photo: null, zip_code: '77002',
});

beforeEach(() => h.query.mockReset());

describe('getSpotlightTour', () => {
  it('fans out in PARALLEL — all queries start before any resolves', async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.query.mockImplementation(async () => {
      started += 1;
      await gate;
      return { rows: [row('1 Main St')] };
    });

    const { getSpotlightTour } = await import('./spotlight');
    const p = getSpotlightTour({ label: 'Houston', zip: '77002', lat: 29.76, lng: -95.37 } as never);
    await Promise.resolve();
    expect(started).toBe(3);   // serial loop would be 1
    release();
    await p;
  });

  it('computes startIndex against the FILTERED array', async () => {
    // Houston has no deal -> it is absent, so Cleveland becomes index 0.
    h.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [row('3 Bay St')] });

    const { getSpotlightTour } = await import('./spotlight');
    const { entries, startIndex } = await getSpotlightTour(
      { label: 'Cleveland', zip: '44113', lat: 41.48, lng: -81.7 } as never,
    );
    expect(entries).toHaveLength(2);
    expect(entries[startIndex].metro.zip).toBe('44113');
    expect(startIndex).toBe(0);
  });

  it('returns -1 when the visitor metro has no deal, and omits it', async () => {
    h.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [row('3 Bay St')] });

    const { getSpotlightTour } = await import('./spotlight');
    const { entries, startIndex } = await getSpotlightTour(
      { label: 'Houston', zip: '77002', lat: 29.76, lng: -95.37 } as never,
    );
    expect(startIndex).toBe(-1);
    expect(entries.some((e) => e.metro.zip === '77002')).toBe(false);
  });

  it('degrades one failing metro without losing the tour', async () => {
    h.query
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [row('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [row('3 Bay St')] });

    const { getSpotlightTour } = await import('./spotlight');
    const { entries } = await getSpotlightTour({ label: 'Tampa', zip: '33602', lat: 27.95, lng: -82.46 } as never);
    expect(entries).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `cd apps/one && npx vitest run src/lib/spotlight.test.ts`. Expected: FAIL, `getSpotlightTour` is not exported.

- [ ] **Step 3: Append the accessors to `lib/spotlight.ts`.**

```ts
import pool from '@/lib/db';
import { METROS, type Metro } from '@/lib/metros';

// ---------------------------------------------------------------------------
// Server-side accessors.
//
// buildSpotlightQuery/shapeSpotlight were pure, but EXECUTION lived inside the
// /api/spotlight route — so a server component had to HTTP-fetch an API route
// on its own box to get data it could query directly. These lift execution and
// caching into lib so the route (ZIP pinning) and the hero (first paint) share
// one code path, one cache, and one definition of "best deal in a metro".
// ---------------------------------------------------------------------------

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; body: SpotlightEntry }>();

export async function spotlightFor(metro: Metro): Promise<SpotlightEntry> {
  const hit = cache.get(metro.zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  try {
    const { sql, params } = buildSpotlightQuery({ zip: metro.zip, lat: metro.lat, lng: metro.lng });
    const res = await pool.query(sql, params);
    const deal = res.rows[0] ? shapeSpotlight(res.rows[0]) : null;
    const body: SpotlightEntry = { metro: { label: metro.label, zip: metro.zip }, deal };
    cache.set(metro.zip, { at: Date.now(), body });
    return body;
  } catch (err) {
    // One metro failing must not take down the tour.
    console.error('spotlightFor error:', metro.zip, err);
    return { metro: { label: metro.label, zip: metro.zip }, deal: null };
  }
}

/** A SpotlightEntry narrowed so `deal` is non-null — removes every `deal!`. */
export type TourEntry = SpotlightEntry & { deal: NonNullable<SpotlightEntry['deal']> };

/**
 * Every metro with a live line-clearing deal, plus where the visitor's metro
 * sits in that FILTERED list.
 *
 * Two deliberate changes from the old `?all=1` path:
 *  1. Promise.all instead of `for (…) await` — a cold tour cost N × latency.
 *  2. startIndex computed here, against the same array the caller renders. The
 *     client used to compute it after a second fetch resolved, so the tour
 *     started on the wrong metro and visibly jumped.
 */
export async function getSpotlightTour(geoMetro: Metro): Promise<{
  entries: TourEntry[];
  startIndex: number;
}> {
  const results = await Promise.all(METROS.map(spotlightFor));
  const entries = results.filter((e): e is TourEntry => e.deal !== null);
  return { entries, startIndex: entries.findIndex((e) => e.metro.zip === geoMetro.zip) };
}
```

- [ ] **Step 4: Run the test — expect PASS (4/4).**

- [ ] **Step 5: Slim the route to a single-ZIP shim.** In `apps/one/src/app/api/spotlight/route.ts`, delete the local cache and `spotlightFor`, delete the `?all=1` branch, and import `spotlightFor` from `@/lib/spotlight`. Keep `resolveLoc` and the geo fallback exactly as-is.

- [ ] **Step 6: Verify no caller still uses `?all=1`.**

```bash
grep -rn "all=1" apps/one/src | grep -i spotlight
```

Expected: no output (Task 4 removes the last consumer; if `FirstDealHero.tsx` still matches, that is expected until then — note it and continue).

- [ ] **Step 7: Commit.**

```bash
git add apps/one/src/lib/spotlight.ts apps/one/src/lib/spotlight.test.ts apps/one/src/app/api/spotlight/route.ts
git commit -m "refactor(home): lift spotlight execution into lib, parallel tour fan-out"
```

---

## Task 3: `SpotlightCard` — one card, rendered by both server and client

**Files:**
- Create: `apps/one/src/components/home/SpotlightCard.tsx`

**Interfaces:**
- Consumes: `TourEntry` from Task 2 (type-only import).
- Produces: `<SpotlightCard entry={TourEntry} priority?: boolean animate?: boolean />`

- [ ] **Step 1: Create the shared presentational card.** No `'use client'` — it must render in both contexts, so the server first frame and client frames are byte-identical and swapping them causes no layout shift.

```tsx
// apps/one/src/components/home/SpotlightCard.tsx
import Link from 'next/link';
import Image from 'next/image';
import type { TourEntry } from '@/lib/spotlight';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  entry: TourEntry;
  /** True only for the server-rendered first frame — it is the LCP candidate. */
  priority?: boolean;
  /** Client frames crossfade; the server frame must not. */
  animate?: boolean;
}

export function SpotlightCard({ entry, priority = false, animate = false }: Props) {
  const { deal, metro } = entry;
  return (
    <article
      className={`mat overflow-hidden p-0 ${animate ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500' : ''}`}
      aria-label={`Best deal in ${metro.label}: ${deal.address}`}
    >
      <div className="relative aspect-[16/10]">
        {deal.primary_photo ? (
          <Image
            src={deal.primary_photo}
            alt={deal.address}
            fill
            priority={priority}
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 480px"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'var(--ink-2)' }} />
        )}
        <div
          className="absolute left-4 top-4 rounded-[6px] px-3 py-1.5 backdrop-blur"
          style={{ background: 'color-mix(in srgb, var(--ink) 78%, transparent)' }}
        >
          <span className="prov" style={{ color: 'var(--pass-hi)' }}>Clears the line</span>
          <div className="figure figure--pass text-2xl leading-tight tabular-nums">{pct.format(deal.ratio)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium" style={{ color: 'var(--text)' }}>{deal.address}</p>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--mute)' }}>
            {usd0.format(deal.listing_price)} · est. rent {usd0.format(deal.estimated_rent)}/mo
          </p>
        </div>
        <Link
          href={`/property/${deal.id}`}
          className="inline-flex h-9 shrink-0 items-center rounded-[6px] px-3.5 text-[13px] font-semibold"
          style={{ background: 'var(--brass)', color: 'var(--ink)' }}
        >
          See the math →
        </Link>
      </div>
    </article>
  );
}
```

**Note the CTA target:** the attached proposal linked to `/search?q=<zip>`. This links to `/property/<id>` instead — the whole claim is that we did the analysis on *this* property, so the click should land on that analysis, not a filtered list.

- [ ] **Step 2: Typecheck.** Run `cd apps/one && npx tsc --noEmit -p tsconfig.json`. Expected: exit 0. Commit.

```bash
git add apps/one/src/components/home/SpotlightCard.tsx
git commit -m "feat(home): shared SpotlightCard for server + client frames"
```

---

## Task 4: `SpotlightRotator` — the only client code in the hero

**Files:**
- Create: `apps/one/src/components/home/SpotlightRotator.tsx`
- Create: `apps/one/src/components/home/SpotlightRotator.test.tsx`
- Delete: `apps/one/src/components/home/FirstDealHero.tsx`, `FirstDealHero.test.tsx`

**Interfaces:**
- Consumes: `TourEntry` (type-only), `useMetroRotation(count, opts)`, `useReducedMotion()`, `SpotlightCard`.
- Produces: `<SpotlightRotator entries={TourEntry[]} startIndex={number}>{serverFirstFrame}</SpotlightRotator>`

- [ ] **Step 1: Write the failing test.**

```tsx
// apps/one/src/components/home/SpotlightRotator.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpotlightRotator } from './SpotlightRotator';

const entry = (zip: string, label: string) => ({
  metro: { label, zip },
  deal: { id: '9', address: `${zip} Main St`, listing_price: 90000, estimated_rent: 1200, ratio: 0.0133, primary_photo: null, zip },
}) as never;

beforeEach(() => vi.restoreAllMocks());

describe('SpotlightRotator', () => {
  it('renders the server first frame until the client takes over', () => {
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div data-testid="server-frame">server</div>
      </SpotlightRotator>,
    );
    expect(screen.getByTestId('server-frame')).toBeTruthy();
  });

  it('shows a visible alert when a pinned ZIP has no deal — never a silent failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ metro: { label: 'X', zip: '00000' }, deal: null }),
    }));
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '00000' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('surfaces a network failure as an alert too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '44113' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('ignores a non-5-digit ZIP without fetching', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '12' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — module not found.

- [ ] **Step 3: Implement the rotator.**

```tsx
// apps/one/src/components/home/SpotlightRotator.tsx
'use client';
import { useState, type ReactNode, type FormEvent } from 'react';
import type { TourEntry } from '@/lib/spotlight';   // type-only: keeps `pg` out of the bundle
import { useMetroRotation } from './useMetroRotation';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SpotlightCard } from './SpotlightCard';

interface Props {
  entries: TourEntry[];
  startIndex: number;
  children: ReactNode; // server-rendered first frame
}

/**
 * Rotation, hover/focus pause, and ZIP pinning — nothing else.
 *
 * The server-rendered child stays on screen until the first tick or a pin, so
 * hydration never replaces real content with a skeleton.
 */
export function SpotlightRotator({ entries, startIndex, children }: Props) {
  const reduceMotion = useReducedMotion();
  const rot = useMetroRotation(entries.length, { reduceMotion, startIndex });
  const [pinned, setPinned] = useState<TourEntry | null>(null);
  const [tookOver, setTookOver] = useState(false);
  const [pinState, setPinState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [q, setQ] = useState('');

  if (!tookOver && !pinned && rot.index !== startIndex && entries.length > 1) setTookOver(true);

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
      // user saw the tour carry on as if nothing had happened.
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
          ? current && <SpotlightCard key={`${current.metro.zip}${pinned ? '-pin' : ''}`} entry={current} animate />
          : children}
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px]" style={{ color: 'var(--mute)' }}>
        <p>
          {pinned ? (
            <>Your pick · <button className="underline underline-offset-2" onClick={() => { setPinned(null); setPinState('idle'); }}>resume tour</button></>
          ) : (
            `Touring the markets${rot.paused || reduceMotion ? ' · paused' : ''} · ${current?.metro.label ?? ''}`
          )}
        </p>
        <form onSubmit={onSubmit} className="flex items-center gap-1.5">
          <label htmlFor="tour-zip" className="sr-only">Pin a ZIP code</label>
          <input
            id="tour-zip" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Pin a ZIP" inputMode="numeric" autoComplete="postal-code" maxLength={5}
            className="mat h-7 w-20 px-2 text-[12px]" style={{ color: 'var(--text)' }}
          />
          <button type="submit" disabled={pinState === 'loading'}
            className="h-7 rounded-[5px] px-2 text-[12px] font-medium"
            style={{ background: 'var(--ink-2)', color: 'var(--haze)' }}>
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
```

**Two bugs from the attached proposal are fixed here:** its blur handler called `rot.setBlurCapture?.(false)` (no such method — the pause would never release), and its `RotatorCardBody` returned `null as never`, which renders nothing. This uses `SpotlightCard` for every frame instead.

- [ ] **Step 4: Run the test — expect PASS (4/4).**

- [ ] **Step 5: Delete `FirstDealHero.tsx` and `FirstDealHero.test.tsx`**, and remove its import/usage from `apps/one/src/app/page.tsx`. Confirm nothing references it:

```bash
grep -rn "FirstDealHero" apps/one/src
```

Expected: no output.

- [ ] **Step 6: Commit.**

```bash
git add -A apps/one/src/components/home apps/one/src/app/page.tsx
git commit -m "feat(home): SpotlightRotator client island; retire FirstDealHero"
```

---

## Task 5: The merged server hero

**Files:**
- Create: `apps/one/src/components/home/HeroSection.tsx`
- Delete: `apps/one/src/components/home/HomeHero.tsx`

**Interfaces:**
- Consumes: `getSpotlightTour`, `metroFromHeaders`, `SpotlightCard`, `SpotlightRotator`, `GlobalSearch` (already accepts `variant="hero"`).
- Produces: `<HeroSection stats={StatsPayload | null} priceCuts={number|undefined} medianRent={number|null|undefined} />`

There were two competing first impressions — `HomeHero` (headline + ticker + search) and `FirstDealHero` (rotating spotlight with its *own* ZIP box), the latter sitting second-to-last on the page below the entire tool. The strongest proof asset was below the fold. This merges them: claim on the left, live proof on the right.

- [ ] **Step 1: Create the server hero.**

```tsx
// apps/one/src/components/home/HeroSection.tsx
// Server component. The only client islands are GlobalSearch and SpotlightRotator.
import { headers } from 'next/headers';
import Link from 'next/link';
import GlobalSearch from '@/components/GlobalSearch';
import { getSpotlightTour } from '@/lib/spotlight';
import { metroFromHeaders } from '@/lib/geo';
import type { StatsPayload } from '@/lib/stats-compute';
import { SpotlightCard } from './SpotlightCard';
import { SpotlightRotator } from './SpotlightRotator';

const num = new Intl.NumberFormat('en-US');
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Props {
  stats: StatsPayload | null;
  priceCuts?: number;
  medianRent?: number | null;
}

export async function HeroSection({ stats, priceCuts, medianRent }: Props) {
  // headers() is async in Next 16. Geo is nginx-injected and spoof-proof.
  const geo = metroFromHeaders(await headers());
  const { entries, startIndex } = await getSpotlightTour(geo);
  const idx = startIndex >= 0 ? startIndex : 0;
  const first = entries[idx] ?? null;

  return (
    <section aria-labelledby="hero-headline" className="relative isolate overflow-hidden bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
        <p className="prov mb-4 inline-block">
          {stats ? num.format(stats.total) : '—'} listings · rescored nightly
          {stats?.lastUpdated && <> · last run {new Date(stats.lastUpdated).toLocaleString('en-US', {
            hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short',
          })}</>}
        </p>

        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 id="hero-headline" className="text-balance"
                style={{ font: '300 var(--display-1)/1.04 var(--font-display)' }}>
              Every property in America,<br />
              <em style={{ fontStyle: 'italic', color: 'var(--pass-hi)' }}>measured against the line.</em>
            </h1>

            <div className="rule-line mt-8" />

            <div className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
              <span><b className="figure" style={{ color: 'var(--text)' }}>{stats ? num.format(stats.onePercentPasses) : '—'}</b> clear the line</span>
              <span><b className="figure" style={{ color: 'var(--brass-hi)' }}>{priceCuts != null ? num.format(priceCuts) : '—'}</b> price cuts live</span>
              <span><b className="figure" style={{ color: 'var(--text)' }}>{medianRent != null ? usd0.format(medianRent) : '—'}</b> median rent estimate</span>
            </div>

            <div className="mt-8"><GlobalSearch variant="hero" /></div>

            <div className="mt-4 flex items-center gap-4">
              <Link href="#opportunities"
                className="inline-flex h-11 items-center rounded-[6px] px-5 text-[14px] font-semibold"
                style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
                See deals {first ? `in ${first.metro.label}` : 'near you'} →
              </Link>
              <Link href="/the-1-percent-index" className="text-[13px]" style={{ color: 'var(--haze)' }}>
                How the line works
              </Link>
            </div>
          </div>

          <div className="lg:pt-6">
            {first ? (
              <SpotlightRotator entries={entries} startIndex={idx}>
                <SpotlightCard entry={first} priority />
              </SpotlightRotator>
            ) : (
              <div className="rounded-2xl border border-dashed p-10 text-center"
                   style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}>
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Tonight&apos;s deals are being scored</p>
                <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>The tour resumes when rent estimates complete.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
```

**The provenance timestamp is free:** `StatsPayload.lastUpdated` already exists (`apps/one/src/lib/stats-compute.ts:34`). The attached proposal assumed it had to be added.

- [ ] **Step 2: Typecheck** — `cd apps/one && npx tsc --noEmit -p tsconfig.json`, expect exit 0.

- [ ] **Step 3: Delete `HomeHero.tsx`** and confirm no references remain:

```bash
grep -rn "HomeHero" apps/one/src
```

Expected: no output.

- [ ] **Step 4: Commit.**

```bash
git add -A apps/one/src/components/home
git commit -m "feat(home): merged server hero — claim left, live proof right"
```

---

## Task 6: Server `page.tsx` + `OpportunitiesTool`

**Files:**
- Modify: `apps/one/src/app/page.tsx`
- Create: `apps/one/src/components/home/OpportunitiesTool.tsx`

**Interfaces:**
- Consumes: `HeroSection`, existing `FeaturedDeals`, `MarketPulse`, `MarketsGrid`, `ReducedRail`, `RentHeatTeaser`.
- Produces: `<OpportunitiesTool strategy={string} />`

**The one behavioural decision:** `nuqs` URL state drives `strategy`, which drives `useStats`. Moving stats server-side means strategy must become a real navigation (`router.replace` non-shallow) so the server re-renders per strategy. That is the semantically correct behavior anyway — shareable per-strategy URLs, SSR per lens, one source of truth. **Confirm with the product owner before starting**, because it is the only user-visible change in this plan.

- [ ] **Step 1: Extract the tool.** Move everything from the `"The tool · {strategy}"` heading downward — `nuqs` filter state, `getProperties` pagination, the dynamic `PropertyMap` import, compare tray, toasts — into `OpportunitiesTool.tsx` with `'use client'` at the top. It receives `strategy` as a prop. Wrap it in `<div id="opportunities">` so the hero CTA anchor resolves.

- [ ] **Step 2: Convert `page.tsx` to a server component.** Remove `'use client'`. Read `strategy` from `searchParams`. Fetch in one `Promise.all` — no waterfalls:

```tsx
export default async function Home({ searchParams }: { searchParams: Promise<{ strat?: string }> }) {
  const { strat } = await searchParams;
  const strategy = STRATEGY_WHITELIST.has(strat ?? '') ? strat! : 'buy_hold';
  const [stats, priceCuts, medianRent] = await Promise.all([
    getStats(strategy),          // lifted from useStats — see Step 3
    getPriceCuts(),              // replaces the /api/stats/cuts useEffect
    getMedianRent(),             // replaces the /api/stats/median-rent useEffect
  ]);
  return (
    <>
      <HeroSection stats={stats} priceCuts={priceCuts} medianRent={medianRent} />
      <FeaturedDeals strategy={strategy} rentCalcPending={stats?.rentCalcPending ?? 0} />
      {/* …existing sections… */}
      <div id="opportunities"><OpportunitiesTool strategy={strategy} /></div>
    </>
  );
}
```

- [ ] **Step 3: Lift the three fetches into server functions.** `useStats` currently hits an API route; add `getStats(strategy)` to `apps/one/src/lib/stats-compute.ts` calling the same query directly, and `getPriceCuts()` / `getMedianRent()` alongside. Same pattern as Task 2 — no HTTP round-trip to our own box.

- [ ] **Step 4: Verify the client bundle shrank.**

```bash
cd apps/one && npx next build 2>&1 | grep -A3 "Route (app)" | head -8
```

Record the `/` First Load JS before and after. The map, filters and compare logic should now only load inside `OpportunitiesTool`.

- [ ] **Step 5: Verify server HTML contains a real listing** — the whole point:

```bash
curl -s http://127.0.0.1:3001 | grep -c "Clears the line"
```

Expected: ≥ 1. Previously 0, because the card only existed after hydration.

- [ ] **Step 6: Commit.**

```bash
git add apps/one/src/app/page.tsx apps/one/src/components/home/OpportunitiesTool.tsx apps/one/src/lib/stats-compute.ts
git commit -m "refactor(home): server page shell, client tool island"
```

---

## Task 7: Structural loading skeleton

**Files:**
- Create: `apps/one/src/components/home/HeroSkeleton.tsx`
- Modify: `apps/one/src/app/loading.tsx`

`loading.tsx` is currently a full-screen spinner. Once the page streams, that spinner would replace real content with nothing.

- [ ] **Step 1: Create `HeroSkeleton`** mirroring `HeroSection`'s geometry exactly — same `max-w-6xl px-6 py-10 lg:py-14`, same `lg:grid-cols-[1.1fr_1fr]`, same `aspect-[16/10]` photo block with the ratio badge ghosted at `left-4 top-4`. Use `motion-safe:animate-pulse` (not bare `animate-pulse`) so reduced-motion users get a still skeleton. Mark the section `aria-hidden` and add one `<span className="sr-only" role="status">Loading deals</span>`.

- [ ] **Step 2: Replace `loading.tsx`** to render `<HeroSkeleton />` plus three section-divider blocks.

- [ ] **Step 3: Measure CLS.** Run Lighthouse against `/` and record CLS; a geometry-mirroring skeleton should keep it under 0.05. If it is higher, the skeleton geometry does not match — fix the skeleton, not the hero.

- [ ] **Step 4: Commit.**

```bash
git add apps/one/src/components/home/HeroSkeleton.tsx apps/one/src/app/loading.tsx
git commit -m "feat(home): geometry-mirroring hero skeleton"
```

---

## Self-Review

**Spec coverage:** every technical item in the attached review is covered — reduced-motion duplication (T1), serial spotlight loop and client fetching (T2), silent pin failure (T4), merged heroes (T5), client monolith and the two `useEffect` fetches (T6), full-screen spinner (T7). Three of its claims were checked and corrected: `stats.lastUpdated` already exists, its rotator called a non-existent `setBlurCapture`, and its `RotatorCardBody` returned `null as never`.

**Placeholder scan:** every step names exact files, complete code, runnable commands and expected output. The single deliberate open decision — strategy-as-navigation — is called out in Task 6 with instructions to confirm first, because it is the only user-visible behavior change.

**Type consistency:** `TourEntry` is defined once in Task 2 and consumed by name in Tasks 3–5. `SpotlightCard` keeps one prop shape (`entry`, `priority`, `animate`) across server and client. `getSpotlightTour` returns `{ entries, startIndex }` everywhere.

**Deliberately not included:** anything that changes what a number *means*. This plan is pure delivery-mechanism work; the product substance is `2026-08-03-underwriting-proof.md`.
