import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for the defect measured on prod 2026-07-25: 446,437 of
 * 449,654 active listings had images, only 140 had the native `primary_photo`
 * column, and /api/properties/viewport returned 0 photos out of 293 rows.
 *
 * The column is backfilled now, but the crawler inserts new listings
 * continuously, so a row can always exist that the backfill has not reached.
 * Every read path must therefore fall back to the jsonb. One route already
 * did this — and carried a comment explaining why — while seven others did
 * not, which is exactly how the gap survived unnoticed.
 */

const ROOT = join(__dirname, '..');

const READ_PATHS = [
  'app/api/properties/viewport/route.ts',
  'app/api/properties/route.ts',
  'app/api/properties/query/route.ts',
  'app/api/v1/listings/route.ts',
  'app/api/alerts/route.ts',
  'app/api/featured/route.ts',
  'app/api/saved-properties/route.ts',
  'app/market/[zip]/page.tsx',
  'lib/queries/property.ts',
  'lib/spotlight.ts',
];

/**
 * Scans only SQL string literals (template literals containing SELECT), so TS
 * property declarations and object destructuring never trip the guard, and an
 * inline `SELECT a, b, primary_photo, c` is caught as readily as one where the
 * column sits on its own line.
 */
function bareSelections(src: string): string[] {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const sqlLiterals = [...noComments.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((lit) => /\bSELECT\b/i.test(lit));

  const hits: string[] = [];
  for (const lit of sqlLiterals) {
    const sql = lit.replace(/--.*$/gm, '');
    // Where a CTE defines the coalesced value once, later bare references are
    // the alias, not the raw column.
    const aliasDef = sql.search(/COALESCE\s*\([^)]*primary_photo[^)]*\)\s+AS\s+primary_photo/i);
    const re = /(COALESCE\s*\(\s*)?([a-z]+\.)?\bprimary_photo\b/gi;
    for (const m of sql.matchAll(re)) {
      const isCoalesced = !!m[1];
      const before = sql.slice(Math.max(0, m.index - 4), m.index);
      const isAlias = /\bAS\s+$/i.test(before);
      const afterAliasDef = aliasDef !== -1 && m.index > aliasDef;
      if (!isCoalesced && !isAlias && !afterAliasDef) {
        hits.push(sql.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, ' ').trim());
      }
    }
  }
  return hits;
}

describe('photo read paths', () => {
  it.each(READ_PATHS)('%s falls back to the images jsonb', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    expect(bareSelections(src)).toEqual([]);
  });

  it('the guard detects bare selections, on their own line or inline', () => {
    expect(bareSelections('const q = `SELECT id,\n  primary_photo,\n  price`')).toHaveLength(1);
    expect(bareSelections('const q = `SELECT a, b, primary_photo, c FROM listings`')).toHaveLength(1);
    expect(bareSelections('const q = `SELECT l.primary_photo FROM listings l`')).toHaveLength(1);
  });

  it('the guard still catches a bare WHERE filter, which no alias can excuse', () => {
    expect(bareSelections(
      'const q = `SELECT id FROM listings l WHERE l.primary_photo IS NOT NULL`',
    )).toHaveLength(1);
  });

  it('the guard accepts a CTE that defines the alias once and reuses it', () => {
    expect(bareSelections(
      'const q = `WITH r AS (SELECT COALESCE(primary_photo, images->>0) AS primary_photo FROM listings) ' +
      'SELECT id, primary_photo FROM r`',
    )).toEqual([]);
  });

  it('the guard accepts a coalesced selection and ignores non-SQL mentions', () => {
    expect(bareSelections('const q = `SELECT COALESCE(primary_photo, images->>0) AS primary_photo`')).toEqual([]);
    expect(bareSelections('interface P { primary_photo?: string | null }')).toEqual([]);
    expect(bareSelections('// primary_photo is only 0.3% populated')).toEqual([]);
  });
});
