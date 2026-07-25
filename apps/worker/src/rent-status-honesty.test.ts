import { describe, it, expect } from 'vitest';
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
