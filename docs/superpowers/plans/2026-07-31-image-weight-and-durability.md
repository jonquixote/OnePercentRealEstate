# Image Weight & Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping ~150 KB photos into 300 px card slots, and stop the entire visual layer of the product depending on one third-party CDN with no fallback.

**Architecture:** Two pieces, deliberately ordered. First the free win: every image URL already carries a `w=` sizing parameter, so the render context can ask for the size it actually displays — no infrastructure, no storage, no migration. Only then, with real traffic numbers in hand, decide whether the single-CDN dependency needs a proxy or a rehost.

**Tech Stack:** Next 16 (`apps/one`, `apps/two`), the existing `<Media>` primitive and `media_source` column, PostgreSQL 16, bash ops probes.

## The measured problem

Prod, 2026-07-25, active for-sale listings:

| Fact | Value |
|---|---|
| Active listings with a photo | 441,581 (100% of those that have images) |
| Distinct image hosts | **1** — `ap.rdcpix.com` (401,562) and `nh.rdcpix.com` (40,019) |
| Format | `image/webp` (already good) |
| Size per image | **119 KB – 186 KB** (5-sample spread) |
| Fetch time per image | 0.32 s – 0.49 s |
| URLs already carrying a `w=` param | **441,581 / 441,581 (100%)** |

Two independent problems fall out of that table.

**1. Weight.** A search page rendering 24 cards pulls roughly 24 × 150 KB ≈ **3.6 MB** of imagery to fill slots a few hundred pixels wide. The CDN already accepts a width parameter — the product simply never asks for a smaller rendition. This is the cheapest performance win available in the codebase right now.

**2. Durability.** Every photo in the product comes from one CDN belonging to a company whose listings we scrape. It currently serves without a `Referer` (verified: `200`, 169 KB), but hotlink protection, rate limiting, or a URL scheme change would take the product from 100% photo coverage to 0% with no warning and no fallback. The 2026-07-25 work made this dependency total — before it, only 140 listings had a readable photo, so there was nothing to lose.

The repo already anticipated this: `media_source`, `media_url_status`, `media_last_checked` and a `<Media>` primitive exist, and the recorded decision was *links-first, rehost deferred until live traffic warrants it*. This plan does not overturn that decision. It measures whether the trigger has been reached, and builds the cheap mitigations either way.

## Global Constraints

- **Measure before building.** Task 1 produces real numbers; Tasks 3–4 are gated on them. Two plan premises in the last two sessions were falsified by measurement, and one audit's headline figure was measuring the wrong thing entirely.
- **Never rewrite a URL you have not verified renders.** A sizing parameter that the CDN silently ignores is harmless; one it rejects turns every card into a broken image. Verify against the live CDN before shipping.
- **Preserve the fallback chain.** Read paths select `COALESCE(primary_photo, images->>0)`; any new indirection must keep working when the native column is null.
- **No new unbounded background work.** Any probe added here is O(index) or a bounded sample — never a full scan of `listings`.
- **Do not fetch the whole image corpus.** 441,581 images at ~150 KB is ~66 GB; any availability check samples, it does not sweep.
- Latency budgets in `docs/perf/perf-budgets.md` bind; adding image work must not push any route's p95 past its budget.

---

## Task 1: Measure what a page actually costs

**Files:**
- Create: `docs/perf/2026-07-image-weight-audit.md`

**Interfaces:**
- Produces: real page-weight numbers and the CDN's actual resizing behaviour, which gate Tasks 3 and 4.

- [ ] **Step 1: Confirm the CDN honours `w=`, and find the smallest useful width.** Take one real URL and request several widths, recording bytes and dimensions for each:

```bash
URL=$(ssh -i ~/.ssh/id_onepercent root@209.50.61.64 \
  "sudo -u postgres psql -d postgres -tAc \"SELECT primary_photo FROM listings WHERE primary_photo IS NOT NULL AND listing_status='active' LIMIT 1;\"")
for w in 200 400 640 800 1200; do
  printf "w=%-5s " "$w"
  curl -s -o /tmp/img.webp -w '%{size_download}b %{content_type}\n' "${URL%%\?*}?w=${w}"
done
```

Expected: bytes fall materially as `w` falls. **If the byte count does not change, the parameter is decorative and Task 2 is pointless — stop and record that**, then skip to Task 4.

- [ ] **Step 2: Confirm the returned image is actually the requested width**, not just a smaller re-encode:

```bash
file /tmp/img.webp
```

Record the reported dimensions. A CDN that returns full-resolution bytes under a different filename is not resizing.

- [ ] **Step 3: Measure a real page's image payload.** Load a search page and total the image bytes:

