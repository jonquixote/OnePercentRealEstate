# First-Deal Magic — The Ten-Second "Holy Sh*t" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**The Jobs voice:** *"Look at this homepage. Seven sections before I feel anything. You've built a Bloomberg terminal and put it where the welcome mat goes. A person shows up not knowing what the 1% rule is — in ten seconds they should see ONE real property, in THEIR city, that makes money, and think 'holy sh*t.' One number. One reveal. Everything else earns its way down the page."*

**Goal:** Replace the cold, filter-first homepage entry with a single-input hero that instantly reveals the best live cash-flowing property near the visitor — a cinematic "deal reveal" that turns a first-time visitor into a believer in under ten seconds, with the full tool progressively disclosed below.

**Architecture:** A new server route `/api/spotlight` returns the single best 1%-clearing live listing for a location (IP-geolocated metro, or a typed city/ZIP), cached hard. A new client hero (`FirstDealHero`) owns the input → reveal interaction: the ratio counts up, the card rises in, one CTA drops the user into `/search` pre-scoped to that metro. The existing dashboard sections move below a fold and load lazily so the hero is the whole first paint.

**Tech Stack:** Next 16 App Router (apps/one), React client components, nuqs URL state, existing `getProperties` server action + `pool` (`apps/one/src/lib/db.ts`), the eggshell "line" design tokens in `apps/one/src/app/globals.css`, Vitest.

## Global Constraints

- **Design language:** apps/one is the eggshell "line" motif — tokens `--ink #faf7f2`, `--pass #0e7a52`, `--brass #9c7a34`, `--line #e2dccf`, `--text #2a2520`; utility classes `.figure`, `.prov`, `.mat`, `.band`. No new colors. (`apps/one/src/app/globals.css`)
- **Ratio is a fraction everywhere in the domain layer, a percent only at render.** `rentToPriceMonthly(price, rent)` in `@oper/primitives` returns a fraction; multiply by 100 only in JSX. (Established by `calculatePropertyMetrics` — see `packages/primitives`.)
- **Server is the trust boundary:** the spotlight query is parameterized, never interpolates user input, and clamps its own LIMIT. No client SQL.
- **Never touch `listings.updated_at`.** Read-only queries only in this plan.
- **Accessibility:** every animated reveal must have a reduced-motion fallback (`@media (prefers-reduced-motion: reduce)`); the input is a labeled `<form>` that works with JS disabled (falls back to `/search?q=`).
- **Perf budget:** the hero must be interactive with zero listing data (skeleton), and the spotlight fetch must not block first paint. Lighthouse mobile Performance ≥ 90 on `/` after this change (was the M-phase gate).
- **Tests:** Vitest colocated as `*.test.ts(x)`. Run a single file with `pnpm --filter @oper/one test <path>`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/spotlight.ts` (create) | Pure query builder + row shaper: `buildSpotlightQuery(loc): {sql, params}`, `shapeSpotlight(row): Spotlight`. No I/O. |
| `apps/one/src/lib/geo.ts` (create) | `metroFromRequest(headers): MetroGuess` — map an IP/`x-vercel-ip-city`/CF header to a metro `{label, zip, lat, lng}`; static fallback table. Pure given headers. |
| `apps/one/src/app/api/spotlight/route.ts` (create) | GET handler: parse `?zip=`/`?q=` or geo-guess, run the query via `pool`, cache 5 min, return `Spotlight` JSON. |
| `apps/one/src/components/home/FirstDealHero.tsx` (create) | The input → reveal client component. Owns the count-up + card-rise + CTA. |
| `apps/one/src/components/home/CountUpRatio.tsx` (create) | Small reduced-motion-aware number animator for the ratio. |
| `apps/one/src/app/page.tsx` (modify) | Mount `FirstDealHero` at top; lazy-load the existing dashboard below a fold. |
| `apps/one/src/lib/metros.ts` (create) | The canonical metro table (label, zip, lat, lng, bbox) shared by geo + hero + CTA. |

---

## Task 1: The metro table (shared reference data)

**Files:**
- Create: `apps/one/src/lib/metros.ts`
- Test: `apps/one/src/lib/metros.test.ts`

**Interfaces:**
- Produces: `type Metro = { slug: string; label: string; zip: string; lat: number; lng: number }`, `export const METROS: Metro[]`, `export const DEFAULT_METRO: Metro`, `metroByZip(zip: string): Metro | null`, `nearestMetro(lat: number, lng: number): Metro`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/lib/metros.test.ts
import { describe, it, expect } from 'vitest';
import { METROS, DEFAULT_METRO, metroByZip, nearestMetro } from './metros';

describe('metros', () => {
  it('has a stable default metro with a real zip', () => {
    expect(DEFAULT_METRO.zip).toMatch(/^\d{5}$/);
    expect(METROS.length).toBeGreaterThanOrEqual(8);
  });
  it('maps a known zip to its metro', () => {
    expect(metroByZip('90004')?.label).toBe('Los Angeles');
    expect(metroByZip('00000')).toBeNull();
  });
  it('finds the nearest metro to a coordinate', () => {
    // Near downtown Houston
    expect(nearestMetro(29.75, -95.36).label).toBe('Houston');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/metros.test.ts`
