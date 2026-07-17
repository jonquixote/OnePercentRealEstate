# Local-First Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "near you" true. Today the geo path is dead code — the site is self-hosted behind nginx, so the `x-vercel-*` headers `metroFromHeaders` reads never exist and every visitor gets the Houston default. This plan injects real GeoIP headers at nginx, teaches the geo lib our own header names, starts the hero carousel on the visitor's metro (then tours the rest), and replaces the markets grid's 22-second cold aggregation with a worker-refreshed materialized view so the homepage is fast from the very first request.

**Architecture:** nginx's `geoip2` module + the key-free DB-IP Lite mmdb resolve the client IP at the edge and inject `x-geo-latitude`/`x-geo-longitude`/`x-geo-city` into every proxied request. `metroFromHeaders` prefers those headers (keeping `x-vercel-*` as fallback so Vercel previews still work). `useMetroRotation` gains a `startIndex` so the shuffled tour begins at the nearest metro. `/api/markets` reads a new `mv_market_grid` materialized view maintained by the existing worker refresh loop — the in-process TTL cache stays as a belt, but the 22s prime disappears.

**Tech Stack:** nginx 1.28.3 (Ubuntu) + `libnginx-mod-http-geoip2` (apt, verified available) + DB-IP City Lite mmdb (free, no account); Next 16 App Router (apps/one); Postgres matview + `apps/worker` refresh loop (same pattern as `mv_cluster_tiles`); Vitest.

## Global Constraints

- **Never trust client-supplied geo:** nginx must *unconditionally overwrite* the `x-geo-*` headers on every proxied request (set them even when the lookup fails — empty value), so a client can never spoof its way to a different metro. `metroFromHeaders` treats empty/malformed as "no geo".
- **Vercel-preview compatibility:** `x-vercel-ip-latitude/longitude` remain a fallback — `x-geo-*` wins when both exist.
- **Graceful degradation:** no mmdb / module missing / lookup miss ⇒ exactly today's behavior (DEFAULT_METRO). Nothing may 500 because geo is absent.
- **Privacy:** we only derive coarse city-level coordinates; the raw client IP is never written to any table or log line by this feature.
- **Matview freshness:** the markets grid may be up to ~30 min stale (market medians move daily; this is fine) but must never block a request on refresh (`REFRESH ... CONCURRENTLY`, worker-side).
- **Migrations:** repo convention — file in `infrastructure/migrations/`, runner records version; matview needs a unique index to allow CONCURRENTLY.
- **Tests:** `pnpm --filter @oper/one test <path>`, `pnpm --filter @oper/worker test <path>`; TSX tests carry `// @vitest-environment jsdom`.
- **Design/copy:** no visual changes beyond the hero starting on the local metro; keep all existing carousel behavior (6s tour, pause, pin, reduced-motion) intact.

## Execution Notes (validated against `docs/local-first-plan` @ 58f7547)

