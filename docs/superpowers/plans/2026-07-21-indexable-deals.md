# Indexable Deals — Programmatic SEO + Shareable Deal Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product has an excellent 450K-deal dataset and a professional deal page — and almost no way to be found. Organic search is the only zero-cost growth lever a self-hosted product has, and it is 90% built but unfinished: the primary unit (`/property/[id]`, 450K pages) has **no `generateMetadata`**, so every shared or crawled deal link renders the generic site title and description (`sold/[id]` already has per-page metadata — property does not); the sitemap caps at **2000 market ZIPs of 21,466** and lists **zero** property, sold, or index pages; there is **no `robots.ts`** advertising the sitemap or fencing private routes; and the deal page's share control does not produce a rich link. This plan finishes the organic-discovery surface: per-property metadata + canonical, a paginated sitemap index covering every market + prioritized deals, a real robots policy, and a Web Share affordance that spreads the deal headline.

**Architecture:** `generateMetadata` on `/property/[id]` reuses the existing `getProperty(id)` server action (the page already loads it) and mirrors the working `sold/[id]` pattern, enriched with the deal headline (price · beds · ratio · city) + canonical + OG title/description; the co-located `opengraph-image.tsx` already renders the card image, so metadata only supplies text. The single `sitemap.ts` becomes a Next sitemap **index** (`generateSitemaps`) with one child per content class — all markets (uncapped), sold, the-1-percent-index metros, and property pages paginated at 45k URLs/file, ordered by deal quality + freshness so the best deals index first. `robots.ts` emits the policy + `Sitemap:` directive. The deal page's existing share button gains `navigator.share` with a text/URL payload (graceful clipboard fallback). JSON-LD already ships (`<Schema kind="RealEstateListing">`) — Task 1 only verifies/enriches it, does not add it.

**Tech Stack:** Next 16 App Router metadata API (`generateMetadata`, `generateSitemaps`, `MetadataRoute.Robots`), the existing `getProperty`/`getSoldListing` actions + `pool` for sitemap queries, `@oper/primitives` `Schema`, Vitest.

## Global Constraints

