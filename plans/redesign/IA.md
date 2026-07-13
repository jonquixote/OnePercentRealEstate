# one.octavo.press — Information Architecture

*Replaces the Cycle-3 artifacts in this directory. Grounded in the live
eggshell "line" system (globals.css as of 2026-07-12) and the shipped
surfaces: split-view search, overlay map, market pages, compare, digests,
auth + pro tier. The sketches (`example-*.tsx`) render this IA.*

---

## 1. The organizing idea

An investor's work has **four jobs**. The site has exactly four primary
destinations, one per job. Everything else lives inside one of them.

| Job | Destination | One-line promise |
|---|---|---|
| *Find deals* | **Search** `/search` | Every listing, filtered by the math |
| *Understand places* | **Markets** `/market` | What a ZIP is really like — rents, risk, trajectory |
| *Track my positions* | **Shelf** `/shelf` | Watched deals, saved screens, comparisons, alerts |
| *Learn the method* | **Playbook** `/playbook` | How the 1% discipline works, with live examples |

**Pricing** is not a destination — it is a transaction. It renders as the
single brass affordance in the header utility cluster, never in primary nav.

**The terminal** (two.octavo.press) is the fifth surface for pros; it appears
as an entry in the account menu and a card on Pricing, not in the nav.

### Renames

- `Portfolio` → **Shelf**. "Portfolio" implies owned assets we don't track
  yet; the page actually holds watched/saved/compared things. When true
  ownership tracking ships, "Portfolio" returns as a section *inside* Shelf.
  (Route `/portfolio` 301s to `/shelf`.)

### Consolidations (the N2 decision, recommended option)

| Today | Becomes | Why |
|---|---|---|
| `/analytics` | Markets index (`/market`) hero section | It is market-level charting — that's what Markets is for. 301. |
| `/comps` | Property page (comps sections already exist there) + a Playbook article on comps methodology | A comps browser without a subject property has no job. 301 to `/playbook/comps`. |
| `/calculator` | Stays, re-homed under Playbook (`/playbook/calculator`, old URL 301s) | Shareable standalone tool; belongs with the method. |
| `/strategy/[slug]` | Playbook chapters (`/playbook/[slug]`) | Strategies ARE the playbook. 301s. |

Net: 16 routes → 12, zero orphans, every page reachable in ≤ 2 clicks.

---

## 2. Sitemap

```
/                       Home — the 30-second pitch (live data only)
/search                 Split-view workbench (list ⇄ map)      [core]
/market                 Markets index: national pulse + metro grid + charts
/market/[zip]           ZIP dossier (SEO front door)
/shelf                  Watched · Saved searches · Compares · Alert settings
/compare                Comparison table (reached from tray/shelf)
/playbook               Method home: the rule, worked example, chapters
/playbook/[slug]        buy-hold · brrrr · flip · str · comps
/playbook/calculator    Deal calculator
/property/[id]          The dossier                             [core]
/sold/[id]              Sold record (canonical for sold data)
/pricing                Tiers + terminal showcase
/login /account /settings
```

### Header (desktop)

```
◇ OnePercent     Search   Markets   Shelf   Playbook        [⌘K] [Pricing] [○ acct]
```

