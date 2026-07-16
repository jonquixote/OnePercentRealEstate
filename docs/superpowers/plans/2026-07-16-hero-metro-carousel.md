# Hero Metro Carousel — Deal Reveal 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bottom-of-homepage `FirstDealHero` into a living metro carousel: the headline sets the city name in *Fraunces italic brass*, and every ~6 seconds the city, the deal photo, and the figures crossfade to another metro's best live deal — pausing on hover/focus, pinning when the visitor types a ZIP, and standing perfectly still under reduced motion.

**Architecture:** One new query-param branch on the existing `/api/spotlight` route (`?all=1`) returns the best deal for **all 8 canonical metros** in a single response (each metro served from the route's existing per-metro TTL cache). The client rotation lives in a small testable hook (`useMetroRotation`) that owns the shuffled order, the 6s timer, and the pause/pin/reduced-motion rules; `FirstDealHero` becomes a consumer that renders whichever metro is current inside a fixed-box crossfade shell (zero CLS). The typed-ZIP flow keeps today's in-place reveal but *pins* the carousel.

**Tech Stack:** Next 16 App Router (apps/one), React client components, existing `/api/spotlight` route + `buildSpotlightQuery` (`apps/one/src/lib/spotlight.ts`), `METROS` (`apps/one/src/lib/metros.ts`), Fraunces via the `font-serif` layout font, eggshell "line" tokens (`apps/one/src/app/globals.css`), Vitest + @testing-library/react (jsdom pragma per test file, already configured).

## Global Constraints

- **Design language:** eggshell "line" motif only — tokens `--ink`, `--ink-2`, `--pass`, `--brass`, `--line`, `--text`, `--mute`; utility classes `.figure`, `.prov`, `.mat`. **No new colors.** The italic city is `var(--brass)`.
- **Ratio is a fraction in the domain layer, a percent only at render** (`Spotlight.ratio` stays a fraction; `CountUpRatio` renders it).
- **Reduced motion:** under `prefers-reduced-motion: reduce` there is **no auto-rotation and no transition animation** — the hero shows one static metro (the first) and typed-ZIP swaps instantly.
- **Zero CLS:** the card box dimensions never change across rotations (photo `aspect-[4/3]`, same grid). The rotating headline reserves its line-height.
- **No-JS fallback preserved:** the form keeps `action="/search"` with `preventDefault` in JS.
- **Single CTA** (`See more like this →`) pointing at the *current* metro's search.
- **Server is the trust boundary:** `?all=1` takes no user input beyond the flag; the per-metro queries reuse the existing parameterized builder. LIMIT/bounds stay server constants.
- **Auto-rotation must not spam screen readers:** the rotating region is `aria-live="off"`; only user-initiated (typed-ZIP) updates may announce (`aria-live="polite"` on the pinned reveal message only).
- **Tests:** Vitest colocated; run one file with `pnpm --filter @oper/one test <path>`. TSX test files start with `// @vitest-environment jsdom` (existing convention).

## Current State (verified 2026-07-16 on origin/main 6e6911b)

- `FirstDealHero` (`apps/one/src/components/home/FirstDealHero.tsx`, 114 lines) sits at the **bottom** of `apps/one/src/app/page.tsx` (line ~352); the restored editorial `HomeHero` owns the top. FirstDealHero still renders an `<h1 id="hero-h">` — a **duplicate h1** now that it's not the page lead; this plan demotes it to `<h2>`.
- `/api/spotlight` returns `{ metro: {label, zip}, deal: Spotlight | null }` for one metro, with a 5-min in-process cache keyed by metro zip. `Spotlight` includes `zip` of the deal itself (CTA uses `deal.zip || metroZip`).
- `METROS` exports 8 metros `{slug, label, zip, lat, lng}`; `DEFAULT_METRO` = Houston.
- Layout loads **Fraunces** as the serif variable font (`font-serif` in Tailwind maps to it) — its italic is the typographic centerpiece here.
- Deployed spotlight bounds: price ≥ 30k, ratio ∈ [0.01, 0.05]; partial index `idx_listings_spotlight` in place. A warm per-metro response is instant; a cold one is ~1s.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/app/api/spotlight/route.ts` (modify) | Add the `?all=1` branch: all 8 metros through the same per-metro cache; response `{ metros: SpotlightEntry[] }`. |
| `apps/one/src/lib/spotlight.ts` (modify) | Export `type SpotlightEntry = { metro: { label: string; zip: string }; deal: Spotlight | null }` (shared by route + hero). |
| `apps/one/src/components/home/useMetroRotation.ts` (create) | The rotation brain: shuffled order, 6s timer, pause/pin/reduced-motion. Pure React hook, fake-timer testable. |
| `apps/one/src/components/home/useMetroRotation.test.ts` (create) | Hook tests (rotation, pause, pin, reduced-motion). |
| `apps/one/src/components/home/FirstDealHero.tsx` (rewrite) | Consume `?all=1` + hook; italic city; crossfade shell; h1→h2; polish. |
| `apps/one/src/components/home/FirstDealHero.test.tsx` (modify) | Update for the carousel (initial render, rotation advance, typed-ZIP pin). |

---

## Task 1: `?all=1` on `/api/spotlight`

**Files:**
- Modify: `apps/one/src/lib/spotlight.ts` (add `SpotlightEntry` type export)
- Modify: `apps/one/src/app/api/spotlight/route.ts`
- Modify: `apps/one/src/app/api/spotlight/route.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `buildSpotlightQuery`, `shapeSpotlight`, `METROS`, per-metro `cache`.
- Produces: `GET /api/spotlight?all=1` → `{ metros: SpotlightEntry[] }` where `SpotlightEntry = { metro: { label: string; zip: string }; deal: Spotlight | null }`, ordered as `METROS`. Single-metro behavior unchanged.

- [ ] **Step 1: Write the failing test** (append to `route.test.ts`; the DB is mocked at the pool boundary exactly like the existing single-metro tests — follow the file's existing mock pattern; if the existing tests only cover `resolveLoc`, add the pool mock via `vi.mock('@/lib/db', ...)` returning one fake row per query call)

```ts
// append to apps/one/src/app/api/spotlight/route.test.ts
describe('GET ?all=1', () => {
  it('returns one entry per canonical metro, in METROS order', async () => {
    const { GET } = await import('./route');
    const { METROS } = await import('@/lib/metros');
    const req = new NextRequest('http://x/api/spotlight?all=1');
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.metros)).toBe(true);
    expect(body.metros).toHaveLength(METROS.length);
    expect(body.metros.map((m: { metro: { zip: string } }) => m.metro.zip))
      .toEqual(METROS.map((m) => m.zip));
    // each entry carries the single-metro response shape
    for (const entry of body.metros) {
      expect(entry.metro.label).toBeTruthy();
      expect('deal' in entry).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/app/api/spotlight/route.test.ts`
Expected: FAIL — `body.metros` undefined.

- [ ] **Step 3: Implement**

In `apps/one/src/lib/spotlight.ts`, add next to `Spotlight`:

```ts
export type SpotlightEntry = {
  metro: { label: string; zip: string };
  deal: Spotlight | null;
};
```

In `route.ts`, extract today's per-metro body construction into a helper and add the branch at the top of `GET`:

```ts
import { METROS, metroByZip, type Metro } from '@/lib/metros';
import type { SpotlightEntry } from '@/lib/spotlight';

async function spotlightFor(metro: Metro): Promise<SpotlightEntry> {
  const hit = cache.get(metro.zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body as SpotlightEntry;
  try {
    const { sql, params } = buildSpotlightQuery({ zip: metro.zip, lat: metro.lat, lng: metro.lng });
    const res = await pool.query(sql, params);
    const deal = res.rows[0] ? shapeSpotlight(res.rows[0], metro.zip) : null;
    const body: SpotlightEntry = { metro: { label: metro.label, zip: metro.zip }, deal };
    cache.set(metro.zip, { at: Date.now(), body });
    return body;
  } catch (err) {
    console.error('/api/spotlight error:', err);
    return { metro: { label: metro.label, zip: metro.zip }, deal: null };
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('all') === '1') {
    // Sequential on purpose: each miss is ~1s of DB work; warm entries are
    // cache hits. 8 serial queries worst-case ≈ 8s once per 5 minutes,
    // and it never fans out 8 concurrent heavy queries onto the pool.
    const metros: SpotlightEntry[] = [];
    for (const m of METROS) metros.push(await spotlightFor(m));
    return NextResponse.json({ metros });
  }
  const { metro } = resolveLoc(req.nextUrl.searchParams, req.headers);
  return NextResponse.json(await spotlightFor(metro));
}
```

(The single-metro path now flows through `spotlightFor` too — same cache, same body shape, less duplication. Delete the old inline body of `GET` that this replaces. Keep `resolveLoc` exported and untouched.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/app/api/spotlight/route.test.ts`
Expected: PASS (existing cases + the new `?all=1` case).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/spotlight.ts apps/one/src/app/api/spotlight/route.ts apps/one/src/app/api/spotlight/route.test.ts
git commit -m "feat(home): /api/spotlight?all=1 — all 8 metro deals in one response"
```

---

## Task 2: `useMetroRotation` — the carousel brain

**Files:**
- Create: `apps/one/src/components/home/useMetroRotation.ts`
- Test: `apps/one/src/components/home/useMetroRotation.test.ts`

**Interfaces:**
- Produces:

```ts
type Rotation = {
  index: number;           // current position in `order`
  order: number[];         // shuffled indices into the entries array
  pinned: boolean;         // typed-ZIP pin — rotation stopped for good
  paused: boolean;         // transient pause (hover/focus)
  setPaused(p: boolean): void;
  pin(): void;             // stop rotating permanently (typed ZIP)
  advance(): void;         // manual advance (also used by the timer)
};
useMetroRotation(count: number, opts?: { intervalMs?: number; reduceMotion?: boolean }): Rotation
```

- Rules: rotation starts only when `count > 1`, not pinned, not paused, and not `reduceMotion`. The order is a Fisher-Yates shuffle of `[0..count-1]` computed once per mount. `advance()` walks the shuffled order cyclically. `intervalMs` defaults to 6000.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/components/home/useMetroRotation.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMetroRotation } from './useMetroRotation';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useMetroRotation', () => {
  it('advances through a shuffled order on the interval', () => {
    const { result } = renderHook(() => useMetroRotation(4, { intervalMs: 6000 }));
    const seen = [result.current.order[result.current.index]];
    act(() => { vi.advanceTimersByTime(6000); });
    seen.push(result.current.order[result.current.index]);
    act(() => { vi.advanceTimersByTime(6000); });
    seen.push(result.current.order[result.current.index]);
    // three distinct entries so far (order is a permutation, no repeats in a cycle)
    expect(new Set(seen).size).toBe(3);
    // order is a permutation of 0..3
    expect([...result.current.order].sort()).toEqual([0, 1, 2, 3]);
  });
  it('does not rotate while paused, resumes after', () => {
    const { result } = renderHook(() => useMetroRotation(3));
    const before = result.current.index;
    act(() => { result.current.setPaused(true); });
    act(() => { vi.advanceTimersByTime(20000); });
    expect(result.current.index).toBe(before);
    act(() => { result.current.setPaused(false); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.index).not.toBe(before);
  });
  it('pin() stops rotation permanently', () => {
    const { result } = renderHook(() => useMetroRotation(3));
    act(() => { result.current.pin(); });
    const at = result.current.index;
    act(() => { vi.advanceTimersByTime(60000); });
    expect(result.current.index).toBe(at);
    expect(result.current.pinned).toBe(true);
  });
  it('never rotates under reduced motion or with a single entry', () => {
    const rm = renderHook(() => useMetroRotation(3, { reduceMotion: true }));
    const single = renderHook(() => useMetroRotation(1));
    act(() => { vi.advanceTimersByTime(30000); });
    expect(rm.result.current.index).toBe(0);
    expect(single.result.current.index).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/home/useMetroRotation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/components/home/useMetroRotation.ts
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
  opts?: { intervalMs?: number; reduceMotion?: boolean },
): Rotation {
  const intervalMs = opts?.intervalMs ?? 6000;
  const reduceMotion = opts?.reduceMotion ?? false;
  // One shuffle per mount: "random metro" order, but stable during the visit.
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/components/home/useMetroRotation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/components/home/useMetroRotation.ts apps/one/src/components/home/useMetroRotation.test.ts
git commit -m "feat(home): useMetroRotation — shuffled 6s carousel brain (pause/pin/reduced-motion)"
```

---

## Task 3: Rewrite `FirstDealHero` — italic city, crossfade, pin

**Files:**
- Rewrite: `apps/one/src/components/home/FirstDealHero.tsx`
- Modify: `apps/one/src/components/home/FirstDealHero.test.tsx`

**Interfaces:**
- Consumes: `?all=1` response (`SpotlightEntry[]`, Task 1), `useMetroRotation` (Task 2), `CountUpRatio` (existing).
- Produces: same export `FirstDealHero()` with no required props (page.tsx mount unchanged).

**Design decisions locked here:**
- Headline becomes `<h2>` (the editorial hero owns the page's h1): *"The best cash-flowing property in **<em>Houston</em>**, right now."* — the city in `font-serif italic` at `var(--brass)`, the surrounding copy stays the sans roman. The `<em>` carries `key={metro.zip}` and an `animate-in fade-in slide-in-from-bottom-1 duration-500` class so each rotation re-runs the entrance (Tailwind `tailwindcss-animate` classes are already used in this file today).
- The whole card article also carries `key={metro.zip}` + the same `animate-in fade-in duration-500` so photo/figures crossfade as one unit inside a **fixed-size shell** (`.mat` grid identical to today — zero CLS).
- Under reduced motion the `animate-in` classes are inert (tailwindcss-animate respects `prefers-reduced-motion`) and the hook never rotates — both layers of stillness.
- Hover/focus anywhere in the section pauses rotation (`onMouseEnter/onMouseLeave/onFocusCapture/onBlurCapture`); a typed ZIP calls `pin()` and swaps to the fetched single-metro reveal (today's `load(zip)` behavior, kept).
- The rotating region gets `aria-live="off"`; the typed-ZIP result message container is `aria-live="polite"`.

- [ ] **Step 1: Update the failing test first**

```tsx
// apps/one/src/components/home/FirstDealHero.test.tsx — replace the existing suite body
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { FirstDealHero } from './FirstDealHero';

const entry = (zip: string, label: string, addr: string) => ({
  metro: { label, zip },
  deal: {
    id: zip, address: addr, listing_price: 190000, estimated_rent: 2200,
    ratio: 2200 / 190000, rent_low: 2000, rent_high: 2400,
    primary_photo: 'p.jpg', metroZip: zip, zip,
  },
});
const ALL = {
  metros: [entry('77002', 'Houston', '1 Houston St'), entry('44102', 'Cleveland', '2 Cleveland Ave')],
};

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') ? false : false, media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    ({ ok: true, json: async () => (String(url).includes('all=1') ? ALL : entry('90004', 'Los Angeles', '3 LA Blvd')) }) as Response));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('FirstDealHero carousel', () => {
  it('renders the first metro with the city set in italic serif', async () => {
    render(<FirstDealHero />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const em = document.querySelector('h2 em');
    expect(em).not.toBeNull();
    expect(['Houston', 'Cleveland']).toContain(em!.textContent);
    expect(screen.getByRole('link', { name: /more like this/i })).toBeTruthy();
  });
  it('rotates to another metro after the interval', async () => {
    render(<FirstDealHero />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const first = document.querySelector('h2 em')!.textContent;
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(document.querySelector('h2 em')!.textContent).not.toBe(first);
  });
  it('typed ZIP pins the carousel to the fetched metro', async () => {
    render(<FirstDealHero />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    fireEvent.change(screen.getByLabelText(/city or zip/i), { target: { value: '90004' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(document.querySelector('h2 em')!.textContent).toBe('Los Angeles');
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(document.querySelector('h2 em')!.textContent).toBe('Los Angeles'); // pinned
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/home/FirstDealHero.test.tsx`
Expected: FAIL (no `h2 em`, no rotation).

- [ ] **Step 3: Rewrite the component**

```tsx
// apps/one/src/components/home/FirstDealHero.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CountUpRatio } from './CountUpRatio';
import type { Spotlight, SpotlightEntry } from '@/lib/spotlight';
import { useMetroRotation } from './useMetroRotation';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function FirstDealHero() {
  const [entries, setEntries] = useState<SpotlightEntry[]>([]);
  const [pinnedEntry, setPinnedEntry] = useState<SpotlightEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const rot = useMetroRotation(entries.length, { reduceMotion });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/spotlight?all=1');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (alive) setEntries((data.metros ?? []).filter((e: SpotlightEntry) => e.deal));
      } catch (err) {
        console.error('Failed to load spotlight metros:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Typed ZIP: fetch that metro's single reveal and pin the carousel on it.
  async function loadPinned(zip: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/spotlight?zip=${encodeURIComponent(zip)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entry = (await res.json()) as SpotlightEntry;
      setPinnedEntry(entry);
      rot.pin();
    } catch (err) {
      console.error('Failed to load spotlight deal:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const zip = q.trim().match(/^\d{5}$/)?.[0];
    if (zip) void loadPinned(zip);
  }

  const current: SpotlightEntry | null =
    pinnedEntry ?? (entries.length ? entries[rot.order[rot.index] % entries.length] : null);
  const metroLabel = current?.metro.label ?? '';
  const deal: Spotlight | null = current?.deal ?? null;

  return (
    <section
      aria-labelledby="hero-h"
      className="border-b border-line"
      onMouseEnter={() => rot.setPaused(true)}
      onMouseLeave={() => rot.setPaused(false)}
      onFocusCapture={() => rot.setPaused(true)}
      onBlurCapture={() => rot.setPaused(false)}
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <p className="prov">Real listings · live rent estimates · {pinnedEntry ? 'your pick' : 'touring the markets'}</p>
        <h2 id="hero-h" className="mt-2 max-w-3xl font-sans text-4xl font-semibold tracking-[-0.02em] sm:text-5xl" style={{ color: 'var(--text)' }}>
          The best cash-flowing property{' '}
          {metroLabel ? (
            <>
              in{' '}
              <em
                key={current!.metro.zip}
                className="font-serif italic font-medium animate-in fade-in slide-in-from-bottom-1 duration-500"
                style={{ color: 'var(--brass)' }}
              >
                {metroLabel}
              </em>
            </>
          ) : (
            'near you'
          )}
          , right now.
        </h2>
        <form action="/search" onSubmit={handleSubmit} className="mt-6 flex max-w-md gap-2">
          <label htmlFor="hero-q" className="sr-only">City or ZIP</label>
          <input
            id="hero-q" name="q" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Try a ZIP — e.g. 77002"
            className="mat h-11 flex-1 px-3 text-[15px]" style={{ color: 'var(--text)' }}
          />
          <button type="submit" className="h-11 rounded-[6px] px-4 text-[14px] font-semibold" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>
            Show me
          </button>
        </form>

        <div className="mt-10" aria-live={pinnedEntry ? 'polite' : 'off'}>
          {loading ? (
            <div className="mat max-w-3xl overflow-hidden p-0 animate-pulse" aria-hidden>
              {/* Skeleton mirrors the card box exactly — zero CLS on reveal. */}
              <div className="grid sm:grid-cols-[1.2fr_1fr]">
                <div className="relative aspect-[4/3]" style={{ background: 'var(--ink-2)' }} />
                <div className="flex flex-col justify-center gap-2 p-6">
                  <div className="h-4 w-1/3 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="h-10 w-2/3 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="h-4 w-1/2 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="mt-3 h-10 w-40 rounded-[6px]" style={{ background: 'var(--ink-2)' }} />
                </div>
              </div>
            </div>
          ) : deal ? (
            <article key={current!.metro.zip} className="mat max-w-3xl overflow-hidden p-0 animate-in fade-in duration-500">
              <div className="grid sm:grid-cols-[1.2fr_1fr]">
                <div className="relative aspect-[4/3]">
                  {/* unoptimized: scraper-sourced photo URL from arbitrary hosts; the
                      strict remotePatterns allowlist would 400 unlisted ones. One hero
                      image — skip the optimizer, don't widen the allowlist. */}
                  {deal.primary_photo && (
                    <Image src={deal.primary_photo} alt={deal.address} fill className="object-cover" sizes="(max-width:640px) 100vw, 400px" unoptimized />
                  )}
                </div>
                <div className="flex flex-col justify-center gap-2 p-6">
                  <p className="prov">Clears the line</p>
                  <div className="text-4xl"><CountUpRatio value={deal.ratio} /></div>
                  <p className="text-[15px]" style={{ color: 'var(--text)' }}>{deal.address}</p>
                  <p className="text-[13px]" style={{ color: 'var(--mute)' }}>
                    {usd0.format(deal.listing_price)} · est. rent {usd0.format(deal.estimated_rent)}/mo
                  </p>
                  <Link href={`/search?q=${deal.zip || current!.metro.zip}`}
                    className="mt-3 inline-flex h-10 items-center justify-center rounded-[6px] px-4 text-[14px] font-semibold"
                    style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
                    See more like this →
                  </Link>
                </div>
              </div>
            </article>
          ) : (
            <p className="prov">No live deal for that area yet — <Link href="/search" className="underline">browse all markets</Link>.</p>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes, then the full suite**

Run: `pnpm --filter @oper/one test src/components/home/FirstDealHero.test.tsx`
Expected: PASS (3 tests).
Run: `pnpm --filter @oper/one test && pnpm --filter @oper/one typecheck`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/components/home/FirstDealHero.tsx apps/one/src/components/home/FirstDealHero.test.tsx
git commit -m "feat(home): metro carousel hero — italic city, 6s crossfade rotation, typed-ZIP pin"
```

---

## Task 4: Live verification + polish gate

**Files:**
- Modify: none expected (visual verification; a spacing/type tweak inside `FirstDealHero.tsx` is allowed if the browser pass demands it)

- [ ] **Step 1: Build + run locally, watch the carousel**

Run: `pnpm --filter @oper/one dev`, open `/`, scroll to the bottom hero. Expected: first paint shows the skeleton; the reveal shows a metro with the city in brass Fraunces italic; every ~6s the city + card crossfade to another metro; hovering the section freezes it; typing `44102` + Show me pins Cleveland and rotation never resumes.

- [ ] **Step 2: Reduced-motion pass**

Toggle OS reduced motion (macOS: Settings → Accessibility → Display → Reduce motion). Reload. Expected: one static metro, no rotation, no entrance animations; typed ZIP still swaps (instantly).

- [ ] **Step 3: CLS + a11y spot-check**

In devtools, confirm the card box does not change size across rotations (no layout shift entries in the Performance overlay). Confirm the page has exactly ONE `h1` (the editorial hero) and the carousel heading is an `h2`. Confirm the rotating region announces nothing in VoiceOver while rotating.

- [ ] **Step 4: Deploy smoke (after merge)**

`curl -s 'https://one.octavo.press/api/spotlight?all=1' | jq '.metros | length'` → `8` (first call may take ~8s cold; repeat is instant).

- [ ] **Step 5: Commit (only if Step 1-3 forced a tweak)**

```bash
git add apps/one/src/components/home/FirstDealHero.tsx
git commit -m "polish(home): carousel visual pass"
```

---

## Rollout

Single PR. No migrations, no env changes, no new units. The `?all=1` cold path costs ≤ 8 sequential ~1s queries once per 5 minutes per instance; everything else is cache hits.

## Self-Review

**Spec coverage:** italic city title (Task 3: Fraunces `<em>`, brass) · text around it stays roman (locked in the h2 markup) · ~5s animated rotation to a random metro with image+data transitioning together (Task 2 shuffle + 6s default, Task 3 keyed crossfade) · "can look better overall" (Task 3 typography + provenance line, Task 4 polish gate) · duplicate-h1 fixed (h2 demotion) · reduced-motion/a11y/no-JS/CLS constraints carried from the original plan. Covered.

**Placeholder scan:** every code step carries complete code; commands are exact; the only conditional commit (Task 4 Step 5) is explicitly gated on the visual pass.

**Type consistency:** `SpotlightEntry` defined once (Task 1) and consumed by the route + hero (Task 3); `useMetroRotation`'s `Rotation` shape defined in Task 2 and consumed as written in Task 3; `Spotlight` untouched. The `?all=1` response `{ metros }` matches between route implementation, route test, and the hero's fetch.
