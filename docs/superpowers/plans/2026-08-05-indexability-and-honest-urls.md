# Indexability & Honest URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop telling search engines that listings exist when they do not — a missing property currently returns HTTP 200, and the sitemap advertises 34,409 URLs while 105,828 active listings have not been confirmed in over a week.

**Architecture:** Three independent corrections, ordered by blast radius. Make a missing property return 404 (or 410) so a crawler can drop it. Make the sitemap advertise only what we can stand behind. Then decide what a page for an unconfirmed-but-not-yet-reaped listing should say, since that population is large and will never be zero.

**Tech Stack:** Next 16 (`apps/one`), PostgreSQL 16, vitest, bash ops probes.

## The measured problem

Prod, 2026-07-26:

| Fact | Value |
|---|---|
| URLs in `sitemap.xml` | **34,409** |
| `/property/<nonexistent-id>` HTTP status | **200** |
| Active listings unconfirmed for >7 days | **105,828** |
| Active for-sale listings | 446,270 |
| `robots.txt` | `Allow: /`, disallowing only `/api/`, `/account`, `/settings`, `/shelf` |

Three separate problems, all pointing the same way.

**1. A missing property returns 200.** Verified:

```
/property/877       200   (real listing)
/property/99999999  200   (does not exist)
```

The page renders error scaffolding with a success status. A search engine has no
way to distinguish "this listing exists" from "this listing never existed" — so
nonexistent URLs stay in the index, accumulate, and dilute the crawl budget for
the pages that matter.

**2. The sitemap advertises listings we cannot vouch for.** 34,409 URLs are
published. Meanwhile 105,828 listings the product calls active have not been
confirmed by the crawler in over seven days — and the crawler's own rechecks
find *nothing* in 63 ZIPs a day where our database says listings are active
(`docs/perf/2026-08-crawl-throughput-audit.md`). Some meaningful share of what
we are advertising is gone.

**3. There is no honest state for "we think this exists but have not checked
recently."** The freshness disclosure shipped on 2026-07-26 states the age of the
last confirmation on the property page, which is the right start. But nothing
downstream acts on it: the sitemap does not filter on it, the status code does
not reflect it, and `robots.txt` gives blanket permission.

## Why this matters commercially

Organic discovery is how a listings product acquires users, and the two failure
modes compound. Returning 200 for nonexistent pages trains a crawler to keep
requesting them. Advertising stale listings means a searcher's first experience
is a property that sold two weeks ago — the same trust damage as a wrong rent
estimate, arriving before the user ever reaches a number we compute.

## Global Constraints

- **Never 404 a listing that exists**, including an archived one. `listings_archive` is read through by the property loader; an archived listing is still a real listing with real inbound links and must render 200.
- **Relabel, never delete** still holds. Nothing here removes data; it changes what we *advertise* and what status we return.
- **404 vs 410 is a real decision**: 404 says "not found", 410 says "gone, stop asking". Choose deliberately in Task 1 and record why.
- **Do not shrink the sitemap by guessing.** Any exclusion rule must be justified by a measured population, not by intuition about what feels stale.
- **No user-facing latency regression.** `docs/perf/perf-budgets.md` binds — `property.id` has a 1,000 ms budget and the sitemap 45 s cold.
- **Sitemap generation already broke once** on Next 16's `generateSitemaps` (`r.startsWith` on a non-string). Any change there must be verified by fetching the live XML, not by reading the code.

---

## Task 1: A missing property must say so

**Files:**
- Modify: `apps/one/src/app/property/[id]/page.tsx`
- Create: `apps/one/src/app/property/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `loadPropertyRow` (live table, then `listings_archive`).

- [ ] **Step 1: Establish current behaviour precisely**, so the change is provable:

```bash
for id in 877 99999999 not-a-number; do
  printf '%-14s ' "$id"
  curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3001/property/$id"
done
```

Record all three. A non-numeric id is worth checking separately — it may take a
different path.

- [ ] **Step 2: Write the failing test.**

```tsx
import { describe, it, expect, vi } from 'vitest';

const getProperty = vi.fn();
vi.mock('@/app/actions', () => ({
  getProperty: (...a: unknown[]) => getProperty(...(a as [])),
  getHudBenchmark: vi.fn().mockResolvedValue(null),
  getDemographics: vi.fn().mockResolvedValue(null),
}));
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound }));

