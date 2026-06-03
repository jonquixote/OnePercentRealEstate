# Spike note — Monorepo + DB compression (2026-06-02)

**Decision: GO** for the comprehensive waved upgrade plan at `plans/use-your-tools-and-sprightly-cosmos.md`, with two adjustments to wave priorities (below).

## What we tested

### Morning — Monorepo restructure (`spike/monorepo` branch)
- `pnpm-workspace.yaml` + `turbo.json` at root
- `git mv` of `src/`, `public/`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs` into `apps/one/` (history preserved)
- New `apps/two/` scaffold: Next 16 + Tailwind v4 placeholder on port 3002
- New `packages/primitives/` with `cn` and `Button` extracted, exported via `@oper/primitives`
- Both apps import `Button` from `@oper/primitives` and build green
- `Dockerfile` rewritten for monorepo build of `@oper/one` (corepack-enabled pnpm, multi-stage with workspace install)
- `.dockerignore` updated for nested node_modules / .next

### Afternoon — DB compression on live (`onepercent-prod`, read-only + scratch table)
- Read-only baseline on `listings` (1,138 rows today; not the 1.2M targeted in the plan)
- Created `listings_spike_lz4` as `LIKE listings`, `SET COMPRESSION lz4` on `raw_data`, populated from real rows, measured, dropped. Zero impact on the real table.
- Measured wire bytes for `SELECT *` vs explicit-column SELECT (the proposed Wave 2 change)

## Results

### Monorepo (GO)
| Check | Result |
|---|---|
| `pnpm --filter=@oper/one build` | ✓ green |
| `pnpm --filter=@oper/two build` | ✓ green |
| Cross-package `Button` import in apps/two | ✓ resolves, renders |
| Tailwind v4 + Next 16 across packages | ✓ no surprise |
| Docker build path | refactored, not yet pushed to live |

**Two pre-existing type-drift fixes surfaced** (Stripe SDK `apiVersion` bumped to `2026-02-25.clover`; Recharts `Formatter` signature widened). Both committed to `main` separately (`dee6231`). Not monorepo-caused — `pnpm install` resolved newer minors than the old `package-lock.json` had pinned, exposing latent drift.

### DB (GO, but with reordered priorities)

**Current scale (live):**
- 1,138 rows in `listings`
- `pg_total_relation_size('listings')` = 5,824 kB
- TOAST = 3,952 kB (~68% of total)
- `raw_data` uncompressed avg = 3,053 bytes (p50 = 3,020 / p95 = 4,285 / max = 5,235)
- 100% of rows have `raw_data`
- Default compression is blank → pglz on PG16

**LZ4 vs pglz on real data:**
| Metric | pglz (current) | lz4 (test copy) | Δ |
|---|---|---|---|
| Table size | 5,088 kB | 4,840 kB | **-4.9%** |
| TOAST size | 3,952 kB | 3,824 kB | -3.2% |

**Excise raw_data from list responses (no compression involved):**
| Query | Payload | Per-row | Time |
|---|---|---|---|
| `SELECT * FROM listings LIMIT 100` | 433 kB | 4,434 B | 10.5 ms |
| `SELECT <explicit cols> FROM listings LIMIT 100` | 18 kB | 183 B | 0.5 ms |
| **Delta** | **24× smaller** | **24× smaller** | **20× faster** |

## What this changes in the plan

1. **Reorder Wave 1 / Wave 2 priorities.** The single biggest lever isn't LZ4 — it's excising `raw_data` from list responses. The wave plan already includes both; move the excise work earlier (start of Wave 1) and keep LZ4 + cold archive in Wave 1 as the second-priority items.
2. **De-emphasize cold-archive at current scale.** 1,138 rows × 5 kB = 5 MB. Cold-archive ship date can wait until `pg_total_relation_size('listings')` crosses ~100 MB or row count crosses ~10K, whichever first. Ship the migration (cheap) but don't run the nightly mover yet.
3. **LZ4 is still worth shipping.** Even at 5% space delta, it gives us a faster decompression path that pays off when row count grows. Migration cost is low. Wave 1 keeps it.
4. **Agent normalization is now Wave 3+.** At 1K rows the savings are ~170 KB total. Defer.
5. **The 10M-row target is a target, not current state.** Plan budgets (e.g. "57 GB at 10M") still hold for sizing but the urgency profile is gentler than the plan implied. Wave 0 + the excise work can ship without panic.

## Files touched on the spike branch

- root: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, root `package.json` (workspaces only), `.dockerignore`, `.gitignore`, `Dockerfile`
- `apps/one/` — moved Next.js source + new `package.json`, `tsconfig.json`
- `apps/two/` — new minimal Next 16 + Tailwind v4 scaffold
- `packages/primitives/` — `cn`, `Button`, `index.ts`, `package.json`, `tsconfig.json`

## Next step

Open Wave 0 PR from `spike/monorepo` → `main`. Promote the spike commit, attach this note, and continue Wave 1 work (excise-raw_data + LZ4 + media abstraction columns) on a fresh branch off the merged Wave 0.