- **Worker file is `apps/worker/src/refresh-clusters.ts`** (NOT `refresh.ts`). The matview refresh lives there; the `worker-refresh` docker service in compose maps to the systemd unit `oper-worker-refresh.service`.
- **nginx snippet goes in ALL THREE proxied locations** of `ops/nginx/sites/one.uctavo.press` (`/api/auth/`, `/api/`, `/`) — each already `include /etc/nginx/snippets/proxy-params.conf;`. Add `include /etc/nginx/snippets/geo-headers.conf;` in all three. Deploy the snippet to `/etc/nginx/snippets/geo-headers.conf`.
- **Prod is systemd, NOT docker** (the docker-compose stack is dormant). Deploy = `psql` the migration → `pnpm --filter @oper/one build && systemctl restart oper-app.service` → `pnpm --filter @oper/worker build && systemctl restart oper-worker-refresh.service` → nginx runbook. Ignore `infrastructure/deploy.sh` (docker-only).
- **MV refresh = own 30-min unconditional timer** in `refresh-clusters.ts`. Do NOT reuse the `tilesInputChanged` high-water gate (that's for tiles, which only change on inserts/price edits). Add a separate `setInterval(~30min)` refreshing `mv_market_grid CONCURRENTLY`, own try/catch, warn-only on `42P01`.

## Current State (verified 2026-07-16/17 on prod)

- nginx 1.28.3, module **not** installed; `apt-cache policy libnginx-mod-http-geoip2` → candidate `1:3.4-7build3`. Proxy blocks for one.octavo.press pass to `127.0.0.1:3001` (`/etc/nginx/sites-enabled/one.octavo.press`).
- `apps/one/src/lib/geo.ts`: `metroFromHeaders` reads only `x-vercel-ip-latitude/longitude` → always `DEFAULT_METRO` (Houston) in prod.
- `FirstDealHero` + `useMetroRotation` (shipped 2026-07-16): shuffled tour of all 8 metros, `pin()`, `setPaused()`; hook signature `useMetroRotation(count, { intervalMs?, reduceMotion? })`.
- `/api/spotlight?all=1` returns `{ metros: SpotlightEntry[] }` in `METROS` order; single-metro `GET` resolves `?zip=` then `metroFromHeaders`.
- `/api/markets`: ~22s aggregation over ~1M listings on cache miss (15-min in-process TTL, stale-while-revalidate). The SQL lives in the route.
- Worker refresh pattern: `apps/worker/src/refresh.ts` periodically runs `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_tiles` (unit `oper-worker-refresh`). Follow that file's actual structure when extending.

## File Structure

| File | Responsibility |
|---|---|
| `ops/nginx/geoip2.conf` (create) | Module config: mmdb path, `map` lookups, variables. Deployed to `/etc/nginx/conf.d/`. |
| `ops/nginx/snippets/geo-headers.conf` (create) | The three `proxy_set_header x-geo-*` lines, included in every app `location`. |
| `ops/scraper-node/../..` — no scraper changes. | |
| `apps/one/src/lib/geo.ts` (modify) | Prefer `x-geo-latitude/longitude`; fallback `x-vercel-*`; else DEFAULT_METRO. |
| `apps/one/src/lib/geo.test.ts` (modify) | New header-precedence cases. |
| `apps/one/src/components/home/useMetroRotation.ts` (modify) | `startIndex` option — tour begins there, still shuffled after. |
| `apps/one/src/components/home/useMetroRotation.test.ts` (modify) | startIndex cases. |
| `apps/one/src/components/home/FirstDealHero.tsx` (modify) | Fetch `/api/spotlight` (single, geo-resolved) alongside `?all=1`; start the tour on the nearest metro. |
| `apps/one/src/components/home/FirstDealHero.test.tsx` (modify) | Local-start case. |
| `infrastructure/migrations/2026_07_17_mv_market_grid.sql` (create) | The matview + unique index. |
| `apps/one/src/app/api/markets/route.ts` (modify) | Read the matview (fallback to live aggregation if mv missing). |
| `apps/worker/src/refresh-clusters.ts` (modify) | Add `mv_market_grid` to a new 30-min unconditional refresh timer (do NOT reuse the tiles high-water gate). |

---

## Task 1: nginx GeoIP2 headers (infra files + deploy runbook)

**Files:**
- Create: `ops/nginx/geoip2.conf`
- Create: `ops/nginx/snippets/geo-headers.conf`
- Modify: `ops/nginx/README.md` (create if absent — deploy runbook section)

No unit tests (nginx config); Step 4 is the live verification. **Scope boundary:** creating these repo files + runbook is the task; executing the server steps happens at deploy (controller/operator).

- [ ] **Step 1: `ops/nginx/geoip2.conf`**

```nginx
# GeoIP2 city lookups for "near you" features. Deployed to /etc/nginx/conf.d/.
# DB: DB-IP City Lite (free, no account, CC-BY 4.0) — monthly refresh via the
# runbook. All lookups are best-effort: variables default to "" on miss and
# the app treats "" as no-geo (falls back to its default metro).
geoip2 /var/lib/geoip/dbip-city-lite.mmdb {
    auto_reload 24h;
    $geoip2_lat  location latitude;
    $geoip2_lng  location longitude;
    $geoip2_city city names en;
}
```

- [ ] **Step 2: `ops/nginx/snippets/geo-headers.conf`**

```nginx
# Include inside every proxied `location` for the consumer app.
# ALWAYS set (even empty) so a client-supplied x-geo-* header can never
# pass through: proxy_set_header overwrites the inbound value.
proxy_set_header x-geo-latitude  $geoip2_lat;
proxy_set_header x-geo-longitude $geoip2_lng;
proxy_set_header x-geo-city      $geoip2_city;
```

- [ ] **Step 3: Runbook (`ops/nginx/README.md`, append a `## GeoIP headers` section)**

```
apt-get install -y libnginx-mod-http-geoip2       # loads via /etc/nginx/modules-enabled
mkdir -p /var/lib/geoip
curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$(date +%Y-%m).mmdb.gz" \
  | gunzip > /var/lib/geoip/dbip-city-lite.mmdb
install -m644 ops/nginx/geoip2.conf /etc/nginx/conf.d/geoip2.conf
install -m644 ops/nginx/snippets/geo-headers.conf /etc/nginx/snippets/geo-headers.conf
# In /etc/nginx/sites-enabled/one.octavo.press: add `include snippets/geo-headers.conf;`
# inside each `location` that proxy_passes to 127.0.0.1:3001.
nginx -t && systemctl reload nginx
# Verify (from any box): curl -s https://one.octavo.press/api/spotlight | jq .metro
#   → from a non-Houston IP the label should change once Task 2 ships.
# Monthly refresh: re-run the curl|gunzip line (or add a systemd timer later).
```

- [ ] **Step 4: Commit**

```bash
git add ops/nginx/geoip2.conf ops/nginx/snippets/geo-headers.conf ops/nginx/README.md
git commit -m "feat(infra): nginx geoip2 x-geo-* headers (DB-IP Lite, spoof-proof overwrite)"
```

---

## Task 2: `metroFromHeaders` reads `x-geo-*` first

**Files:**
- Modify: `apps/one/src/lib/geo.ts`
- Modify: `apps/one/src/lib/geo.test.ts`

**Interfaces:**
- `metroFromHeaders(h: Headers): Metro` — unchanged signature. Precedence: valid `x-geo-latitude`/`x-geo-longitude` → `nearestMetro`; else valid `x-vercel-ip-latitude`/`-longitude` → `nearestMetro`; else `DEFAULT_METRO`. "Valid" = both finite and not both zero.

- [ ] **Step 1: Write the failing tests** (append)

```ts
// apps/one/src/lib/geo.test.ts (add)
  it('prefers x-geo-* (nginx) over x-vercel-*', () => {
    const m = metroFromHeaders(H({
      'x-geo-latitude': '41.49', 'x-geo-longitude': '-81.69',          // Cleveland
      'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36', // Houston
    }));
    expect(m.label).toBe('Cleveland');
  });
  it('empty x-geo values fall through to x-vercel', () => {
    const m = metroFromHeaders(H({
      'x-geo-latitude': '', 'x-geo-longitude': '',
      'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36',
    }));
    expect(m.label).toBe('Houston');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/geo.test.ts`
Expected: FAIL (both new cases).

- [ ] **Step 3: Implement**

```ts
// apps/one/src/lib/geo.ts
import { DEFAULT_METRO, nearestMetro, type Metro } from './metros';

function coordsFrom(h: Headers, latKey: string, lngKey: string): { lat: number; lng: number } | null {
  const lat = Number(h.get(latKey));
  const lng = Number(h.get(lngKey));
  // h.get() → null or '' both become NaN/0; require finite and not the 0,0 null island.
  if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) && h.get(latKey) !== '' && h.get(latKey) !== null) {
    return { lat, lng };
  }
  return null;
}

export function metroFromHeaders(h: Headers): Metro {
  // nginx-injected (self-hosted prod; spoof-proof — nginx overwrites inbound
  // values) first, Vercel edge headers (preview deploys) second.
  const geo = coordsFrom(h, 'x-geo-latitude', 'x-geo-longitude')
    ?? coordsFrom(h, 'x-vercel-ip-latitude', 'x-vercel-ip-longitude');
  return geo ? nearestMetro(geo.lat, geo.lng) : DEFAULT_METRO;
}
```

- [ ] **Step 4: Run to verify it passes** (all geo tests, old + new)

Run: `pnpm --filter @oper/one test src/lib/geo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/geo.ts apps/one/src/lib/geo.test.ts
git commit -m "feat(home): metroFromHeaders prefers nginx x-geo-* headers (vercel fallback)"
```

---

## Task 3: Carousel starts on the visitor's metro

**Files:**
- Modify: `apps/one/src/components/home/useMetroRotation.ts` (+ its test)
- Modify: `apps/one/src/components/home/FirstDealHero.tsx` (+ its test)

**Interfaces:**
- `useMetroRotation(count, opts?)` gains `opts.startIndex?: number` — the entry index that must come FIRST in the tour; the rest stay shuffled after it. Default: current behavior.
- `FirstDealHero` fetches `/api/spotlight` (no params — geo headers flow through nginx server-side? **No** — this is a client fetch, so the request carries the BROWSER's IP through nginx and gets that visitor's geo headers injected on the way to the app. Exactly what we want) in parallel with `?all=1`, finds that metro's index among the entries, and passes it as `startIndex`.

- [ ] **Step 1: Failing hook test** (append to `useMetroRotation.test.ts`)

```ts
  it('startIndex leads the tour; remaining entries still all appear', () => {
    const { result } = renderHook(() => useMetroRotation(4, { intervalMs: 6000, startIndex: 2 }));
    expect(result.current.order[result.current.index]).toBe(2);
    const seen = new Set<number>();
    for (let k = 0; k < 4; k++) {
      seen.add(result.current.order[result.current.index]);
      act(() => { vi.advanceTimersByTime(6000); });
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
```

- [ ] **Step 2: Failing hero test** (append to `FirstDealHero.test.tsx`; the fetch stub must answer the geo call with Cleveland)

```tsx
  it('starts the tour on the geo-resolved metro', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      ({ ok: true, json: async () => (String(url).includes('all=1')
        ? ALL
        : { metro: { label: 'Cleveland', zip: '44102' }, deal: ALL.metros[1].deal }) }) as Response);
    render(<FirstDealHero />);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(document.querySelector('h2 em')!.textContent).toBe('Cleveland');
  });
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @oper/one test src/components/home/useMetroRotation.test.ts src/components/home/FirstDealHero.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `useMetroRotation.ts` — accept and apply `startIndex` when building the order:

```ts
export function useMetroRotation(
  count: number,
  opts?: { intervalMs?: number; reduceMotion?: boolean; startIndex?: number },
): Rotation {
  // ...existing intervalMs/reduceMotion...
  const startIndex = opts?.startIndex;
  const order = useMemo(() => {
    const o = shuffle(Math.max(1, count));
    if (startIndex != null && startIndex >= 0 && startIndex < o.length) {
      // Move the requested entry to the front; everything else keeps its
      // shuffled relative order, so the tour still feels random after the
      // local opener.
      o.splice(o.indexOf(startIndex), 1);
      o.unshift(startIndex);
    }
    return o;
  }, [count, startIndex]);
  // ...rest unchanged...
```

In `FirstDealHero.tsx` — resolve the local metro alongside the batch (both fire in parallel; the batch render never waits on geo):

```tsx
  const [startIndex, setStartIndex] = useState<number | undefined>(undefined);
  // inside the existing load effect, alongside the ?all=1 fetch:
  //   const [allRes, geoRes] = await Promise.allSettled([
  //     fetch('/api/spotlight?all=1'), fetch('/api/spotlight'),
  //   ]);
  //   ...set entries from allRes as today...
  //   if (geoRes.status === 'fulfilled' && geoRes.value.ok) {
  //     const g = await geoRes.value.json();
  //     const i = loaded.findIndex((e) => e.metro.zip === g.metro?.zip);
  //     if (i >= 0) setStartIndex(i);
  //   }
  const rot = useMetroRotation(entries.length, { reduceMotion, startIndex });
```

(Adapt to the file's real effect structure; keep the `filter((e) => e.deal)` and compute `startIndex` against the FILTERED array. `startIndex` arriving after mount recomputes `order` via the `useMemo` dep — acceptable: it happens within the first second, before the first 6s advance.)

- [ ] **Step 5: Run to verify green, then the full suite**

Run: `pnpm --filter @oper/one test && pnpm --filter @oper/one typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/one/src/components/home/useMetroRotation.ts apps/one/src/components/home/useMetroRotation.test.ts apps/one/src/components/home/FirstDealHero.tsx apps/one/src/components/home/FirstDealHero.test.tsx
git commit -m "feat(home): carousel opens on the visitor's metro (x-geo), then tours"
```

---

## Task 4: `mv_market_grid` — kill the 22s markets prime

**Files:**
- Create: `infrastructure/migrations/2026_07_17_mv_market_grid.sql`
- Modify: `apps/one/src/app/api/markets/route.ts`
- Modify: `apps/worker/src/refresh.ts`

**Interfaces:**
- Matview `mv_market_grid(zip_code, city, state, n, median_price, median_rent, ratio, hpi5y)` — exactly the shape the route returns today (top 8 by live count, precomputed).
- Route: `SELECT * FROM mv_market_grid ORDER BY n DESC` (fast); if the mv doesn't exist yet (fresh env), fall back to the live aggregation. In-process TTL cache stays.
- Worker: refresh `mv_market_grid` CONCURRENTLY every 30 min in the existing refresh loop.

- [ ] **Step 1: Migration**

```sql
-- infrastructure/migrations/2026_07_17_mv_market_grid.sql
-- Precomputed homepage markets grid. The live aggregation scans ~1M listings
-- with two percentile_conts per ZIP (~22s) — far too slow for a request path.
-- Refreshed CONCURRENTLY by the worker refresh loop (~30 min cadence).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_market_grid AS
  WITH top AS (
    SELECT zip_code,
           max(raw_data->>'city') AS city,
           max(raw_data->>'state') AS state,
           count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
             FILTER (WHERE estimated_rent > 0) AS median_rent
    FROM listings
    WHERE listing_type = 'for_sale' AND sale_type = 'standard'
      AND price > 10000 AND zip_code ~ '^\d{5}$'
    GROUP BY zip_code
    ORDER BY n DESC
    LIMIT 8
  )
  SELECT t.zip_code, t.city, t.state, t.n,
         t.median_price, t.median_rent,
         CASE WHEN t.median_price > 0 THEN round((t.median_rent / t.median_price * 100)::numeric, 2) END AS ratio,
         CASE WHEN h.five_ago > 0 THEN round(((h.latest - h.five_ago) / h.five_ago * 100)::numeric, 1) END AS hpi5y
  FROM top t
  LEFT JOIN LATERAL (
    -- hpi = FHFA index LEVEL (annual_change_pct = yearly %); see 2026-07-17 column-swap fix.
    SELECT max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code)) AS latest,
           max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code) - 5) AS five_ago
    FROM fhfa_zip_hpi WHERE zip5 = t.zip_code
  ) h ON true;

