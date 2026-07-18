import { describe, it, expect } from 'vitest';
import { STALE_SQL, SOLD_MATCH_SQL, PENDING_FLAG_SQL, RECHECK_ENQUEUE_SQL } from './lifecycle';

describe('lifecycle SQL', () => {
  it('stale: only active/pending_verify for_sale rows, param-driven cutoff, never sold/misfiled', () => {
    expect(STALE_SQL).toMatch(/listing_status\s+IN\s+\('active','pending_verify'\)/i);
    expect(STALE_SQL).toMatch(/last_seen_at\s*<\s*now\(\)\s*-\s*\(\$1\s*\|\|\s*' days'\)::interval/i);
    expect(STALE_SQL).toMatch(/SET\s+listing_status\s*=\s*'stale'/i);
  });
  it('sold match: exact address join to sold_listings, copies price/date', () => {
    // Both tables build address with the SAME scraper normalization, so raw
    // equality is index-friendly (no lower/trim wrappers defeating indexes).
    expect(SOLD_MATCH_SQL).toMatch(/l\.address\s*=\s*s\.address/i);
    expect(SOLD_MATCH_SQL).toMatch(/SET\s+listing_status\s*=\s*'sold',\s*sold_price/i);
  });
  it('pending flag: aged PENDING/CONTINGENT clearers become pending_verify', () => {
    expect(PENDING_FLAG_SQL).toMatch(/raw_data->>'status'\s+IN\s+\('PENDING','CONTINGENT'\)/);
    expect(PENDING_FLAG_SQL).toMatch(/pending_verify/);
  });
  it('recheck enqueue: distinct zips, capped batch, idempotent against open jobs', () => {
    expect(RECHECK_ENQUEUE_SQL).toMatch(/INSERT INTO crawl_jobs/i);
    expect(RECHECK_ENQUEUE_SQL).toMatch(/LIMIT \$1/);
    expect(RECHECK_ENQUEUE_SQL).toMatch(/NOT EXISTS/i); // no dup open job for the zip
  });
});
