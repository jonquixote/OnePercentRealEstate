import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * apps/two does not currently select a photo column — it queries `listings`
 * only for `fips_code`, and its `primary_photo` field arrives from an API
 * payload. So this guard passes trivially today, on purpose.
 *
 * It exists because the defect it guards against was invisible for months in
 * apps/one: seven read paths selected the bare `primary_photo` column, which
 * was populated on 140 of 449,654 active listings, and one used it as a WHERE
 * filter that silently restricted the homepage to those 140. A route added to
 * the terminal tomorrow would reproduce it, and nothing would notice.
 *
 * The rule: any SQL selecting primary_photo must COALESCE to the images jsonb,
 * because the crawler inserts continuously and a row can always exist that the
 * backfill has not reached.
 */

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Bare `primary_photo` inside a SQL literal, ignoring comments and aliases. */
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
    const aliasDef = sql.search(/COALESCE\s*\([^)]*primary_photo[^)]*\)\s+AS\s+primary_photo/i);
    for (const m of sql.matchAll(/(COALESCE\s*\(\s*)?([a-z]+\.)?\bprimary_photo\b/gi)) {
      const before = sql.slice(Math.max(0, m.index - 4), m.index);
      if (m[1] || /\bAS\s+$/i.test(before) || (aliasDef !== -1 && m.index > aliasDef)) continue;
      hits.push(sql.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, ' ').trim());
    }
  }
  return hits;
}

describe('apps/two photo read paths', () => {
  it('no SQL selects the bare primary_photo column', () => {
    const offenders = walk(SRC)
      .map((f) => ({ file: f.replace(SRC, ''), hits: bareSelections(readFileSync(f, 'utf8')) }))
      .filter((r) => r.hits.length > 0);
    expect(offenders).toEqual([]);
  });

  it('the guard detects a bare selection and a bare WHERE filter', () => {
    expect(bareSelections('const q = `SELECT a, primary_photo FROM listings`')).toHaveLength(1);
    expect(bareSelections('const q = `SELECT id FROM listings l WHERE l.primary_photo IS NOT NULL`')).toHaveLength(1);
  });

  it('the guard accepts a coalesced selection', () => {
    expect(bareSelections('const q = `SELECT COALESCE(primary_photo, images->>0) AS primary_photo FROM listings`')).toEqual([]);
  });
});
