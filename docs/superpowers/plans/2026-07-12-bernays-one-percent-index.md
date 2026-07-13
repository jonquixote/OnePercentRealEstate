# The 1% Rule Index — Manufacturing Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**The Bernays voice:** *"You have a superb instrument and complete silence around it. People don't seek what they don't know to want. Manufacture the demand: publish a recurring, authoritative index — 'where the 1% rule still clears' — with a number that reporters can quote and investors argue about. Make every metro a shareable artifact. Put it in inboxes monthly. The public thinks it's discovering a fact; in truth you're engineering the conversation, and every share is a door back to your product."*

**Goal:** Build **The 1% Rule Index** — a monthly, snapshotted, per-metro ranking of where the 1% rule still clears (share of live listings that pass, median ratio, momentum) — surfaced as a public authority page, per-metro shareable OG cards, an embeddable badge, and a monthly "State of the 1% Rule" email, engineered so each artifact routes demand back into Search.

**Architecture:** A monthly `index_snapshots` table stores one row per (metro, month). A snapshot **builder** (a worker script) computes the stats with one grouped SQL pass and upserts the current month. Pure ranking/scoring math lives in `@oper/primitives`. A public `/the-1-percent-index` page reads the latest snapshot via `/api/index`; per-metro OG cards reuse the existing `opengraph-image` pattern; the existing digest worker gains a monthly index-email path. Momentum compares this month's snapshot to last month's — a reason to re-share every month.

**Tech Stack:** Postgres (`listings`, `fhfa_zip_hpi`; new `index_snapshots`), `@oper/primitives` (Vitest), Next 16 apps/one (public page + OG route), the digest worker (`apps/worker/src/digest.ts`) + Resend, eggshell design tokens.

## Global Constraints