Expected: FAIL — cannot find module `./metros`.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/lib/metros.ts
export type Metro = { slug: string; label: string; zip: string; lat: number; lng: number };

// Top investor metros. zip = a representative central ZIP that has listings
// (these mirror FOOTER_MARKETS in lib/nav.ts — keep in sync).
export const METROS: Metro[] = [
  { slug: 'los-angeles', label: 'Los Angeles', zip: '90004', lat: 34.076, lng: -118.31 },
  { slug: 'houston', label: 'Houston', zip: '77002', lat: 29.756, lng: -95.363 },
  { slug: 'atlanta', label: 'Atlanta', zip: '30310', lat: 33.727, lng: -84.42 },
  { slug: 'tampa', label: 'Tampa', zip: '33604', lat: 27.998, lng: -82.457 },
  { slug: 'columbus', label: 'Columbus', zip: '43206', lat: 39.94, lng: -82.966 },
  { slug: 'memphis', label: 'Memphis', zip: '38106', lat: 35.107, lng: -90.03 },
  { slug: 'cleveland', label: 'Cleveland', zip: '44102', lat: 41.47, lng: -81.74 },
  { slug: 'san-antonio', label: 'San Antonio', zip: '78201', lat: 29.46, lng: -98.53 },
];

export const DEFAULT_METRO: Metro = METROS[1]; // Houston — deep 1%-clearing inventory

export function metroByZip(zip: string): Metro | null {
  return METROS.find((m) => m.zip === zip) ?? null;
}