```bash
curl -s 'https://one.octavo.press/search' | grep -oE 'https://[a-z]+\.rdcpix\.com[^"'"'"' ]+' | sort -u | head -30 > /tmp/urls.txt
wc -l /tmp/urls.txt
total=0; while read -r u; do
  b=$(curl -s -o /dev/null -w '%{size_download}' "$u"); total=$((total+b));
done < /tmp/urls.txt; echo "total image bytes: $total"
```

If the search page is client-rendered and the HTML carries no image URLs, say so and measure the API payload's photo count × the median image size instead. Record which method was used.

- [ ] **Step 4: Record the display sizes the UI actually uses.** Read the card and hero components and write down the rendered CSS width of each image slot:

```bash
grep -rn "primary_photo\|<Media\|Image " apps/one/src/components/ui/card.tsx apps/one/src/components/search/SearchCard.tsx | head
```

The audit needs a table: context → displayed width → width currently requested. That table is the specification for Task 2.

- [ ] **Step 5: Check the durability posture honestly.** Sample 200 random active photos and record the status codes — not to prove they work today, but to establish the baseline the probe in Task 4 will watch:

```sql
SELECT primary_photo FROM listings
 WHERE primary_photo IS NOT NULL AND listing_status='active'
 ORDER BY random() LIMIT 200;
```

Record: how many 200, how many non-200, and whether any require a `Referer`.

- [ ] **Step 6: Commit** — `docs(images): weight and durability audit`

---

## Task 2: Ask for the size we actually display

**Files:**
- Create: `apps/one/src/lib/image-size.ts`
- Create: `apps/one/src/lib/image-size.test.ts`
- Modify: the card/hero components identified in Task 1 Step 4

**Interfaces:**
- Consumes: the context→width table from Task 1.
- Produces: `sizedPhoto(url: string | null, width: number): string | null`

- [ ] **Step 1: Write the failing test.** The function is pure string manipulation, so test it exhaustively — it runs on every image on every page:

```ts
import { describe, it, expect } from 'vitest';
import { sizedPhoto } from './image-size';

describe('sizedPhoto', () => {
  it('replaces an existing w= parameter', () => {
    expect(sizedPhoto('https://ap.rdcpix.com/x-w480_h360_x2.webp?w=1200', 400))
      .toBe('https://ap.rdcpix.com/x-w480_h360_x2.webp?w=400');
  });

  it('adds w= when the URL has no query string', () => {
    expect(sizedPhoto('https://ap.rdcpix.com/x.webp', 400))
      .toBe('https://ap.rdcpix.com/x.webp?w=400');
  });

  it('preserves other query parameters', () => {
    const out = sizedPhoto('https://ap.rdcpix.com/x.webp?a=1&w=1200&b=2', 400);
    expect(out).toContain('a=1');
    expect(out).toContain('b=2');
    expect(out).toContain('w=400');
  });

  it('passes through null and empty input rather than fabricating a URL', () => {
    expect(sizedPhoto(null, 400)).toBeNull();
    expect(sizedPhoto('', 400)).toBeNull();
  });

  it('leaves a non-rdcpix host untouched — we only know this CDN resizes', () => {
    const other = 'https://images.example.com/a.jpg';
    expect(sizedPhoto(other, 400)).toBe(other);
  });

  it('never throws on a malformed URL', () => {
    expect(() => sizedPhoto('not a url', 400)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @oper/one test --run src/lib/image-size
```

Expected: FAIL — `Cannot find module './image-size'`.

- [ ] **Step 3: Implement it.**

```ts
/**
 * Request the rendition we actually display.
 *
 * Every listing photo URL already carries a `w=` sizing parameter — 441,581 of
 * 441,581 on prod — but the product requested full size everywhere, shipping
 * ~150 KB images into card slots a few hundred pixels wide.
 *
 * Restricted to the known CDN on purpose: we have verified that rdcpix honours
 * `w=`. Rewriting an arbitrary host's query string is a guess, and a guess that
 * a CDN rejects turns every card into a broken image.
 */
const RESIZING_HOSTS = /(^|\.)rdcpix\.com$/i;

export function sizedPhoto(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!RESIZING_HOSTS.test(u.hostname)) return url;
    u.searchParams.set('w', String(Math.round(width)));
    return u.toString();
  } catch {
    return url; // malformed: pass through untouched rather than break the render
  }
}
```

- [ ] **Step 4: Run the tests.** Expected: 6 passed.

- [ ] **Step 5: Verify against the live CDN before wiring it in.** A unit test proves the string is built correctly, not that the CDN accepts it:

```bash
curl -s -o /dev/null -w 'sized: %{http_code} %{size_download}b\n' "$(node -e "…print sizedPhoto(REAL_URL, 400)…")"
```

Expected: `200`, and materially fewer bytes than the unsized fetch in Task 1 Step 1. **If it 404s or returns the same byte count, stop** — the rewrite is wrong and shipping it would break every card.

