import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { normalizeSql, reportSlowQuery, __resetSlowQuery, slowQueryThresholdMs } from './slow-query.js';

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'));

beforeEach(() => {
  __resetSlowQuery();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
  vi.stubEnv('TELEGRAM_CHAT_ID', '123');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('normalizeSql', () => {
  it('collapses whitespace so formatting differences share a key', () => {
    expect(normalizeSql('SELECT  a\n  FROM t')).toBe(normalizeSql('SELECT a FROM t'));
  });

  it('strips literals so the same query with different params dedups together', () => {
    expect(normalizeSql("SELECT * FROM l WHERE zip = '77002'"))
      .toBe(normalizeSql("SELECT * FROM l WHERE zip = '44102'"));
    expect(normalizeSql('SELECT * FROM l WHERE id = 12')).toBe(normalizeSql('SELECT * FROM l WHERE id = 987'));
  });

  it('keeps genuinely different queries apart', () => {
    expect(normalizeSql('SELECT a FROM t')).not.toBe(normalizeSql('SELECT b FROM t'));
  });
});

describe('reportSlowQuery', () => {
  it('does not alert below the threshold', async () => {
    reportSlowQuery('SELECT 1', slowQueryThresholdMs() - 1);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('alerts once on breach and dedups the immediate repeat', async () => {
    reportSlowQuery("SELECT * FROM listings WHERE zip = '77002'", 2500);
    reportSlowQuery("SELECT * FROM listings WHERE zip = '44102'", 2600);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain('2500');
    expect(body).toContain('listings');
  });

  it('alerts again for a different query', async () => {
    reportSlowQuery('SELECT a FROM t', 2000);
    reportSlowQuery('SELECT b FROM t', 2000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws or rejects when the notifier fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(() => reportSlowQuery('SELECT slow FROM t', 9000)).not.toThrow();
    await flush();
  });

  it('stays silent when telegram is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    reportSlowQuery('SELECT x FROM t', 5000);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours SLOW_QUERY_MS', () => {
    vi.stubEnv('SLOW_QUERY_MS', '250');
    expect(slowQueryThresholdMs()).toBe(250);
  });
});
