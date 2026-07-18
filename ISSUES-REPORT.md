# Issues Report — #44, #46, #50, #51, #53, #54

Branch `fix/issues-app` off main `04aa89b`. Verification: `pnpm --filter @oper/one test` → **125 passed (25 files)**; `pnpm --filter @oper/one typecheck` → clean. Lint errors that remain in touched files are pre-existing baseline (`any`, `prefer-const`, `setState-in-effect`, unused imports) — no new lint introduced by these changes.

---

## #44 — Restore GET/DELETE test coverage for `/api/saved-properties`
**File:** `apps/one/src/app/api/saved-properties/route.test.ts` (POST-only → 14 tests).
Added, following the existing `vi.hoisted` mock pattern:
- **GET**: 401 without session; hydrated rows returned session-scoped (asserts `WHERE sp.user_id = $1`, params `['u1']`) and newest-first (asserts `ORDER BY sp.created_at DESC`) with the listings JOIN; 42703 fallback to the status-free SELECT (asserts the retry SQL drops `listing_status`); non-42703 error → 500.
- **DELETE**: 401 without session; 400 when neither `id` nor `listingId` (asserts no query fired); `?listingId=` variant (asserts `WHERE listing_id = $1 AND user_id = $2`, params `['123','u1']`); `?id=` variant (asserts `WHERE id = $1 AND user_id = $2`); precedence — `listingId` wins when both supplied.

**Evidence:** `saved-properties/route.test.ts (14 tests)` pass. (One test intentionally drives a 500 → the `code:'08006'` console.error in output is expected.)

## #46 — Deferred D1/D2 from the Investor's Shelf review
- **D1** (`apps/one/src/lib/prefs.ts`): the client module imported the shared prefs surface AND separately re-exported it with a second `from './prefs-shared'`. Collapsed to one import + a bare `export { … }` re-export of those bindings (single reference to `./prefs-shared`). Prefs remain single-sourced in `prefs-shared.ts`.
- **D2** (`apps/one/src/app/account/page.test.tsx`): both tests inlined byte-identical `global.fetch` mocks. Extracted one `installFetchMock()` helper returning a `getSavedBody()` getter; both tests call it. No behavior change (2 tests still pass).

## #50 — Document the compare-by-id no-filter decision
- `apps/one/src/app/api/properties/route.ts`: added an ADR-style comment block at the `?ids=` path explaining the **intentional** absence of the lifecycle filter — Compare must never hide a row the user named by id; `listing_status AS status` is surfaced instead. Warns future reviewers not to "fix" it (refs #50 / DEF-LT-5).
- Plan doc `docs/superpowers/plans/2026-07-18-listing-truth.md`: added a `## Decisions` block with the compare-by-id decision line.

## #51 — Lifecycle-filter the leaking read surfaces
Added default `AND listing_status NOT IN ('sold','stale','rental_misfiled')` to `FROM listings` reads in:
- `api/stats/route.ts` (base CTE — total/1%/median/histogram now count active inventory; comment updated).
- Sibling stats routes: `api/stats/cuts/route.ts`, `api/stats/median-rent/route.ts`, `api/stats/health/route.ts` (health filtered to the active backfill queue, with a rationale comment).
- `sitemap.ts` (zip list), `api/v1/listings/route.ts` (public API SELECT).
- `api/estimate-rent/route.ts`: **only** the zip comps-median aggregate. The by-id lookups (resolve zip / stored estimate) stay unfiltered on purpose — compare-by-id semantics (#50), the valued listing may itself be off-market.
- `market/[zip]/page.tsx`: the 5 listing-data queries — `generateStaticParams` zip list, `aggRes` (counts/medians), `rentPsfRes`, `topRes` (the cards), `rankedRes` (neighbor ranking). Pure geo-context joins (walkability / NRI / schools / place lookup) left as-is — they index listings as geo points, not as displayed listings.
- `market/[zip]/opengraph-image.tsx`: the agg query (same medians as the ZIP page, surfaced by the grep-for-completeness — kept consistent with the page it images).

**Not touched** (per instruction / do-not-touch): properties/query, properties route (compare — #50), spotlight, featured, viewport, export, markets. **Adjacent surfaces left out of this issue's explicit scope** (flagged as follow-ups): `analytics/page.tsx`, `api/properties/[id]/comps`, `[id]/rental-comps`, `[id]/context`, `[id]/history` — per-id detail/comps routes; and `saved-searches`, `lib/valuation.ts`, `lib/queries/property.ts`.

## #53 — includeSold UI toggle
- `apps/one/src/app/search/page.tsx`: added an "Include sold" pill in the toolbar filter rail (styled to match the Table/Map view-toggle pills, `aria-pressed={qs.sold}`), toggling the existing `sold` nuqs boolean param. Wired `includeSold: filters.showSold || undefined` into the `getProperties` request (the data layer `buildListingsQuery` already honored `includeSold`).
- **Test** `apps/one/src/app/search/page.test.tsx` (new): renders the page under `NuqsTestingAdapter` (`hasMemory`), mocks map/action/prefs, and asserts (a) default loads omit `includeSold`, then toggling the pill flows `includeSold:true` into the `getProperties` call, and (b) `?sold=true` renders the pill `aria-pressed="true"`.

## #54 — Reconcile `?include_sold=1` vs `includeSold` body
- `api/properties/query/route.ts` and `api/properties/export/route.ts`: opt into sold rows via `body.includeSold === true || req.nextUrl.searchParams.get('include_sold') === '1'`. Stale + rental_misfiled stay hidden regardless.
- **Tests** (new): `query/route.test.ts` (4) and `export/route.test.ts` (4) assert the generated lifecycle filter for default / `?include_sold=1` / body-flag / ignored-value cases (export also verifies the pro 402 gate stays intact).
- Plan doc `## Decisions` block notes the dual acceptance alongside the #50 decision.