export function nearestMetro(lat: number, lng: number): Metro {
  let best = DEFAULT_METRO;
  let bestD = Infinity;
  for (const m of METROS) {
    const d = (m.lat - lat) ** 2 + (m.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/lib/metros.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/metros.ts apps/one/src/lib/metros.test.ts
git commit -m "feat(home): canonical metro table for spotlight + geo"
```

---

## Task 2: Spotlight query builder (pure, parameterized)

**Files:**
- Create: `apps/one/src/lib/spotlight.ts`
- Test: `apps/one/src/lib/spotlight.test.ts`

**Interfaces:**
- Consumes: `Metro` from Task 1.
- Produces:
  - `type SpotlightLoc = { zip: string; lat: number; lng: number }`
  - `buildSpotlightQuery(loc: SpotlightLoc): { sql: string; params: unknown[] }`
  - `type Spotlight = { id: string; address: string; listing_price: number; estimated_rent: number; ratio: number; rent_low: number | null; rent_high: number | null; primary_photo: string | null; metroZip: string }`
  - `shapeSpotlight(row: Record<string, unknown>, metroZip: string): Spotlight | null`

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/lib/spotlight.test.ts
import { describe, it, expect } from 'vitest';
import { buildSpotlightQuery, shapeSpotlight } from './spotlight';

describe('buildSpotlightQuery', () => {
  it('parameterizes every user-derived value (no interpolation)', () => {
    const { sql, params } = buildSpotlightQuery({ zip: '77002', lat: 29.75, lng: -95.36 });
    expect(sql).not.toContain('77002');
    expect(sql).not.toContain('29.75');
    expect(params).toEqual(expect.arrayContaining(['77002']));
    // Ranks the best 1%-clearing deal near the point, one row.
    expect(sql).toMatch(/ORDER BY/i);
    expect(sql).toMatch(/LIMIT 1/);
  });
  it('only considers live, rentable, priced listings that clear the line', () => {
    const { sql } = buildSpotlightQuery({ zip: '77002', lat: 29.75, lng: -95.36 });
    expect(sql).toMatch(/estimated_rent\s*>\s*0/i);
    expect(sql).toMatch(/listing_price\s*>\s*0/i);
    expect(sql).toMatch(/estimated_rent\s*\/\s*listing_price\s*>=\s*0.01/i);
  });
});

describe('shapeSpotlight', () => {
  it('computes ratio as a fraction and passes through band', () => {
    const s = shapeSpotlight(
      { id: 1, address: '1 Main', listing_price: '200000', estimated_rent: '2200',
        rent_low: '2000', rent_high: '2400', primary_photo: 'x.jpg' },
      '77002',
    );
    expect(s).not.toBeNull();
    expect(s!.ratio).toBeCloseTo(0.011, 3);
    expect(s!.metroZip).toBe('77002');
  });
  it('returns null when price or rent missing (never a broken hero)', () => {
    expect(shapeSpotlight({ id: 1, address: 'x', listing_price: null, estimated_rent: '2200' }, '77002')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/spotlight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/lib/spotlight.ts
export type SpotlightLoc = { zip: string; lat: number; lng: number };

export type Spotlight = {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  ratio: number;
  rent_low: number | null;
  rent_high: number | null;
  primary_photo: string | null;
  metroZip: string;
};

// Best live 1%-clearing deal near a point. Ranks by ratio desc but breaks ties
// toward closer + fresher so the hero feels local and current. All user-derived
// values are bound params; the 0.01 gate and LIMIT are server constants.
export function buildSpotlightQuery(loc: SpotlightLoc): { sql: string; params: unknown[] } {
  const sql = `
    SELECT id, address, listing_price, estimated_rent, rent_low, rent_high, primary_photo,
           ((geom <-> ST_SetSRID(ST_MakePoint($2, $3), 4326))) AS dist
    FROM listings
    WHERE listing_type = 'for_sale'
      AND is_rentable IS NOT FALSE
      AND listing_price > 0
      AND estimated_rent > 0
      AND (estimated_rent / listing_price) >= 0.01
      AND geom IS NOT NULL
      AND primary_photo IS NOT NULL
      AND (zip_code = $1 OR (geom <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)) < 0.6)
    ORDER BY (estimated_rent / listing_price) DESC,
             (geom <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)) ASC,
             created_at DESC
    LIMIT 1`;
  return { sql, params: [loc.zip, loc.lng, loc.lat] };
}

export function shapeSpotlight(row: Record<string, unknown>, metroZip: string): Spotlight | null {
  const price = Number(row.listing_price);
  const rent = Number(row.estimated_rent);
  if (!(price > 0) || !(rent > 0)) return null;
  return {
    id: String(row.id),
    address: String(row.address ?? ''),
    listing_price: price,
    estimated_rent: rent,
    ratio: rent / price,
    rent_low: row.rent_low != null ? Number(row.rent_low) : null,
    rent_high: row.rent_high != null ? Number(row.rent_high) : null,
    primary_photo: row.primary_photo != null ? String(row.primary_photo) : null,
    metroZip,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/lib/spotlight.test.ts`
Expected: PASS (4 tests).

> Note on the index: `buildSpotlightQuery` filters on `listing_type` + `geom` + the ratio expression. The `idx_listings_type_sale_price_geom` partial index (added in `2026_07_12_indexes.sql`) plus the existing geom GiST cover this; confirm with `EXPLAIN` during Task 4 verification.

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/spotlight.ts apps/one/src/lib/spotlight.test.ts
git commit -m "feat(home): spotlight query builder + row shaper"
```

---

## Task 3: Geo guess from request headers

**Files:**
- Create: `apps/one/src/lib/geo.ts`
- Test: `apps/one/src/lib/geo.test.ts`

**Interfaces:**
- Consumes: `Metro`, `nearestMetro`, `metroByZip`, `DEFAULT_METRO` from Task 1.
- Produces: `metroFromHeaders(h: Headers): Metro` — reads `x-vercel-ip-latitude`/`-longitude`, then `x-vercel-ip-city`, else `DEFAULT_METRO`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/lib/geo.test.ts
import { describe, it, expect } from 'vitest';
import { metroFromHeaders } from './geo';

const H = (o: Record<string, string>) => new Headers(o);

describe('metroFromHeaders', () => {
  it('uses vercel lat/long to pick the nearest metro', () => {
    const m = metroFromHeaders(H({ 'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36' }));
    expect(m.label).toBe('Houston');
  });
  it('falls back to the default metro when no geo headers', () => {
    expect(metroFromHeaders(H({})).zip).toMatch(/^\d{5}$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/geo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/lib/geo.ts
import { DEFAULT_METRO, nearestMetro, type Metro } from './metros';

export function metroFromHeaders(h: Headers): Metro {
  const lat = Number(h.get('x-vercel-ip-latitude'));
  const lng = Number(h.get('x-vercel-ip-longitude'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
    return nearestMetro(lat, lng);
  }
  return DEFAULT_METRO;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/lib/geo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/geo.ts apps/one/src/lib/geo.test.ts
git commit -m "feat(home): metro guess from edge geo headers"
```

---

## Task 4: `/api/spotlight` route

**Files:**
- Create: `apps/one/src/app/api/spotlight/route.ts`
- Test: `apps/one/src/app/api/spotlight/route.test.ts`

**Interfaces:**
- Consumes: `buildSpotlightQuery`, `shapeSpotlight` (Task 2); `metroFromHeaders` (Task 3); `metroByZip`, `nearestMetro` (Task 1); `pool` from `apps/one/src/lib/db.ts`.
- Produces: `GET(req): Response` returning `{ metro: {label, zip}, deal: Spotlight | null }`; resolver `resolveLoc(searchParams, headers): { metro: Metro }` exported for testing.

- [ ] **Step 1: Write the failing test** (unit-tests the pure resolver; the DB call is covered by the Task 8 smoke check)

```ts
// apps/one/src/app/api/spotlight/route.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLoc } from './route';

describe('resolveLoc', () => {
  it('prefers an explicit valid ?zip= over geo', () => {
    const sp = new URLSearchParams({ zip: '90004' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.7', 'x-vercel-ip-longitude': '-95.3' }));
    expect(metro.label).toBe('Los Angeles');
  });
  it('ignores a malformed zip and falls back to geo', () => {
    const sp = new URLSearchParams({ zip: 'abcde' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36' }));
    expect(metro.label).toBe('Houston');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/app/api/spotlight/route.test.ts`
Expected: FAIL — module/`resolveLoc` not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/app/api/spotlight/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildSpotlightQuery, shapeSpotlight } from '@/lib/spotlight';
import { metroFromHeaders } from '@/lib/geo';
import { metroByZip, type Metro } from '@/lib/metros';