- **No listing/user data mutation.** This is a read + metadata plan only — no migrations, no writes.
- **Never index private surfaces.** `robots.ts` must `Disallow` `/account`, `/settings`, `/shelf`, `/welcome`, `/api/`, `/admin`, and every authenticated route; only public content (`/`, `/search`, `/market/*`, `/property/*`, `/sold/*`, `/the-1-percent-index*`, `/playbook*`, `/pricing`) is indexable.
- **Canonical is absolute and self-referential:** `https://one.octavo.press/property/<id>` (via `NEXT_PUBLIC_SITE_URL`), never a query-string variant, so paginated/filtered views don't split rank.
- **Sitemap URL cap:** ≤ 50,000 URLs and ≤ 50MB per sitemap file (protocol limit) — paginate property pages under that with margin (45k).
- **No fabricated metadata:** a property with no address/price falls back to a generic-but-valid title (mirror `sold/[id]`'s try/catch), never a broken interpolation ("$NaN · undefined bd").
- **Deal headline copy is honest:** the title states the modeled ratio as "~1.1%" (tilde = estimate), never an unqualified promise. Reuses the ratio the page already computes.
- **Design/tokens unchanged** — this plan adds no visible chrome except wiring the existing share button.
- **Tests:** `pnpm --filter @oper/one test <path>`; typecheck `pnpm --filter @oper/one exec tsc --noEmit`.

## Current State (verified 2026-07-20 on prod + code)

- `/property/[id]/page.tsx`: loads via `getProperty(id)` server action; renders `<Schema kind="RealEstateListing" data={buildSchemaData(...)} />` (line 139) — JSON-LD is **already present**. **No `generateMetadata` export** → title is the root layout default for all 450K pages. `opengraph-image.tsx` exists and renders a per-deal card (reads `id`, fetches `/api/properties?ids=`).
- `/sold/[id]/page.tsx`: **has** `generateMetadata` (title/description via `getSoldListing`) — the pattern to mirror.
- `sitemap.ts`: `force-dynamic`, one flat file; markets query is `… GROUP BY zip_code ORDER BY count(*) DESC LIMIT 2000`; core routes hardcoded. No sold, no property, no index-metro URLs. 21,466 active ZIPs exist; only 2000 emitted.
- No `robots.ts` / `public/robots.txt`. Root layout sets `robots: { index: true, follow: true }` and `metadataBase = NEXT_PUBLIC_SITE_URL`.
- Prod counts: 450,904 active listings; 21,466 active ZIPs; 43,139 sold; the-1-percent-index has 8 metros (`METROS`).
- Deal page top bar has a share button (visible in the mobile header) — currently not wired to `navigator.share`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/app/property/[id]/page.tsx` (modify) | Add `generateMetadata` (title/desc/canonical/OG). |
| `apps/one/src/app/property/[id]/metadata.test.ts` (create) | Unit-test the title/description/canonical builder (pure helper extracted). |
| `apps/one/src/lib/deal-meta.ts` (create) | Pure `buildDealTitle`/`buildDealDescription` from a listing lite shape (shared by page + tested in isolation). |
| `apps/one/src/app/sitemap.ts` (rewrite) | `generateSitemaps` index: markets (uncapped), sold, index-metros, paginated property pages. |
| `apps/one/src/app/robots.ts` (create) | Policy + `Sitemap:` directive. |
| `apps/one/src/components/property/ShareButton.tsx` (create or modify existing control) | `navigator.share` with clipboard fallback. |

---

## Task 1: Per-property metadata

**Files:** create `apps/one/src/lib/deal-meta.ts` + `deal-meta.test.ts`; modify `apps/one/src/app/property/[id]/page.tsx`.

- [ ] **Step 1: Failing tests** (`deal-meta.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildDealTitle, buildDealDescription } from './deal-meta';

const lite = { address: '10562 Windsor Lake Ct, Tampa, FL 33626', city: 'Tampa', state: 'FL',
  price: 245000, rent: 2767, ratioPct: 1.13, beds: 3, baths: 2 };

describe('buildDealTitle', () => {
  it('leads with address + the deal headline', () => {
    expect(buildDealTitle(lite)).toBe(
      '10562 Windsor Lake Ct, Tampa, FL 33626 — $245,000 · 3bd · ~1.1% rule | OnePercent',
    );
  });
  it('omits ratio cleanly when rent is unknown', () => {
    expect(buildDealTitle({ ...lite, rent: null, ratioPct: null })).toBe(
      '10562 Windsor Lake Ct, Tampa, FL 33626 — $245,000 · 3bd | OnePercent',
    );
  });
  it('falls back to a valid generic title with no address', () => {
    expect(buildDealTitle({ ...lite, address: null })).toBe('Rental property deal | OnePercent');
  });
});

