import { afterEach, describe, expect, it } from 'vitest';
import { FOR_SALE_PAST_DAYS, RECENT_PAST_DAYS, pastDaysForRecord } from './crawl-windows.js';

// crawl_jobs.past_days exists so a throughput number can be attributed to the
// parameters that produced it. That only works if the recorded value is the
// value the scrape actually sent.
//
// It wasn't. pastDaysForRecord() read process.env.SCRAPE_PAST_DAYS while the
// passes hardcoded 30 and 14, so prod recorded past_days=90 on all 5,715 jobs
// while sending 30. These tests exist so that cannot silently recur.

describe('pastDaysForRecord', () => {
  const original = process.env.SCRAPE_PAST_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.SCRAPE_PAST_DAYS;
    else process.env.SCRAPE_PAST_DAYS = original;
  });

  it('reports the window the for_sale pass actually sends', () => {
    expect(pastDaysForRecord()).toBe(FOR_SALE_PAST_DAYS);
  });

  it('ignores SCRAPE_PAST_DAYS, which is inert and must not be recorded as truth', () => {
    // The exact prod value that produced the false record.
    process.env.SCRAPE_PAST_DAYS = '90';
    expect(pastDaysForRecord()).toBe(30);
    expect(pastDaysForRecord()).not.toBe(90);
  });

  it('never reports null — a job always ran with some window', () => {
    process.env.SCRAPE_PAST_DAYS = '';
    expect(pastDaysForRecord()).toBe(30);
  });
});

describe('crawl windows', () => {
  it('keeps the sold/pending lookback shorter than the for_sale window', () => {
    // sold and pending only need to overlap the sweep; widening them would add
    // pages to every job on the densest ZIPs, which is where the runner time
    // already goes (docs/perf/2026-08-sweep-fairness-audit.md).
    expect(RECENT_PAST_DAYS).toBeLessThan(FOR_SALE_PAST_DAYS);
  });
});
