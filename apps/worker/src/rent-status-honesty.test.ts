import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NON_RENTABLE_SETTLE_SQL, NO_GEO_SETTLE_SQL } from './rent-settle-sql.js';

/**
 * Regression guard for the exact defect these statements caused on prod:
 * 88,188 listings marked `done` while holding no estimate, because "done"
 * was overloaded to mean "finished processing".
 */
describe('rent_calc_status honesty', () => {
  it('never marks a NULL-rent row as done', () => {
    expect(NON_RENTABLE_SETTLE_SQL).toContain('estimated_rent = NULL');
    expect(NON_RENTABLE_SETTLE_SQL).toContain("rent_calc_status = 'not_applicable'");
    expect(NON_RENTABLE_SETTLE_SQL).not.toContain("rent_calc_status = 'done'");
  });

  it('records why a row was settled without an estimate', () => {
    expect(NON_RENTABLE_SETTLE_SQL).toMatch(/rent_calc_error = '[^']+'/);
  });

  it('records why an ungeocodable row failed', () => {
    expect(NO_GEO_SETTLE_SQL).toContain("rent_calc_status = 'failed'");
    expect(NO_GEO_SETTLE_SQL).toMatch(/rent_calc_error = '[^']+'/);
  });

  it('only ever settles rows that are still pending', () => {
    for (const sql of [NON_RENTABLE_SETTLE_SQL, NO_GEO_SETTLE_SQL]) {
      expect(sql).toContain("rent_calc_status = 'pending'");
    }
  });

  it('stays bounded — every settle pass is a limited page', () => {
    for (const sql of [NON_RENTABLE_SETTLE_SQL, NO_GEO_SETTLE_SQL]) {
      expect(sql).toContain('LIMIT $1');
    }
  });
});

/**
 * The SQL-literal checks above missed a real defect: the realtime path called
 * `markDone(listingId, 0, 'non_rentable_skip', …)` — a function call, not a SQL
 * string — so it wrote 'done' with a rent of 0 and violated
 * listings_done_implies_rent in production the moment that constraint was
 * tightened. Guard the call sites too, not just the queries.
 */
describe('markDone call sites', () => {
  // Strip comments first. The prose describing this very defect contains
  // `markDone(…, 0, …)`, and a guard that its own documentation trips is a
  // guard nobody keeps.
  const src = readFileSync(join(__dirname, 'rent-estimator.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never calls markDone with a literal zero rent', () => {
    const calls = [...src.matchAll(/markDone\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      const second = args.split(',')[1]?.trim();
      expect(second).not.toBe('0');
    }
  });

  it('the guard is not fooled by its own documentation', () => {
    // Sanity: the file DOES contain that string in a comment.
    const raw = readFileSync(join(__dirname, 'rent-estimator.ts'), 'utf8');
    expect(raw).toContain('markDone(…, 0, …)');
    expect(src).not.toContain('markDone(…, 0, …)');
  });

  it('settles non-rentable listings as not_applicable, not done', () => {
    expect(src).toContain('markNotApplicable');
    expect(src).not.toMatch(/markDone\([^)]*'non_rentable_skip'/);
  });
});