describe('buildDealDescription', () => {
  it('states modeled rent + ratio as an estimate', () => {
    expect(buildDealDescription(lite)).toContain('modeled rent $2,767/mo');
    expect(buildDealDescription(lite)).toContain('~1.1% rule');
    expect(buildDealDescription(lite)).toContain('Tampa, FL');
  });
});
```

- [ ] **Step 2: RED → implement `deal-meta.ts`.** Pure functions; `ratioPct` formatted to one decimal with a leading `~`; `$` amounts via `Intl.NumberFormat` (maximumFractionDigits 0); null-safe segment joining (drop empty segments, never render `undefined`/`NaN`). The generic fallback string is exactly `'Rental property deal | OnePercent'`.
- [ ] **Step 3: Add `generateMetadata` to the page.** It awaits `params`, calls `getProperty(id)` (the SAME action the page body uses; Next dedupes the two calls within a request via React `cache` — if `getProperty` is not already wrapped in `cache()`, wrap it so metadata + body share one query), derives the lite shape (address/city/state/price/rent/ratioPct/beds/baths — the page already computes `price`, `rent`, `ratioPct`), and returns:

```ts
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
  try {
    const property = await getProperty(id);
    if (!property) return { title: 'Property not found | OnePercent' };
    const lite = toDealLite(property);          // small local mapper → the deal-meta shape
    const url = `${site}/property/${id}`;
    return {
      title: buildDealTitle(lite),
      description: buildDealDescription(lite),
      alternates: { canonical: url },
      openGraph: { title: buildDealTitle(lite), description: buildDealDescription(lite), url, type: 'website' },
      twitter: { card: 'summary_large_image', title: buildDealTitle(lite), description: buildDealDescription(lite) },
    };
  } catch {
    return { title: 'Rental property deal | OnePercent' };
  }
}
```

(Do not set `openGraph.images` — the co-located `opengraph-image.tsx` supplies it automatically; setting it here would double it.)
- [ ] **Step 4:** `pnpm --filter @oper/one test src/lib/deal-meta.test.ts` green; typecheck; commit — `feat(seo): per-property metadata — title, description, canonical, OG/twitter text`

## Task 2: Sitemap index covering every market + prioritized deals

**Files:** rewrite `apps/one/src/app/sitemap.ts`; test `apps/one/src/app/sitemap.test.ts`.

- [ ] **Step 1: Failing tests** (mock `pool`): `generateSitemaps()` returns an array of `{ id }` sitemap descriptors — one per class (`markets`, `sold`, `index`) plus N property pages given a mocked count (e.g. count = 90,000 → ids `property-0`, `property-1`); `sitemap({ id: 'markets' })` maps mocked ZIP rows to `${SITE}/market/<zip>` entries with NO 2000 cap in the query text; `sitemap({ id: 'property-0' })` queries with `LIMIT 45000 OFFSET 0` ordered by the deal-quality expression and lifecycle-filtered; unknown id → `[]`.
- [ ] **Step 2: RED → implement.** Export `generateSitemaps()` computing property-page shard count from `SELECT count(*) FROM listings WHERE listing_status NOT IN ('sold','stale','rental_misfiled') AND listing_type='for_sale'` (ceil / 45000). `sitemap({ id })` switches:
  - `markets`: `SELECT DISTINCT zip_code … WHERE listing_status NOT IN ('sold','stale','rental_misfiled') AND zip_code ~ '^\d{5}$'` (no LIMIT) + the hardcoded core routes.
  - `sold`: `SELECT id FROM listings WHERE listing_status='sold' ORDER BY sold_date DESC NULLS LAST LIMIT 45000` → `/sold/<id>`.
  - `index`: the 8 `METROS` slugs → `/the-1-percent-index/<slug>` + `/the-1-percent-index`.
  - `property-<n>`: `… WHERE listing_status NOT IN (...) AND listing_type='for_sale' ORDER BY (rent_price_ratio IS NOT NULL) DESC, rent_price_ratio DESC NULLS LAST, last_seen_at DESC LIMIT 45000 OFFSET <n*45000>` → `/property/<id>` with `changeFrequency: 'daily'`, `priority` scaled by ratio (1%+ → 0.9, else 0.6). Keep `force-dynamic` + `revalidate = 3600`.
- [ ] **Step 3:** Guard: each `sitemap()` call wraps its query in try/catch returning `[]` (a missing DB during build must not 500 the sitemap — preserve the current resilience). Test green; typecheck; commit — `feat(seo): sitemap index — all markets, sold, index metros, prioritized deal pages`

## Task 3: robots policy

**Files:** create `apps/one/src/app/robots.ts`; test `apps/one/src/app/robots.test.ts`.

- [ ] **Step 1: Failing test:** `robots()` returns `rules` allowing `/` and disallowing each private prefix (`/api/`, `/account`, `/settings`, `/shelf`, `/welcome`, `/admin`); `sitemap` equals `${SITE}/sitemap.xml`; `host` equals the site host.
- [ ] **Step 2: RED → implement:**

```ts
import type { MetadataRoute } from 'next';
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/settings', '/shelf', '/welcome', '/admin'],
    }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