-- CONCURRENTLY needs a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS mv_market_grid_zip ON mv_market_grid (zip_code);
```

- [ ] **Step 2: Route reads the mv** — replace the big inline SQL inside `refreshMarkets()` with:

```ts
    const { rows } = await pool.query<Row>(
      `SELECT zip_code, city, state, median_price, median_rent, ratio, hpi5y
         FROM mv_market_grid ORDER BY n DESC`,
    );
```

wrapped so a missing relation (error code `42P01`, fresh envs before the migration runs) falls back to the previous live aggregation SQL (keep it in the file as `LIVE_AGGREGATION_SQL` — one constant, one fallback call). Everything else (cache, stale-while-revalidate, shaping) unchanged.

- [ ] **Step 3: Worker refresh** — in `apps/worker/src/refresh-clusters.ts`, add a **separate** `setInterval` (~30 min) that refreshes `mv_market_grid` CONCURRENTLY. Do NOT gate it on `tilesInputChanged` (markets move daily; the high-water check keys off listing inserts/price edits and would wrongly skip). Wrap in its own try/catch so a missing mv (pre-migration, error `42P01`) only warns. Keep the existing `mv_cluster_tiles` logic untouched.

- [ ] **Step 4: Tests + typecheck**

Run: `pnpm --filter @oper/one test && pnpm --filter @oper/one typecheck && pnpm --filter @oper/worker typecheck && pnpm --filter @oper/worker test`
Expected: green (markets route has no SQL-shape test today; do not add one that asserts the mv SQL text — the live fallback keeps behavior covered).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/migrations/2026_07_17_mv_market_grid.sql apps/one/src/app/api/markets/route.ts apps/worker/src/refresh.ts
git commit -m "perf(home): markets grid from mv_market_grid (worker-refreshed) — no more 22s prime"
```