- Active route: 2px `--pass` underline sitting ON the header's bottom
  hairline (the brand's "line" made navigational).
- `Shelf` carries a count badge when any saved search has `new_matches > 0`.
- `[⌘K]` is a visible button (discoverability for the palette), rendered as
  a keycap chip.
- Signed-out: `[Pricing] [Sign in]`. Signed-in: avatar menu → Account,
  Settings, Terminal ↗ (pro badge), Sign out.

### Footer (all pages)

Three columns on hairlines, no background shift:
1. **Product** — the four destinations + Pricing + Terminal ↗
2. **Markets** — top-8 metros by listing count (live query, SEO internal links)
3. **Method** — Playbook chapters + "How the model works" + legal

### Mobile (< 1024px)

- Header: logo + ⌘K-style search icon + hamburger → full-height sheet with
  the same four destinations (large touch rows) + utility cluster.
- `/search` gets the **List | Map** segmented control pinned bottom-center
  (thumb zone). No other bottom nav — one persistent control, not five.

---

## 3. Core journeys (each sketch demonstrates one)

**J1 · Cold visitor → believer** (example-home.tsx)
Home hero states the thesis over live numbers → scroll: a real listing
worked through the 1% math → live mini-map with rent-heat teasing the data
moat → market grid → single CTA "Open the workbench". No feature tour;
the product IS the tour.

**J2 · Deal hunt** (example-search.tsx)
Search: filters left-to-right refine, map and list converse (hover sync),
draw a boundary, flip rent-heat on to see *why* an area prices as it does,
save the screen (names it, opts into the digest), add 3 to compare.

**J3 · Deal evaluation** (example-property-detail.tsx)
Property: verdict rail answers "does it clear?" in the first viewport —
ratio vs target, rent band (never a naked estimate), cash flow at default
financing. Then evidence in descending order: the money math → the
neighborhood truth (minimap + risk + context) → comps → history → the
paperwork facts. Sticky rail keeps price/rent/verdict + Watch/Compare
present through the whole read.

**J4 · Market research → scoped hunt** (example-market.tsx)
`/market/[zip]` answers "should I even look here?" — rent trajectory, HPI,
income, risk, walkability — then hands off: "Search 90004 →" pre-scoped.

**J5 · Return via email**
Digest email → property → its market page → adjust the saved search →
re-opt-in loop. (No sketch; flow exercised by J3+J4 surfaces.)

---

## 4. Page state rules (uniform, enforced)

| State kind | Lives in | Examples |
|---|---|---|
| Search/filter state | URL via nuqs (shareable, back-safe) | filters, sort, `?mv=` viewport, `?poly=` |
| UI preference | localStorage `oper:*` | searchAsMove, layer toggles, density, coach-marks-seen |
| Personal data | Postgres via account (claim-on-login) | saved searches, watches, screens, digest opt-ins |
| Ephemeral selection | React state only | hover sync, open panels |

Every async surface: fixed-height skeleton → data → **designed empty state**
(icon + one sentence + one action). Empty states name the next step, never
apologize ("Draw a smaller area or clear the boundary →").

---

## 5. Voice & visual grammar (delta from current, not a reset)

The eggshell system stays. The sketches tighten five things:

1. **The line is the brand — use it structurally.** Section breaks, active
   nav, the verdict gauge, band bars: all expressions of one horizontal
   rule. Delete decorative borders that aren't load-bearing.
2. **One verdict per viewport.** Each screenful has exactly one emerald or
   brass statement; everything else is ink/haze. (Today several surfaces
   have three competing accents.)
3. **Numbers are typography.** `.figure` for every numeral, sized by
   importance: verdict 22-28px, supporting 15px, provenance 11px `.prov`
   with its source ("model v1 · ±$480", "HUD FY26", "FHFA").
4. **Serif only speaks twice per page.** Page display + one section head.
   Everything else Geist.
5. **Photography stays matted** (`.mat`), including map thumbnails and
   empty-photo states.

---

## 6. Auth-tier surface map

| Surface | Anonymous | Free account | Pro |
|---|---|---|---|
| Search / Markets / Playbook / Property | full | full | full |
| Watch, save search | intent → login | ✓ | ✓ |
| Digest emails | — | ✓ (opt-in) | ✓ |
| Compare | 2 items | 2 items | 4 items |
| Shelf | read-only local | ✓ | ✓ |
| Terminal | demo banner | demo banner | full |

Every gate uses `requireAuth(intent)`: login carries `?next=` + a reason
line, completes the original action after auth, and announces claimed data
("Your 3 saved searches came with you").

---

## 7. What the sketches are

Self-contained TSX, inline mock data, current tokens only — for visual
review, then adoption per the frontend plan
(`docs/superpowers/plans/2026-07-12-frontend-form-function.md`, Phase N/F).

| File | Shows |
|---|---|
| `example-nav.tsx` | Header (both auth states), footer, mobile sheet, breadcrumbs |
| `example-home.tsx` | J1 — the 30-second pitch |
| `example-search.tsx` | J2 — workbench with coach marks + mobile tabs |
| `example-property-detail.tsx` | J3 — verdict-first dossier |
| `example-market.tsx` | J4 — ZIP dossier with handoff |
| `tokens.css` | Live palette + the few additions the sketches need |