```

- [ ] **Step 3:** Test green; typecheck; commit — `feat(seo): robots.ts — advertise sitemap, fence private + api routes`

## Task 4: Shareable deal link

**Files:** create/modify the deal-page share control (`apps/one/src/components/property/ShareButton.tsx`); wire it in the property header (`MenuHeader`/`StickyTabNav` — locate the existing button in Step 1); test `ShareButton.test.tsx`.

- [ ] **Step 1: Locate** the current share button (grep `share` under `apps/one/src/components/property`). If it is inert markup, replace it with `<ShareButton title=… url=… />`.
- [ ] **Step 2: Failing test** (jsdom): clicking calls `navigator.share({ title, text, url })` when present; when `navigator.share` is undefined, it writes `url` to `navigator.clipboard.writeText` and flips to a "Copied" state for ~2s; a `navigator.share` rejection (user cancels) is swallowed (no thrown error, no "Copied" flash).
- [ ] **Step 3: RED → implement** `ShareButton` (client). `text` = the deal headline (reuse `buildDealTitle`'s lite → but pass a prebuilt string prop so the component stays pure/presentational). Absolute `url` from `NEXT_PUBLIC_SITE_URL`.
- [ ] **Step 4:** Test green; typecheck; commit — `feat(share): deal pages use Web Share with clipboard fallback`

## Task 5: Deploy + discovery proof

- [ ] **Step 1:** `bash ops/systemd/deploy-systemd.sh app` (rebuilds one; sitemap/robots/metadata are server-rendered — no worker involved).
- [ ] **Step 2: Metadata proof:** `curl -s https://one.octavo.press/property/877 | grep -o '<title>[^<]*</title>'` shows the deal headline (not the generic site title); the page has `<link rel="canonical" href="https://one.octavo.press/property/877">` and `og:title`/`twitter:card` with the deal text; `/property/877` still renders the JSON-LD `<script type="application/ld+json">`.
- [ ] **Step 3: Sitemap proof:** `curl -s https://one.octavo.press/sitemap.xml` returns a `<sitemapindex>` with children; `…/sitemap/markets.xml` (or the Next child URL form) lists > 2000 `/market/` URLs; a `property-0` child lists `/property/` URLs; `curl -s https://one.octavo.press/robots.txt` shows the disallows + `Sitemap:` line. Validate with Google's Rich Results test URL for one property page (note the pass in the proof).
- [ ] **Step 4: Share proof:** on the deal page (desktop + mobile emulation) the share button invokes the share sheet / copies the absolute URL; pasting the copied link in a preview-capable client shows the per-deal OG card (image + deal title).
- [ ] **Step 5: No-regression:** private routes (`/account`, `/shelf`) return `Disallow` in robots; `pnpm --filter @oper/one test` green in CI; homepage/search unaffected.

## Self-Review

**Spec coverage:** the 450K primary pages become individually titled/canonical/shareable (T1) · discovery surface expands from 2000 to every market + prioritized deals + sold + index (T2) · crawlers get a real policy pointing at the sitemap and fenced from private data (T3) · the viral share loop produces a rich link (T4) · deployed with metadata/sitemap/robots/share proofs (T5). JSON-LD already shipped — verified, not rebuilt. Covered.

**Placeholder scan:** every task names exact files with complete code or exact query shapes; the one locate-at-execution item (existing share button) has a grep target and a concrete replacement.

**Type consistency:** `buildDealTitle`/`buildDealDescription` consume one `DealLite` shape defined in `deal-meta.ts` and reused by `generateMetadata` (via `toDealLite`) and `ShareButton`'s title prop; `generateSitemaps`/`sitemap({id})` follow Next's `MetadataRoute.Sitemap` types; `robots()` returns `MetadataRoute.Robots`. No cross-task drift.
