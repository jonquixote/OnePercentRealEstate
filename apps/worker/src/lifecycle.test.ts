import { describe, it, expect } from 'vitest';
import {
  REVIVE_SQL,
  STALE_SQL,
  SOLD_MATCH_SQL,
  PENDING_FLAG_SQL,
  RECHECK_ENQUEUE_SQL,
  runLifecycleTick,
} from './lifecycle';

describe('revive: a listing the crawler sees again must come back', () => {
  // 35,521 for_sale rows were marked 'stale' while the crawler had seen them
  // within THREE DAYS — 3,287 within 24 hours. The reaper demoted them and
  // nothing ever promoted them back, so a listing that returned to market
  // stayed hidden from the product forever.
  it('promotes stale rows re-seen inside the cutoff', () => {
    expect(REVIVE_SQL).toMatch(/SET\s+listing_status\s*=\s*'active'/i);
    expect(REVIVE_SQL).toMatch(/listing_status\s*=\s*'stale'/i);
    expect(REVIVE_SQL).toMatch(/last_seen_at\s*>\s*now\(\)\s*-\s*\(\$1\s*\|\|\s*' days'\)::interval/i);
  });

  it('only for_sale, and never touches sold or rental_misfiled', () => {
    expect(REVIVE_SQL).toMatch(/listing_type\s*=\s*'for_sale'/i);
    expect(REVIVE_SQL).not.toMatch(/'sold'/i);
    expect(REVIVE_SQL).not.toMatch(/rental_misfiled/i);
  });

  it('is the exact inverse of the reaper, so the pair cannot oscillate', () => {
    // Reaper: stale when last_seen_at <  cutoff. Revive: active when >  cutoff.
    // Same column, same bound param, opposite comparison — a row can satisfy
    // exactly one of them at any instant.
    expect(STALE_SQL).toMatch(/last_seen_at\s*</);
    expect(REVIVE_SQL).toMatch(/last_seen_at\s*>/);
  });
});

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

describe('runLifecycleTick orchestration (mock pool)', () => {
  const cfg = { staleAfterDays: 10, pendingVerifyAfterDays: 7, recheckBatch: 40 };
  const noop = { info: () => {} } as any;

  // A fake pool that records every (sql, params) call and returns the rowCounts
  // in call order, so we can assert the 4 steps run in order with the right
  // params and that stats aggregate the rowCounts.
  function recordingPool(rowCounts: Array<number | null>) {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    let i = 0;
    const pool = {
      query: async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        return { rowCount: rowCounts[i++] };
      },
    };
    return { pool, calls };
  }

  it('runs stale → revive → sold → pending → recheck in order with the right params', async () => {
    const { pool, calls } = recordingPool([3, 4, 5, 7, 2]);
    const stats = await runLifecycleTick(pool as any, noop, cfg);

    // Order: exactly the 4 exported SQL constants, in sequence.
    expect(calls.map((c) => c.sql)).toEqual([
      STALE_SQL,
      REVIVE_SQL,
      SOLD_MATCH_SQL,
      PENDING_FLAG_SQL,
      RECHECK_ENQUEUE_SQL,
    ]);
    // Params threaded from cfg; SOLD_MATCH_SQL takes none.
    expect(calls[0].params).toEqual([10]); // staleAfterDays
    // Revive shares the reaper's cutoff on purpose: same column, opposite
    // comparison, so a row can satisfy only one of them.
    expect(calls[1].params).toEqual([10]); // staleAfterDays
    expect(calls[2].params).toBeUndefined(); // sold match — no bind
    expect(calls[3].params).toEqual([7]); // pendingVerifyAfterDays
    expect(calls[4].params).toEqual([40]); // recheckBatch

    // Stats aggregate the per-step rowCounts.
    expect(stats).toEqual({
      staled: 3,
      revived: 4,
      soldMatched: 5,
      pendingFlagged: 7,
      rechecksEnqueued: 2,
    });
  });

  it('coerces a null rowCount to 0', async () => {
    const { pool } = recordingPool([null, null, null, null, null]);
    const stats = await runLifecycleTick(pool as any, noop, cfg);
    expect(stats).toEqual({
      staled: 0,
      revived: 0,
      soldMatched: 0,
      pendingFlagged: 0,
      rechecksEnqueued: 0,
    });
  });
});