export const dynamic = 'force-dynamic';

export function resolveLoc(sp: URLSearchParams, headers: Headers): { metro: Metro } {
  const zip = sp.get('zip');
  if (zip && /^\d{5}$/.test(zip)) {
    const m = metroByZip(zip);
    if (m) return { metro: m };
  }
  return { metro: metroFromHeaders(headers) };
}

// Single-instance TTL cache keyed by metro zip (5 min). Acceptable for one box.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const { metro } = resolveLoc(req.nextUrl.searchParams, req.headers);
  const hit = cache.get(metro.zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  try {
    const { sql, params } = buildSpotlightQuery({ zip: metro.zip, lat: metro.lat, lng: metro.lng });
    const res = await pool.query(sql, params);
    const deal = res.rows[0] ? shapeSpotlight(res.rows[0], metro.zip) : null;
    const body = { metro: { label: metro.label, zip: metro.zip }, deal };
    cache.set(metro.zip, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    console.error('/api/spotlight error:', err);
    return NextResponse.json({ metro: { label: metro.label, zip: metro.zip }, deal: null }, { status: 200 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/app/api/spotlight/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual DB smoke (local or against a read replica)**

Run: `curl -s 'http://localhost:3000/api/spotlight?zip=77002' | head -c 300`
Expected: JSON with `metro.label = "Houston"` and a non-null `deal` whose `ratio >= 0.01`.

- [ ] **Step 6: Commit**

```bash
git add apps/one/src/app/api/spotlight/route.ts apps/one/src/app/api/spotlight/route.test.ts
git commit -m "feat(home): /api/spotlight — best live deal for a metro"
```

---

## Task 5: `CountUpRatio` (reduced-motion-aware)

**Files:**
- Create: `apps/one/src/components/home/CountUpRatio.tsx`
- Test: `apps/one/src/components/home/CountUpRatio.test.tsx`

**Interfaces:**
- Produces: `<CountUpRatio value={number} durationMs?={number} />` — animates 0 → `value` (a fraction), renders as a percent with 2 decimals. Under `prefers-reduced-motion: reduce`, renders the final value immediately.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/one/src/components/home/CountUpRatio.test.tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountUpRatio } from './CountUpRatio';

beforeAll(() => {
  // jsdom: force reduced-motion so the component renders the final value at once.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('CountUpRatio', () => {
  it('renders the final percent immediately under reduced motion', () => {
    render(<CountUpRatio value={0.0118} />);
    expect(screen.getByText('1.18%')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/home/CountUpRatio.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/one/src/components/home/CountUpRatio.tsx
'use client';
import { useEffect, useState } from 'react';

const pct = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CountUpRatio({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
  }, [value, durationMs]);
  return <span className="figure figure--pass tabular-nums">{pct.format(shown)}</span>;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/components/home/CountUpRatio.test.tsx`
Expected: PASS (1 test).

> If `@testing-library/react` is not yet a dev dep of apps/one, add it: `pnpm --filter @oper/one add -D @testing-library/react @testing-library/jest-dom jsdom`, and ensure `apps/one/vitest.config.ts` sets `environment: 'jsdom'`. Do this in this task's commit.

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/components/home/CountUpRatio.tsx apps/one/src/components/home/CountUpRatio.test.tsx apps/one/vitest.config.ts apps/one/package.json
git commit -m "feat(home): CountUpRatio ratio animator (reduced-motion safe)"
```

---

## Task 6: `FirstDealHero` — input → reveal

**Files:**
- Create: `apps/one/src/components/home/FirstDealHero.tsx`
- Test: `apps/one/src/components/home/FirstDealHero.test.tsx`

**Interfaces:**
- Consumes: `CountUpRatio` (Task 5); `Spotlight` type (Task 2); `Metro`/`METROS` (Task 1).
- Produces: `<FirstDealHero initialMetroLabel?={string} />` — renders a labeled search `<form>` (city/ZIP), fetches `/api/spotlight`, reveals the deal card; the primary CTA links to `/search?zip=<metroZip>`. Exposes no props consumers depend on beyond the optional label.

- [ ] **Step 1: Write the failing test** (mock fetch; assert the reveal + CTA target)

```tsx
// apps/one/src/components/home/FirstDealHero.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FirstDealHero } from './FirstDealHero';

const deal = {
  id: '42', address: '123 Yield St', listing_price: 190000, estimated_rent: 2200,
  ratio: 2200 / 190000, rent_low: 2000, rent_high: 2400, primary_photo: 'p.jpg', metroZip: '77002',
};

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: true, json: async () => ({ metro: { label: 'Houston', zip: '77002' }, deal }) }) as Response));
});

describe('FirstDealHero', () => {
  it('reveals the spotlight deal and points the CTA at the metro search', async () => {
    render(<FirstDealHero initialMetroLabel="Houston" />);
    await waitFor(() => expect(screen.getByText('123 Yield St')).toBeTruthy());
    expect(screen.getByText('1.16%')).toBeTruthy(); // 2200/190000 = 1.157%
    const cta = screen.getByRole('link', { name: /more like this/i });
    expect(cta.getAttribute('href')).toBe('/search?zip=77002');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/home/FirstDealHero.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (keep it to the tokens; one CTA; skeleton before data)

```tsx
// apps/one/src/components/home/FirstDealHero.tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CountUpRatio } from './CountUpRatio';
import type { Spotlight } from '@/lib/spotlight';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function FirstDealHero({ initialMetroLabel }: { initialMetroLabel?: string }) {
  const [metroLabel, setMetroLabel] = useState(initialMetroLabel ?? '');
  const [deal, setDeal] = useState<Spotlight | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  async function load(zip?: string) {
    setLoading(true);
    try {
      const url = zip ? `/api/spotlight?zip=${encodeURIComponent(zip)}` : '/api/spotlight';
      const res = await fetch(url);
      const data = await res.json();
      setMetroLabel(data.metro?.label ?? '');
      setDeal(data.deal ?? null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const zip = q.trim().match(/^\d{5}$/)?.[0];
    void load(zip);
  }

  return (
    <section aria-labelledby="hero-h" className="border-b border-line">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <p className="prov">Real listings · live rent estimates</p>
        <h1 id="hero-h" className="mt-2 max-w-3xl font-sans text-4xl font-semibold tracking-[-0.02em] sm:text-5xl" style={{ color: 'var(--text)' }}>
          The best cash-flowing property {metroLabel ? `in ${metroLabel}` : 'near you'}, right now.
        </h1>
        <form onSubmit={onSubmit} action="/search" className="mt-6 flex max-w-md gap-2">
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

        <div className="mt-10">
          {loading ? (
            <div className="mat aspect-[16/7] max-w-3xl animate-pulse" aria-hidden />
          ) : deal ? (
            <article className="mat max-w-3xl overflow-hidden p-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="grid sm:grid-cols-[1.2fr_1fr]">
                <div className="relative aspect-[4/3]">
                  {deal.primary_photo && (
                    <Image src={deal.primary_photo} alt={deal.address} fill className="object-cover" sizes="(max-width:640px) 100vw, 400px" />
                  )}
                </div>
                <div className="flex flex-col justify-center gap-2 p-6">
                  <p className="prov">Clears the line</p>
                  <div className="text-4xl"><CountUpRatio value={deal.ratio} /></div>
                  <p className="text-[15px]" style={{ color: 'var(--text)' }}>{deal.address}</p>
                  <p className="text-[13px]" style={{ color: 'var(--mute)' }}>
                    {usd0.format(deal.listing_price)} · est. rent {usd0.format(deal.estimated_rent)}/mo
                  </p>
                  <Link href={`/search?zip=${deal.metroZip}`}
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

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/components/home/FirstDealHero.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/components/home/FirstDealHero.tsx apps/one/src/components/home/FirstDealHero.test.tsx
git commit -m "feat(home): FirstDealHero — ten-second deal reveal"
```

---

## Task 7: Mount the hero; demote the dashboard below the fold

**Files:**
- Modify: `apps/one/src/app/page.tsx:141-162` (the top of the returned JSX)

**Interfaces:**
- Consumes: `FirstDealHero` (Task 6).

- [ ] **Step 1: Replace the `HomeHero` mount with `FirstDealHero`, keep the tool but push it down.**

In `apps/one/src/app/page.tsx`, change the imports and the top of the returned tree. Replace:

```tsx
      <HomeHero
        stats={stats ?? null}
        priceCuts={priceCuts}
        medianRent={medianRent}
      />
      <FeaturedDeals strategy={strategy} rentCalcPending={stats?.rentCalcPending ?? 0} />
```

with:

```tsx
      <FirstDealHero />
      {/* The full tool + market context now live below the fold, as progressive
          disclosure. Everything a returning user wants is one scroll away. */}
      <FeaturedDeals strategy={strategy} rentCalcPending={stats?.rentCalcPending ?? 0} />
```

Add the import near the other `home/` imports (around line 25):

```tsx
import { FirstDealHero } from '@/components/home/FirstDealHero';
```

Remove the now-unused `HomeHero` import (line 19) if nothing else references it (grep first: `grep -rn HomeHero apps/one/src`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oper/one typecheck`
Expected: PASS (no unused-import or type errors).

- [ ] **Step 3: Manual before/after**

Run `pnpm --filter @oper/one dev`, open `/`. Expected: the hero paints first with a skeleton, then reveals a Houston (or geo) deal with the ratio counting up; the old dashboard sections still render below. Toggle OS reduced-motion → the ratio shows instantly, no rise animation.

- [ ] **Step 4: Commit**

```bash
git add apps/one/src/app/page.tsx
git commit -m "feat(home): lead with FirstDealHero, demote dashboard below fold"
```

---

## Task 8: Lighthouse gate + spotlight index proof

**Files:**
- Modify: none (verification task; may add one index if `EXPLAIN` shows a seq scan)
- Create (only if needed): `infrastructure/migrations/out-of-band/2026_07_XX_spotlight_index.sql`

- [ ] **Step 1: EXPLAIN the spotlight query against prod-shaped data**

Run (server or replica):
```
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM listings
WHERE listing_type='for_sale' AND is_rentable IS NOT FALSE AND listing_price>0
  AND estimated_rent>0 AND (estimated_rent/listing_price)>=0.01 AND geom IS NOT NULL
  AND primary_photo IS NOT NULL AND zip_code='77002'
ORDER BY (estimated_rent/listing_price) DESC, created_at DESC LIMIT 1;
```
Expected: an Index Scan (via `idx_listings_type_sale_price_geom` or `idx_listings_zip_created`), not a Parallel Seq Scan. If it seq-scans, create the out-of-band index below and re-run.

```sql
-- infrastructure/migrations/out-of-band/2026_07_XX_spotlight_index.sql
-- Only if EXPLAIN shows a seq scan for the spotlight query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_spotlight
  ON listings (zip_code, created_at DESC)
  WHERE listing_type = 'for_sale' AND estimated_rent > 0 AND listing_price > 0
        AND geom IS NOT NULL AND primary_photo IS NOT NULL;
```

- [ ] **Step 2: Lighthouse mobile on `/`**

Run the chrome-devtools Lighthouse audit against the built site (`pnpm --filter @oper/one build && pnpm --filter @oper/one start`, then audit `http://localhost:3000/`). Expected: Performance ≥ 90, no CLS regression from the reveal (the skeleton reserves the card's box).

- [ ] **Step 3: Commit (if an index was added)**

```bash
git add infrastructure/migrations/out-of-band/2026_07_XX_spotlight_index.sql
git commit -m "perf(home): partial index for spotlight query (EXPLAIN proof in message)"
```

---

## Self-Review

**Spec coverage:** single-input hero (Task 6) · instant best-deal reveal near visitor (Tasks 2–4, 6) · ten-second count-up delight (Task 5) · one CTA into scoped search (Task 6) · dashboard demoted (Task 7) · reduced-motion + a11y + JS-off form fallback (Tasks 5–6, `action="/search"`) · perf budget (Task 8). Covered.

**Placeholder scan:** all steps carry real code, exact paths, exact commands. The only conditional artifact (the spotlight index) is fully written and gated behind an `EXPLAIN` result.

**Type consistency:** `Spotlight` (ratio as fraction) is defined once in Task 2 and consumed unchanged in Tasks 4/6; `Metro` defined in Task 1 and consumed in Tasks 3/4; `/api/spotlight` response `{ metro, deal }` is produced in Task 4 and read identically in Task 6.
