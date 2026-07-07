# apps/one Redesign — "Private Bank for Property"

Design artifacts for the Cycle-3 frontend overhaul. Every file here is a
SELF-CONTAINED, non-wired example (mock data inline) meant for visual review
and then adoption per the coder spec
(`docs/superpowers/specs/2026-07-07-frontend-overhaul-design.md`).

## Design thesis

The current dark "line" system is right in spirit — one memorable motif (the
1% rule line), ink surfaces, emerald pass / brass caution. What it lacks is
*restraint and hierarchy*: everything currently speaks at the same volume.
The redesign keeps the brand and adds the discipline of a private-bank
statement: editorial serif display over quiet ink, hairline rules instead of
boxes, one accent per view, numbers set like typography (tabular, weighted by
importance), photography in dark mats, and data-viz that looks engraved
rather than dashboard-y.

Rules:
1. **Serif display, sans data.** Fraunces (or Playfair) for headlines only;
   Geist for UI; JetBrains Mono for figures where alignment matters.
2. **Hairlines, not cards-in-boxes.** 1px `--line` rules + whitespace carry
   structure; panels reserved for interactive surfaces.
3. **One accent per view.** Emerald = passes/positive. Brass = seller
   opportunity (cuts, motivation). Never both shouting on one component.
4. **Confidence is a first-class visual.** Every model number renders with
   its band (the p10–p90 range bar) and its provenance chip. No naked
   estimates anywhere.
5. **Photography in mats.** Images sit inside 1px-ruled dark mats with
   generous padding — gallery, not listing-site.

Files: tokens.css · example-home.tsx · example-property-detail.tsx ·
example-search.tsx · example-market.tsx