describe('property page', () => {
  it('calls notFound() when the listing exists in neither table', async () => {
    getProperty.mockResolvedValue(null);
    const { default: Page } = await import('./page');
    await expect(Page({ params: Promise.resolve({ id: '99999999' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('renders an ARCHIVED listing rather than 404ing it', async () => {
    getProperty.mockResolvedValue({ id: '5', address: '1 Old St', status: 'stale' });
    const { default: Page } = await import('./page');
    await expect(Page({ params: Promise.resolve({ id: '5' }) })).resolves.toBeDefined();
  });
});
```

The second test is the one that protects the archival work: a stale or archived
listing has inbound links and must not become a 404.

- [ ] **Step 3: Run it, watch it fail, then call `notFound()`** when the loader returns null.

- [ ] **Step 4: Decide 404 vs 410 and record it.** A listing that never existed is a 404. A listing we *had* and that is genuinely gone is a 410 — but note that under "relabel, never delete" it is still in the database and still renders, so 410 may apply to nothing. **Say which, and why, in the commit message.**

- [ ] **Step 5: Verify on prod after deploy**, with the same three ids from Step 1. Expected: `200`, `404`, and whatever Step 1 recorded for the non-numeric case.

- [ ] **Step 6: Commit** — `fix(seo): a property that does not exist returns 404, not 200`

---

## Task 2: Advertise only what we can stand behind

**Files:**
- Modify: the sitemap route (find it with `find apps/one/src/app -name 'sitemap*'`)
- Test: alongside it

- [ ] **Step 1: Measure the populations before choosing a rule.**

```sql
SELECT count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')  AS within_7d,
       count(*) FILTER (WHERE last_seen_at > now() - interval '14 days') AS within_14d,
       count(*) FILTER (WHERE last_seen_at > now() - interval '30 days') AS within_30d,
       count(*) AS total
  FROM listings WHERE listing_status='active' AND listing_type='for_sale';
```

The current sweep is ~6 days, so a 7-day cutoff tracks the crawl's real
capability. **A cutoff tighter than the sweep interval would exclude listings
purely because the crawler has not got to them yet** — punishing our own
throughput rather than reflecting reality.

- [ ] **Step 2: Write the failing test** — the sitemap includes a freshly confirmed listing and excludes one unconfirmed past the cutoff, and never emits a malformed entry.

- [ ] **Step 3: Implement the filter**, and keep market pages unfiltered — a ZIP market page is valid regardless of any individual listing's freshness.

- [ ] **Step 4: Verify the live XML, not the code.** Sitemap generation broke once on Next 16 already:

```bash
curl -s http://127.0.0.1:3001/sitemap.xml | grep -c '<loc>'
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' http://127.0.0.1:3001/sitemap.xml
```

Expected: a count below 34,409, a `200`, and generation within the 45 s budget.
State the before and after counts.

- [ ] **Step 5: Commit** — `fix(seo): sitemap advertises only recently confirmed listings`

---

## Task 3: Decide what an unconfirmed listing's page should tell a crawler

**Files:**
- Modify: `apps/one/src/app/property/[id]/page.tsx` (metadata)
- Create: `docs/perf/2026-08-indexability-decision.md`

- [ ] **Step 1: Frame the decision with the measured population.** 105,828 active listings are unconfirmed past seven days — 23.7% of active inventory. This is not an edge case and will never be zero. The options:

  - **(a) Index normally.** Simplest; keeps stale listings in results.
  - **(b) `robots: noindex` past the freshness cutoff.** The page still renders for anyone with the link — no 404, no data loss — but search engines stop surfacing it. Consistent with the sitemap rule from Task 2.
  - **(c) 410 past a longer cutoff.** Strongest signal, and wrong under "relabel, never delete": the listing may return.

- [ ] **Step 2: Recommend one, with reasoning**, and record it. **(b) is the expected answer** — it matches the sitemap rule, keeps every URL working, and is reversible the moment the crawler re-confirms the listing. But write the record as a decision, not a formality; if the numbers argue otherwise, say so.

- [ ] **Step 3: Implement the chosen option** via Next's `metadata.robots` on the property page, driven by the same `freshnessOf()` used for the user-facing disclosure — one definition of freshness, not two that can drift.

- [ ] **Step 4: Verify** the meta tag appears for an unconfirmed listing and is absent for a fresh one:

```bash
curl -s http://127.0.0.1:3001/property/<stale-id> | grep -i 'noindex' || echo 'absent'
curl -s http://127.0.0.1:3001/property/<fresh-id> | grep -i 'noindex' || echo 'absent (correct)'
```

- [ ] **Step 5: Commit** — `feat(seo): unconfirmed listings are de-indexed, not deleted`

---

## Task 4: A probe, so the sitemap cannot silently lie again

**Files:**
- Create: `ops/monitoring/sitemap-honesty.sh`
- Create: `ops/systemd/oper-sitemap-honesty.service`, `ops/systemd/oper-sitemap-honesty.timer`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Write the probe.** It samples URLs from the live sitemap and checks that each returns 200 — catching both a broken sitemap and a filter that has drifted out of step with the data.

**Sample, never sweep**: 34,409 URLs fetched on a timer is a self-inflicted load
test. Cap the sample (25 is enough to catch a systemic break) and use HEAD.

- [ ] **Step 2: Alert when the success rate falls below a floor**, naming a failing URL, with `--key` and `--resolved` like every other probe here.

- [ ] **Step 3: Prove it fires and resolves** by the established method.

- [ ] **Step 4: Update `docs/HANDOFF.md` §7** and commit — `feat(seo): sitemap honesty probe`

---

## Self-Review

**Spec coverage:** all three measured problems are addressed — the 200-for-
missing status (T1), the sitemap advertising unconfirmed inventory (T2), and the
absence of any indexing policy for the 23.7% that will always be unconfirmed
(T3) — with a probe so the sitemap cannot drift back out of step (T4). The
archival work is explicitly protected: T1's second test exists to stop an
archived listing becoming a 404.

**Placeholder scan:** every step names files, commands and expected output. Two
values are deliberately derived rather than invented: the sitemap freshness
cutoff comes from T2 Step 1's measured populations tied to the ~6-day sweep, and
T3's choice is made from the measured 105,828-listing population. Inventing
either ahead of the measurement is how a rule ends up punishing our own crawl
throughput.

**Type consistency:** no new runtime contracts. T3 reuses `freshnessOf()` from
`@/lib/freshness` rather than introducing a second freshness definition — the
user-facing disclosure and the indexing policy must never be able to disagree
about whether a listing is stale.
