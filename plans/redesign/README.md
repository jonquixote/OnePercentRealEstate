# apps/one — IA & Redesign Sketches (2026-07-12)

Replaces the Cycle-3 "Private Bank" artifacts. That cycle's *visual* system
shipped (the live eggshell "line" tokens); what was never designed as a
whole is the **information architecture** — 16 routes accreted wave by wave,
market pages orphaned from nav, four overlapping tool pages, "Portfolio"
naming things it doesn't do.

**Start with `IA.md`.** It defines the four-destination model
(Search · Markets · Shelf · Playbook), the consolidations, the five core
journeys, state rules, and the auth-tier surface map. The sketches render
it:

| File | Journey | Shows |
|---|---|---|
| `example-nav.tsx` | — | Header (active-line indicator, both auth states), footer, mobile sheet, breadcrumbs |
| `example-home.tsx` | J1 | The 30-second pitch: thesis over the literal line, a real listing worked through the math, rent-heat teaser, markets grid |
| `example-search.tsx` | J2 | The workbench: toolbar diet, hover-sync cards⇄pins, coach mark, mobile List\|Map thumb control |
| `example-property-detail.tsx` | J3 | Verdict-first dossier: ratio gauge as the drawn line, banded rent, sticky rail → mobile bottom bar |
| `example-market.tsx` | J4 | ZIP dossier: sourced stat strip, HPI sparkline, honest "nothing clears here" state, scoped-search handoff, adjacent-ZIP loop |
| `tokens.css` | — | Mirror of the LIVE palette + the three NEW tokens the sketches add |

Every sketch: self-contained, `'use client'`, inline mock data, live tokens
only, no imports beyond React. Paste into a scratch route to preview.

Adoption path: `docs/superpowers/plans/2026-07-12-frontend-form-function.md`
(Phases N + F implement IA.md §2-3; the sketches are the visual acceptance
criteria for those tasks).

Design grammar the sketches enforce (IA.md §5): the line is structural, one
verdict per viewport, numbers are typography with provenance, serif speaks
twice per page, photography matted.