---

## Task 5: Deploy + end-to-end verification

**Files:** none (operator/controller checklist)

- [ ] **Step 1: Deploy order** — merge PR → on main: run the migration (`mv_market_grid` builds once, ~22s) → `pnpm --filter @oper/one build`, `pnpm --filter @oper/worker build` (clean dist) → restart `oper-app`, `oper-worker`, `oper-worker-refresh` → then the Task 1 nginx runbook (module, mmdb, snippets, reload).
- [ ] **Step 2: Header proof** — `curl -s -H "x-geo-latitude: 40" https://one.octavo.press/api/spotlight | jq .metro` from any box must IGNORE the spoofed header (nginx overwrites) and reflect the caller's real IP geo (or Houston for non-US/unknown).
- [ ] **Step 3: Local start** — load `/` from a residential IP near a non-default metro; the carousel's first city must be that metro, then tour. Reduced-motion: static local metro.
- [ ] **Step 4: Markets cold** — restart `oper-app`, immediately `curl -w '%{time_total}'` `/api/markets` → **< 0.5s** (mv read), values match the pre-mv output (spot-check Katy ≈ +58.8%).
- [ ] **Step 5: Worker refresh proof** — `journalctl -u oper-worker-refresh` shows `mv_market_grid` refreshing without error on its cadence.