- **Snapshots are immutable monthly facts.** The builder upserts on `(metro_slug, month)`; it never rewrites a prior month. Momentum is computed by comparing months, not by mutation.
- **Metro definition is a committed reference** (`apps/one/src/lib/index-metros.ts`): `{ slug, label, zip3[] }`. The index aggregates live listings by `left(zip_code,3) = any(zip3)`.
- **Public pages are SEO artifacts:** the index page and per-metro cards are server-rendered, have canonical URLs, OG/Twitter cards, and `revalidate` (ISR) — not client-only.
- **Every public number links back to product:** each metro row's CTA is `/search?zip=<repZip>`; the email CTA is the index page.
- **Ratios are fractions in the domain layer, percents at render.** The "% clearing" stored value is a fraction; format at display.
- **Migration discipline:** `index_snapshots` is a normal txn-safe migration in `infrastructure/migrations/` (idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`). Applied via `pnpm --filter @oper/one migrate`.
- **Email reuses the digest opt-in/unsubscribe/caps machinery** — do not build a second sender. Read `apps/worker/src/digest.ts` first and follow its patterns exactly.
- **Tests:** `pnpm --filter @oper/primitives test <path>`, `pnpm --filter @oper/one test <path>`.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_XX_index_snapshots.sql` (create) | `index_snapshots` table + unique index. |
| `apps/one/src/lib/index-metros.ts` (create) | Committed metro reference: `{slug,label,zip3[],repZip}`. |
| `packages/primitives/src/index-score.ts` (create) | Pure: `indexScore`, `rankSnapshots`, `momentum`. |
| `apps/worker/src/build-index-snapshot.ts` (create) | Monthly builder: compute per-metro stats, upsert current month. |
| `apps/one/src/app/api/index/route.ts` (create) | Serve latest snapshot ranking (+ momentum vs prior month). |
| `apps/one/src/app/the-1-percent-index/page.tsx` (create) | Public authority page (server component, ISR). |
| `apps/one/src/app/the-1-percent-index/opengraph-image.tsx` (create) | National share card. |
| `apps/one/src/app/the-1-percent-index/[metro]/opengraph-image.tsx` (create) | Per-metro share card. |
| `apps/worker/src/digest.ts` (modify) | Monthly "State of the 1% Rule" email path. |
| `ops/systemd/oper-index-snapshot.{service,timer}` (create) | Monthly timer to run the builder. |

---

## Task 1: `index_snapshots` migration

**Files:**
- Create: `infrastructure/migrations/2026_07_XX_index_snapshots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- The 1% Rule Index: one immutable row per (metro, month).
CREATE TABLE IF NOT EXISTS index_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  metro_slug    TEXT NOT NULL,
  metro_label   TEXT NOT NULL,
  month         DATE NOT NULL,                 -- first day of the snapshot month (UTC)
  live_count    INT  NOT NULL DEFAULT 0,       -- live rentable priced listings in the metro
  clearing_count INT NOT NULL DEFAULT 0,       -- of those, how many clear >= 1%
  pct_clearing  NUMERIC(6,5) NOT NULL DEFAULT 0, -- fraction 0..1
  median_ratio  NUMERIC(7,6),                  -- median rent/price (fraction), nullable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_index_snapshots_metro_month
  ON index_snapshots (metro_slug, month);
CREATE INDEX IF NOT EXISTS idx_index_snapshots_month ON index_snapshots (month DESC);
```

- [ ] **Step 2: Apply it (dry-run gate is CI; apply locally/staging)**

Run: `pnpm --filter @oper/one migrate`
Expected: `✓ 2026_07_XX_index_snapshots`. Re-run → `⊘ (already applied)`.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/migrations/2026_07_XX_index_snapshots.sql
git commit -m "feat(index): index_snapshots table (monthly 1% rule index)"
```

---

## Task 2: Committed metro reference

**Files:**
- Create: `apps/one/src/lib/index-metros.ts`
- Test: `apps/one/src/lib/index-metros.test.ts`

**Interfaces:**
- Produces: `type IndexMetro = { slug: string; label: string; zip3: string[]; repZip: string }`, `export const INDEX_METROS: IndexMetro[]`, `indexMetroBySlug(slug): IndexMetro | null`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/lib/index-metros.test.ts
import { describe, it, expect } from 'vitest';
import { INDEX_METROS, indexMetroBySlug } from './index-metros';

describe('index-metros', () => {
  it('has >= 10 metros, each with zip3 prefixes and a rep zip', () => {
    expect(INDEX_METROS.length).toBeGreaterThanOrEqual(10);
    for (const m of INDEX_METROS) {
      expect(m.zip3.length).toBeGreaterThan(0);
      expect(m.repZip).toMatch(/^\d{5}$/);
      expect(m.zip3.every((z) => /^\d{3}$/.test(z))).toBe(true);
    }
  });
  it('looks up by slug', () => {
    expect(indexMetroBySlug('houston')?.label).toBe('Houston');
    expect(indexMetroBySlug('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/index-metros.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/lib/index-metros.ts
export type IndexMetro = { slug: string; label: string; zip3: string[]; repZip: string };

// ZIP3 prefixes approximate each metro. repZip is a central ZIP with inventory.
export const INDEX_METROS: IndexMetro[] = [
  { slug: 'houston', label: 'Houston', zip3: ['770', '772', '773', '774', '775'], repZip: '77002' },
  { slug: 'san-antonio', label: 'San Antonio', zip3: ['780', '782'], repZip: '78201' },
  { slug: 'memphis', label: 'Memphis', zip3: ['380', '381'], repZip: '38106' },
  { slug: 'cleveland', label: 'Cleveland', zip3: ['441'], repZip: '44102' },
  { slug: 'columbus', label: 'Columbus', zip3: ['432', '430', '431'], repZip: '43206' },
  { slug: 'atlanta', label: 'Atlanta', zip3: ['303', '300', '301'], repZip: '30310' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336', '335'], repZip: '33604' },
  { slug: 'indianapolis', label: 'Indianapolis', zip3: ['462', '461'], repZip: '46201' },
  { slug: 'kansas-city', label: 'Kansas City', zip3: ['641', '640'], repZip: '64127' },
  { slug: 'birmingham', label: 'Birmingham', zip3: ['352'], repZip: '35211' },
  { slug: 'los-angeles', label: 'Los Angeles', zip3: ['900', '910', '913'], repZip: '90004' },
  { slug: 'chicago', label: 'Chicago', zip3: ['606', '604'], repZip: '60620' },
];

export function indexMetroBySlug(slug: string): IndexMetro | null {
  return INDEX_METROS.find((m) => m.slug === slug) ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/lib/index-metros.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/index-metros.ts apps/one/src/lib/index-metros.test.ts
git commit -m "feat(index): committed metro reference (zip3 prefixes)"
```

---

## Task 3: Pure ranking + momentum math

**Files:**
- Create: `packages/primitives/src/index-score.ts`
- Test: `packages/primitives/src/index-score.test.ts`
- Modify: `packages/primitives/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `type SnapshotRow = { metroSlug: string; metroLabel: string; pctClearing: number; medianRatio: number | null; liveCount: number }`
  - `type RankedRow = SnapshotRow & { rank: number; momentum: number | null }`
  - `rankSnapshots(current: SnapshotRow[], prior?: SnapshotRow[]): RankedRow[]` — sort by `pctClearing` desc (tie-break `medianRatio` desc), assign 1-based rank, attach momentum = `current.pctClearing − prior.pctClearing` (null if no prior).

- [ ] **Step 1: Write the failing test**

```ts
// packages/primitives/src/index-score.test.ts
import { describe, it, expect } from 'vitest';
import { rankSnapshots } from './index-score';

const cur = [
  { metroSlug: 'a', metroLabel: 'A', pctClearing: 0.30, medianRatio: 0.009, liveCount: 100 },
  { metroSlug: 'b', metroLabel: 'B', pctClearing: 0.55, medianRatio: 0.011, liveCount: 200 },
];
const prior = [
  { metroSlug: 'a', metroLabel: 'A', pctClearing: 0.25, medianRatio: 0.008, liveCount: 90 },
  { metroSlug: 'b', metroLabel: 'B', pctClearing: 0.60, medianRatio: 0.012, liveCount: 210 },
];

describe('rankSnapshots', () => {
  it('ranks by pct clearing descending', () => {
    const r = rankSnapshots(cur);
    expect(r[0].metroSlug).toBe('b');
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(2);
  });
  it('computes momentum vs the prior month', () => {
    const r = rankSnapshots(cur, prior);
    expect(r.find((x) => x.metroSlug === 'a')!.momentum).toBeCloseTo(0.05, 5);
    expect(r.find((x) => x.metroSlug === 'b')!.momentum).toBeCloseTo(-0.05, 5);
  });
  it('momentum is null when there is no prior row for a metro', () => {
    const r = rankSnapshots(cur, [prior[0]]);
    expect(r.find((x) => x.metroSlug === 'b')!.momentum).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/primitives test src/index-score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/primitives/src/index-score.ts
export type SnapshotRow = {
  metroSlug: string; metroLabel: string;
  pctClearing: number; medianRatio: number | null; liveCount: number;
};
export type RankedRow = SnapshotRow & { rank: number; momentum: number | null };

export function rankSnapshots(current: SnapshotRow[], prior?: SnapshotRow[]): RankedRow[] {
  const priorBySlug = new Map((prior ?? []).map((r) => [r.metroSlug, r]));
  return [...current]
    .sort((a, b) => b.pctClearing - a.pctClearing || (b.medianRatio ?? 0) - (a.medianRatio ?? 0))
    .map((r, i) => {
      const p = priorBySlug.get(r.metroSlug);
      return { ...r, rank: i + 1, momentum: p ? r.pctClearing - p.pctClearing : null };
    });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/primitives test src/index-score.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export + commit**

In `packages/primitives/src/index.ts` add `export * from './index-score';`. Then:

```bash
pnpm --filter @oper/primitives typecheck
git add packages/primitives/src/index-score.ts packages/primitives/src/index-score.test.ts packages/primitives/src/index.ts
git commit -m "feat(primitives): rankSnapshots + momentum for the 1% index"
```

---

## Task 4: Snapshot builder (worker script)

**Files:**
- Create: `apps/worker/src/build-index-snapshot.ts`
- Test: `apps/worker/src/build-index-snapshot.test.ts`

**Interfaces:**
- Consumes: `INDEX_METROS` (import from apps/one is cross-app; instead **duplicate the reference into the worker** by importing from a shared location OR re-declare — see Step 3 note); `pool` (worker creates its own `pg` Pool as other workers do).
- Produces:
  - `buildSnapshotQuery(metros): { sql: string; params: unknown[] }` — one grouped query returning `{ metro_slug, live_count, clearing_count, median_ratio }` per metro.
  - `shapeSnapshotRows(dbRows, metros, month): SnapshotInsert[]` — pure; computes `pct_clearing` and pairs labels.
  - `type SnapshotInsert = { metro_slug: string; metro_label: string; month: string; live_count: number; clearing_count: number; pct_clearing: number; median_ratio: number | null }`

- [ ] **Step 1: Write the failing test** (pure `shapeSnapshotRows`)

```ts
// apps/worker/src/build-index-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { shapeSnapshotRows } from './build-index-snapshot';

const metros = [
  { slug: 'houston', label: 'Houston', zip3: ['770'], repZip: '77002' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336'], repZip: '33604' },
];

describe('shapeSnapshotRows', () => {
  it('computes pct_clearing and attaches labels', () => {
    const rows = shapeSnapshotRows(
      [{ metro_slug: 'houston', live_count: '200', clearing_count: '110', median_ratio: '0.0105' }],
      metros, '2026-07-01',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metro_label).toBe('Houston');
    expect(rows[0].pct_clearing).toBeCloseTo(0.55, 5);
    expect(rows[0].month).toBe('2026-07-01');
  });
  it('emits a zero row for a metro absent from the DB result (no gaps)', () => {
    const rows = shapeSnapshotRows([], metros, '2026-07-01');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.pct_clearing === 0 && r.live_count === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/worker test src/build-index-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/worker/src/build-index-snapshot.ts
import { Pool } from 'pg';

export type IndexMetro = { slug: string; label: string; zip3: string[]; repZip: string };
export type SnapshotInsert = {
  metro_slug: string; metro_label: string; month: string;
  live_count: number; clearing_count: number; pct_clearing: number; median_ratio: number | null;
};

// NOTE: keep this list in sync with apps/one/src/lib/index-metros.ts. The two
// apps do not share a runtime package for this reference; a `pnpm -r test` guard
// (Task 4b, optional) can assert equality if drift becomes a problem.
export const INDEX_METROS: IndexMetro[] = [
  { slug: 'houston', label: 'Houston', zip3: ['770','772','773','774','775'], repZip: '77002' },
  { slug: 'san-antonio', label: 'San Antonio', zip3: ['780','782'], repZip: '78201' },
  { slug: 'memphis', label: 'Memphis', zip3: ['380','381'], repZip: '38106' },
  { slug: 'cleveland', label: 'Cleveland', zip3: ['441'], repZip: '44102' },
  { slug: 'columbus', label: 'Columbus', zip3: ['432','430','431'], repZip: '43206' },
  { slug: 'atlanta', label: 'Atlanta', zip3: ['303','300','301'], repZip: '30310' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336','335'], repZip: '33604' },
  { slug: 'indianapolis', label: 'Indianapolis', zip3: ['462','461'], repZip: '46201' },
  { slug: 'kansas-city', label: 'Kansas City', zip3: ['641','640'], repZip: '64127' },
  { slug: 'birmingham', label: 'Birmingham', zip3: ['352'], repZip: '35211' },
  { slug: 'los-angeles', label: 'Los Angeles', zip3: ['900','910','913'], repZip: '90004' },
  { slug: 'chicago', label: 'Chicago', zip3: ['606','604'], repZip: '60620' },
];

// Maps each live listing to a metro via zip3, then aggregates clearing share and
// median ratio per metro in one pass. Metro membership is a VALUES join so it is
// fully parameterized and index-friendly on left(zip_code,3).
export function buildSnapshotQuery(metros: IndexMetro[]): { sql: string; params: unknown[] } {
  const pairs: string[] = [];
  const params: unknown[] = [];
  metros.forEach((m) => {
    m.zip3.forEach((z) => { params.push(z, m.slug); pairs.push(`($${params.length - 1}, $${params.length})`); });
  });
  const sql = `
    WITH metro_zip(zip3, metro_slug) AS (VALUES ${pairs.join(', ')})
    SELECT mz.metro_slug,
           count(*)::int AS live_count,
           count(*) FILTER (WHERE (l.estimated_rent / l.listing_price) >= 0.01)::int AS clearing_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (l.estimated_rent / l.listing_price)) AS median_ratio
    FROM listings l
    JOIN metro_zip mz ON mz.zip3 = left(l.zip_code, 3)
    WHERE l.listing_type = 'for_sale' AND l.is_rentable IS NOT FALSE
      AND l.listing_price > 0 AND l.estimated_rent > 0
    GROUP BY mz.metro_slug`;
  return { sql, params };
}

export function shapeSnapshotRows(
  dbRows: Array<Record<string, unknown>>, metros: IndexMetro[], month: string,
): SnapshotInsert[] {
  const bySlug = new Map(dbRows.map((r) => [String(r.metro_slug), r]));
  return metros.map((m) => {
    const r = bySlug.get(m.slug);
    const live = r ? Number(r.live_count) : 0;
    const clearing = r ? Number(r.clearing_count) : 0;
    const median = r && r.median_ratio != null ? Number(r.median_ratio) : null;
    return {
      metro_slug: m.slug, metro_label: m.label, month,
      live_count: live, clearing_count: clearing,
      pct_clearing: live > 0 ? clearing / live : 0,
      median_ratio: median,
    };
  });
}

function currentMonthUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Entry point: compute + upsert the current month, then exit (run by a timer).
export async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const month = currentMonthUTC();
    const { sql, params } = buildSnapshotQuery(INDEX_METROS);
    const res = await pool.query(sql, params);
    const rows = shapeSnapshotRows(res.rows, INDEX_METROS, month);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO index_snapshots (metro_slug, metro_label, month, live_count, clearing_count, pct_clearing, median_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (metro_slug, month) DO UPDATE
           SET live_count=EXCLUDED.live_count, clearing_count=EXCLUDED.clearing_count,
               pct_clearing=EXCLUDED.pct_clearing, median_ratio=EXCLUDED.median_ratio`,
        [r.metro_slug, r.metro_label, r.month, r.live_count, r.clearing_count, r.pct_clearing, r.median_ratio],
      );
    }
    console.log(JSON.stringify({ msg: 'index snapshot built', month, metros: rows.length }));
  } finally {
    await pool.end();
  }
}

// Run when invoked directly (tsx src/build-index-snapshot.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/worker test src/build-index-snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual build against the DB**

Run: `DATABASE_URL=... pnpm --filter @oper/worker exec tsx src/build-index-snapshot.ts`
Expected: log `index snapshot built ... metros: 12`; `SELECT metro_slug, pct_clearing FROM index_snapshots WHERE month=date_trunc('month',now()) ORDER BY pct_clearing DESC;` returns rows.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/build-index-snapshot.ts apps/worker/src/build-index-snapshot.test.ts
git commit -m "feat(index): monthly snapshot builder (per-metro 1% clearing share)"
```

---

## Task 5: `/api/index` route

**Files:**
- Create: `apps/one/src/app/api/index/route.ts`
- Test: `apps/one/src/app/api/index/route.test.ts`

**Interfaces:**
- Consumes: `rankSnapshots`, `SnapshotRow` from `@oper/primitives`; `pool`.
- Produces: `GET()` → `{ month: string, rows: RankedRow[] }` (latest month, ranked, with momentum vs prior). Exported pure `toSnapshotRows(dbRows): SnapshotRow[]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/app/api/index/route.test.ts
import { describe, it, expect } from 'vitest';
import { toSnapshotRows } from './route';

describe('toSnapshotRows', () => {
  it('maps DB rows to the primitive SnapshotRow shape', () => {
    const rows = toSnapshotRows([
      { metro_slug: 'houston', metro_label: 'Houston', pct_clearing: '0.55', median_ratio: '0.011', live_count: '200' },
    ]);
    expect(rows[0]).toEqual({ metroSlug: 'houston', metroLabel: 'Houston', pctClearing: 0.55, medianRatio: 0.011, liveCount: 200 });
  });
  it('preserves a null median ratio', () => {
    expect(toSnapshotRows([{ metro_slug: 'x', metro_label: 'X', pct_clearing: '0', median_ratio: null, live_count: '0' }])[0].medianRatio).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/app/api/index/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/app/api/index/route.ts
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { rankSnapshots, type SnapshotRow } from '@oper/primitives';

export const revalidate = 3600; // ISR: refresh hourly

export function toSnapshotRows(dbRows: Array<Record<string, unknown>>): SnapshotRow[] {
  return dbRows.map((r) => ({
    metroSlug: String(r.metro_slug),
    metroLabel: String(r.metro_label),
    pctClearing: Number(r.pct_clearing),
    medianRatio: r.median_ratio != null ? Number(r.median_ratio) : null,
    liveCount: Number(r.live_count),
  }));
}

export async function GET() {
  try {
    const latest = await pool.query(`SELECT max(month) AS m FROM index_snapshots`);
    const month: string | null = latest.rows[0]?.m ? new Date(latest.rows[0].m).toISOString().slice(0, 10) : null;
    if (!month) return NextResponse.json({ month: null, rows: [] });
    const [cur, prior] = await Promise.all([
      pool.query(`SELECT * FROM index_snapshots WHERE month = $1`, [month]),
      pool.query(`SELECT * FROM index_snapshots WHERE month = ($1::date - interval '1 month')`, [month]),
    ]);
    const rows = rankSnapshots(toSnapshotRows(cur.rows), toSnapshotRows(prior.rows));
    return NextResponse.json({ month, rows });
  } catch (err) {
    console.error('/api/index error:', err);
    return NextResponse.json({ month: null, rows: [] }, { status: 200 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/app/api/index/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/app/api/index/route.ts apps/one/src/app/api/index/route.test.ts
git commit -m "feat(index): /api/index — latest ranked snapshot + momentum"
```

---

## Task 6: Public index page + OG cards

**Files:**
- Create: `apps/one/src/app/the-1-percent-index/page.tsx`
- Create: `apps/one/src/app/the-1-percent-index/opengraph-image.tsx`
- Create: `apps/one/src/app/the-1-percent-index/[metro]/opengraph-image.tsx`

**Interfaces:**
- Consumes: `/api/index` (server-side fetch or direct `pool` in the RSC); `INDEX_METROS` (Task 2); the existing OG helpers/pattern in `apps/one/src/app/property/[id]/opengraph-image.tsx`.

- [ ] **Step 1: Build the page (server component, ISR, ranked table with per-metro CTA)**

```tsx
// apps/one/src/app/the-1-percent-index/page.tsx
import Link from 'next/link';
import type { Metadata } from 'next';
import { rankSnapshots } from '@oper/primitives';
import { toSnapshotRows } from '@/app/api/index/route';
import { indexMetroBySlug } from '@/lib/index-metros';
import pool from '@/lib/db';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'The 1% Rule Index — where rentals still cash-flow',
  description: 'A monthly ranking of U.S. metros by the share of for-sale listings whose estimated rent clears the 1% rule.',
  openGraph: { title: 'The 1% Rule Index', type: 'website' },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/the-1-percent-index' },
};

const pct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

export default async function IndexPage() {
  const latest = await pool.query(`SELECT max(month) AS m FROM index_snapshots`);
  const month: string | null = latest.rows[0]?.m ? new Date(latest.rows[0].m).toISOString().slice(0, 10) : null;
  let rows: ReturnType<typeof rankSnapshots> = [];
  if (month) {
    const [cur, prior] = await Promise.all([
      pool.query(`SELECT * FROM index_snapshots WHERE month = $1`, [month]),
      pool.query(`SELECT * FROM index_snapshots WHERE month = ($1::date - interval '1 month')`, [month]),
    ]);
    rows = rankSnapshots(toSnapshotRows(cur.rows), toSnapshotRows(prior.rows));
  }
  const asOf = month ? new Date(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';

  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="prov">The 1% Rule Index · {asOf}</p>
      <h1 className="mt-2 font-sans text-3xl font-semibold tracking-[-0.02em] sm:text-4xl" style={{ color: 'var(--text)' }}>
        Where the 1% rule still clears
      </h1>
      <p className="mt-3 text-[15px]" style={{ color: 'var(--haze)' }}>
        Share of live for-sale listings whose estimated rent is at least 1% of price, by metro. Updated monthly.
      </p>
      <ol className="mt-8 divide-y" style={{ borderColor: 'var(--line)' }}>
        {rows.map((r) => (
          <li key={r.metroSlug} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="figure w-6 text-right" style={{ color: 'var(--mute)' }}>{r.rank}</span>
              <Link href={`/search?zip=${indexMetroBySlug(r.metroSlug)?.repZip ?? ''}`} className="text-[15px] underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>
                {r.metroLabel}
              </Link>
            </div>
            <div className="flex items-center gap-4">
              {r.momentum != null && (
                <span className="text-[12px]" style={{ color: r.momentum >= 0 ? 'var(--pass)' : 'var(--brass)' }}>
                  {r.momentum >= 0 ? '▲' : '▼'} {pct.format(Math.abs(r.momentum))}
                </span>
              )}
              <span className="figure figure--pass text-[18px]">{pct.format(r.pctClearing)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="prov mt-8">
        Method: rent estimates triangulated from HUD SAFMR, scraped comps, and ML; a listing “clears” when est. rent ÷ price ≥ 1%.
        <Link href="/search" className="ml-1 underline">Find clearing deals →</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: National OG card** — model it on `apps/one/src/app/property/[id]/opengraph-image.tsx` (same `ImageResponse` import, `size`, `contentType`). Render the headline “The 1% Rule Index”, the as-of month, and the top-3 metros with their `pct_clearing`. Read the data with a direct `pool` query inside the route (OG routes run server-side).

```tsx
// apps/one/src/app/the-1-percent-index/opengraph-image.tsx
import { ImageResponse } from 'next/og';
import pool from '@/lib/db';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'The 1% Rule Index';

export default async function OG() {
  const res = await pool.query(
    `SELECT metro_label, pct_clearing FROM index_snapshots
     WHERE month = (SELECT max(month) FROM index_snapshots)
     ORDER BY pct_clearing DESC LIMIT 3`,
  );
  const top = res.rows as Array<{ metro_label: string; pct_clearing: string }>;
  return new ImageResponse(
    (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#2a2520', color: '#faf7f2', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ fontSize: 28, color: '#9c7a34', letterSpacing: 2 }}>THE 1% RULE INDEX</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 8 }}>Where rentals still cash-flow</div>
        <div style={{ display: 'flex', gap: 48, marginTop: 48 }}>
          {top.map((t) => (
            <div key={t.metro_label} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 30 }}>{t.metro_label}</div>
              <div style={{ fontSize: 56, color: '#0e7a52', fontWeight: 700 }}>{Math.round(Number(t.pct_clearing) * 100)}%</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 3: Per-metro OG card** — `the-1-percent-index/[metro]/opengraph-image.tsx`: same shape, but query the one metro by `metro_slug = params.metro` for the latest month and render its label + `pct_clearing` + rank. (Rank via a windowed query or by counting metros with a higher `pct_clearing`.)

```tsx
// apps/one/src/app/the-1-percent-index/[metro]/opengraph-image.tsx
import { ImageResponse } from 'next/og';
import pool from '@/lib/db';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = '1% Rule Index — metro';

export default async function OG({ params }: { params: { metro: string } }) {
  const res = await pool.query(
    `WITH latest AS (SELECT max(month) m FROM index_snapshots)
     SELECT metro_label, pct_clearing,
            (SELECT count(*)+1 FROM index_snapshots b, latest
              WHERE b.month=latest.m AND b.pct_clearing > a.pct_clearing) AS rank
     FROM index_snapshots a, latest
     WHERE a.month = latest.m AND a.metro_slug = $1`,
    [params.metro],
  );
  const r = res.rows[0] as { metro_label: string; pct_clearing: string; rank: string } | undefined;
  const label = r?.metro_label ?? 'Metro';
  const pct = r ? Math.round(Number(r.pct_clearing) * 100) : 0;
  return new ImageResponse(
    (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#2a2520', color: '#faf7f2', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ fontSize: 26, color: '#9c7a34', letterSpacing: 2 }}>THE 1% RULE INDEX · #{r?.rank ?? '—'}</div>
        <div style={{ fontSize: 72, fontWeight: 700, marginTop: 8 }}>{label}</div>
        <div style={{ fontSize: 96, color: '#0e7a52', fontWeight: 700 }}>{pct}%</div>
        <div style={{ fontSize: 28, color: '#b8b0a0' }}>of listings clear the 1% rule</div>
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 4: Typecheck + manual**

Run: `pnpm --filter @oper/one typecheck` → PASS.
Manual: `pnpm --filter @oper/one dev`, open `/the-1-percent-index` → ranked list with momentum arrows and per-metro CTAs; hit `/the-1-percent-index/opengraph-image` and `/the-1-percent-index/houston/opengraph-image` → PNG renders.

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/app/the-1-percent-index/
git commit -m "feat(index): public 1% Rule Index page + national/per-metro OG cards"
```

---

## Task 7: Monthly email + timer

**Files:**
- Modify: `apps/worker/src/digest.ts`
- Create: `ops/systemd/oper-index-snapshot.service`, `ops/systemd/oper-index-snapshot.timer`

**Interfaces:**
- Consumes: the existing digest send path + opt-in/unsubscribe/caps in `digest.ts`; `index_snapshots`.

- [ ] **Step 1: Read the existing digest patterns**

Read `apps/worker/src/digest.ts` end to end: how it selects opt-in recipients, the 1-email/user/day cap, unsubscribe token/footer, and the Resend send helper. The index email MUST reuse these — do not add a second sender or a second unsubscribe scheme.

- [ ] **Step 2: Add a `sendIndexEmailIfDue()` path** that, once per month (guard via a `digest_runs`-style dedupe key `index-YYYY-MM`), builds a small HTML table of the top-10 metros from the latest `index_snapshots` month (reuse the same ranked query as `/api/index`) and sends it through the existing send helper to the same opted-in audience, with the standard unsubscribe footer and the index page as the single CTA. Gate the whole thing behind the existing opt-in check.

Pure helper to unit-test (add `apps/worker/src/index-email.test.ts`):

```ts
// apps/worker/src/index-email.ts  (new small pure module imported by digest.ts)
export function indexEmailHtml(rows: { metroLabel: string; pctClearing: number; rank: number }[], asOf: string, unsubUrl: string, indexUrl: string): string {
  const items = rows.slice(0, 10).map((r) =>
    `<tr><td>${r.rank}</td><td>${r.metroLabel}</td><td style="text-align:right">${Math.round(r.pctClearing * 100)}%</td></tr>`).join('');
  return `<h2>The 1% Rule Index — ${asOf}</h2>
    <table>${items}</table>
    <p><a href="${indexUrl}">See the full index →</a></p>
    <p style="color:#888;font-size:12px"><a href="${unsubUrl}">Unsubscribe</a></p>`;
}
```

```ts
// apps/worker/src/index-email.test.ts
import { describe, it, expect } from 'vitest';
import { indexEmailHtml } from './index-email';
describe('indexEmailHtml', () => {
  it('renders the top rows, the index CTA, and the unsubscribe link', () => {
    const html = indexEmailHtml(
      [{ metroLabel: 'Houston', pctClearing: 0.55, rank: 1 }], 'July 2026',
      'https://octavo.press/u/abc', 'https://octavo.press/the-1-percent-index');
    expect(html).toContain('Houston');
    expect(html).toContain('55%');
    expect(html).toContain('the-1-percent-index');
    expect(html).toContain('/u/abc');
  });
});
```

Run: `pnpm --filter @oper/worker test src/index-email.test.ts` → PASS. Then wire `indexEmailHtml` into `digest.ts`'s monthly path using its existing recipient loop + send helper.

- [ ] **Step 3: Timer to build the snapshot monthly** (build runs before the email; email is part of the daily digest tick which no-ops until the monthly key is unset)

```ini
# ops/systemd/oper-index-snapshot.service
[Unit]
Description=OnePercent — build monthly 1% Rule Index snapshot
After=oper-postgres.service
Requires=oper-postgres.service
[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/onepercent
EnvironmentFile=/etc/oper.env
EnvironmentFile=-/etc/oper-role-worker.env
ExecStart=/opt/onepercent/apps/worker/node_modules/.bin/tsx apps/worker/src/build-index-snapshot.ts
```

```ini
# ops/systemd/oper-index-snapshot.timer
[Unit]
Description=Run the 1% Rule Index builder monthly
[Timer]
OnCalendar=*-*-01 09:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

> **tsx, not `node dist`:** the builder + digest import TS-only workspace code; run via the tsx bin directly (a `#!/bin/sh` shim) exactly like `oper-worker-digest.service`. Do not wrap tsx in `node` and do not use `node --import tsx` (tsx is not hoisted to the repo root).

- [ ] **Step 4: Install + verify on server** (deploy step, not a unit test)

```
scp ops/systemd/oper-index-snapshot.{service,timer} root@SERVER:/etc/systemd/system/
ssh root@SERVER 'systemctl daemon-reload && systemctl enable --now oper-index-snapshot.timer && systemctl start oper-index-snapshot.service'
ssh root@SERVER "sudo -u postgres psql -tA -d postgres -c \"SELECT count(*) FROM index_snapshots WHERE month=date_trunc('month',now())::date;\""
```
Expected: the count equals the number of metros (12).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index-email.ts apps/worker/src/index-email.test.ts apps/worker/src/digest.ts ops/systemd/oper-index-snapshot.service ops/systemd/oper-index-snapshot.timer
git commit -m "feat(index): monthly State-of-the-1%-Rule email + snapshot timer"
```

---

## Self-Review

**Spec coverage:** monthly snapshotted per-metro index (Tasks 1, 4) · authority page (Task 6) · shareable national + per-metro OG cards (Task 6) · momentum for repeat-share value (Tasks 3, 5, 6) · monthly email reusing the digest machinery (Task 7) · every artifact routes back to Search (`/search?zip=repZip` CTAs, index-page + email CTAs). The "embeddable badge" from the goal is intentionally deferred (YAGNI until the page has traffic); it is a thin wrapper over the per-metro OG card and can be a fast-follow.

**Placeholder scan:** each step carries real SQL/TS/TSX and exact commands. The one migration filename date (`2026_07_XX`) follows the repo's existing convention and is resolved at authoring time. The digest wiring (Task 7 Step 2) references the existing `digest.ts` patterns rather than reprinting them — deliberate, since the constraint is "reuse, don't reprint," and the pure `indexEmailHtml` it depends on is fully specified + tested.

**Type consistency:** `SnapshotRow`/`RankedRow` are defined once in `@oper/primitives` (Task 3) and consumed unchanged by `/api/index` (Task 5) and the page (Task 6). `toSnapshotRows` is defined in Task 5 and imported by the page in Task 6 (same signature). `INDEX_METROS`/`IndexMetro` appear in both apps/one (Task 2) and the worker (Task 4) — the duplication is called out explicitly with a sync note, because the two apps share no runtime package for it.