- [ ] **Step 6: Wire it into the card and hero components** using the widths recorded in Task 1 Step 4. Request roughly 2× the CSS width to stay sharp on retina displays, and say so in a comment so the next person does not "optimise" it back down.

- [ ] **Step 7: Re-measure the page payload** with the same method as Task 1 Step 3 and record before/after in the audit doc. Commit — `perf(images): request the rendition we display, not the full-size original`

---

## Task 3: A page-weight budget, so this cannot regress

**Files:**
- Modify: `docs/perf/perf-budgets.md`
- Create: `ops/monitoring/page-weight.sh`
- Create: `ops/systemd/oper-page-weight.service`, `ops/systemd/oper-page-weight.timer`

- [ ] **Step 1: Set the budget from the measured post-fix value**, not from a round number. Add a row to `perf-budgets.md` in the same format as the latency budgets, citing the before and after from Task 2 Step 7.

- [ ] **Step 2: Write the probe.** It fetches one representative page, totals its image bytes, and alerts above the budget. Follow the structure of `ops/monitoring/photo-coverage.sh` exactly: `--key`, `--resolved`, best-effort, and never let the probe itself become expensive.

**Bound the work**: cap the number of images fetched per run (e.g. the first 20) and note in a comment why — a probe that downloads a whole page of imagery every 30 minutes is the same mistake as the progress counter that reached 75% of database time.

- [ ] **Step 3: Add the units** on a 6-hour cadence (page weight changes when code ships, not minute to minute), with the same `MemoryHigh=64M` / `MemoryMax=96M` caps as the other probes.

- [ ] **Step 4: Prove it fires and resolves.** Temporarily set the budget below the current value, run it, confirm the Telegram message names the page and the byte count and that the state file appears; restore, run again, confirm RESOLVED and the state file is gone.

- [ ] **Step 5: Commit** — `feat(images): page-weight budget with an alert`

---

## Task 4: Decide the durability question with evidence

**Files:**
- Create: `docs/perf/2026-07-image-durability-decision.md`
- Create: `ops/monitoring/image-availability.sh`
- Create: `ops/systemd/oper-image-availability.service`, `ops/systemd/oper-image-availability.timer`

**Interfaces:**
- Consumes: the baseline from Task 1 Step 5.

- [ ] **Step 1: Build the availability probe first**, because whatever the decision, we need to know the moment it breaks. It samples — never sweeps:

```bash
# Sample 50 random active photos. 441,581 images at ~150 KB is ~66 GB; a probe
# that checks them all is not a probe, it is a denial-of-service against a CDN
# we do not own. HEAD only, no body.
```

Alert when the success rate over the sample falls below a floor (start at 95%), with `--key`, `--resolved`, and a message naming the rate and a failing example URL.

- [ ] **Step 2: Prove the probe fires and resolves**, same method as every other probe here.

- [ ] **Step 3: Write the decision record.** Answer, with the Task 1 numbers rather than instinct:
  - Does the CDN currently require a `Referer`, rate limit, or vary by geography?
  - What is the blast radius if it stops serving? (Today: 100% of listing imagery.)
  - What would a proxy cost — bandwidth through our single box, cache storage, and the added latency on a cache miss?
  - What would a rehost cost — ~66 GB at full size, far less at the widths Task 2 established we actually need, plus the ongoing cost of new listings at the current crawl rate.

  **State a recommendation, not a menu.** The existing decision is links-first with rehost deferred; either confirm it with the new numbers or overturn it with them.

- [ ] **Step 4: If — and only if — Step 3 recommends acting**, implement the smallest version that removes the single point of failure, using the `media_source` column and `<Media>` primitive that already exist rather than inventing a parallel path. If Step 3 recommends holding, say so plainly and stop; the probe from Step 1 is then the deliverable.

- [ ] **Step 5: Update `docs/HANDOFF.md` §7** with the availability probe and what to do when it fires. Commit — `docs(images): durability decision + availability probe`

---

## Self-Review

**Spec coverage:** the two problems the measurements exposed are addressed in
proportion to their evidence — the sizing win is built immediately because the
`w=` parameter is present on 100% of URLs and costs nothing, while the
durability question gets a probe now and a decision backed by numbers rather
than a speculative rehost. Regression protection is added for both (Tasks 3
and 4 Step 1).

**Placeholder scan:** every step names files, commands and expected output.
Task 2's widths and Task 3's budget are deliberately derived from Task 1's
measurements rather than invented here — inventing a budget before measuring is
how `db-load-budget.sh` first shipped alerting forever on an idle database.
Task 4 Step 4 is explicitly conditional, with the "hold" branch producing a real
deliverable rather than nothing.

**Type consistency:** `sizedPhoto(url: string | null | undefined, width: number): string | null`
is the only new runtime contract, and it accepts null so it can be dropped
directly onto `COALESCE(primary_photo, images->>0)` results without a guard at
every call site.