---

## Rollout

One PR for Tasks 1-4 (repo files); Task 1's server-side steps + Task 5 happen at deploy. No new units; one migration; nginx reload is zero-downtime. Rollback: remove the two nginx includes + reload (geo falls back to Houston); route's `42P01` fallback covers dropping the mv.

## Self-Review

**Spec coverage:** real geo end-to-end (Tasks 1-2) · hero opens local then tours (Task 3) · spoof-proof headers (Task 1 overwrite + Task 5 Step 2 proof) · Vercel-preview fallback (Task 2) · privacy constraint (coarse coords only, nothing persisted) · 22s prime eliminated with freshness bound (Task 4) · degradation paths (no mmdb → default metro; no mv → live SQL fallback). Covered.

**Placeholder scan:** all code steps carry complete code or an exact, named integration instruction anchored to a verified existing pattern (`refresh.ts` follows `mv_cluster_tiles`; hero effect adapts `Promise.allSettled` into the file's real load effect). Commands exact.

**Type consistency:** `metroFromHeaders` signature unchanged (Tasks 2-3 consumers unaffected); `useMetroRotation` opts extended additively (`startIndex?`) so existing call sites compile; `mv_market_grid` columns mirror the route's existing `Row` shape; `SpotlightEntry` reused untouched from the carousel plan.
