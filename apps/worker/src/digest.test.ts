import { describe, it, expect, beforeAll, vi } from 'vitest';

// digest.ts (and its transitive imports) call loadEnv() at import time, so
// DATABASE_URL must be present before the modules are imported.
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';
});

// Shared mock pool factory (mirrors alerts.test.ts idiom): a pool whose
// `connect` returns a client whose `query` dispatches by substring match
// against the provided rowsBySql map.
function makePool(rowsBySql: Record<string, { rows: any[]; rowCount?: number }>) {
  const query = async (text: string, _params?: any[]) => {
    const key = Object.keys(rowsBySql).find((k) => text.includes(k));
    const hit = key ? rowsBySql[key] : { rows: [], rowCount: 0 };
    return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
  };
  const pool: any = { query, connect: async () => poolClient };
  const poolClient = { query, release: () => {} };
  return { pool, query };
}

// alert_events rows used across tests. delivered_at IS NULL (undelivered).
const ev = (id: number, userId: string, listingId: number, label = 'Houston') => ({
  id,
  user_id: userId,
  listing_id: listingId,
  source_label: label,
  ratio: 0.0125,
  price: 120000,
});

// listing join payload (only `active` rows should be delivered).
// Note: DO NOT include an `id` key here — the joined row already carries the
// alert_events `id` (event id), and spreading a listing `id` would clobber it.
const listing = (id: number) => ({
  address: `Deal St ${id}`,
  city: 'Houston',
  state: 'TX',
  zip_code: '77002',
  primary_photo: null,
  rent_price_ratio: 0.0125,
  price: 120000,
});

const profile = (userId: string, email: string | null, alertOptIn: boolean) => ({
  email,
  prefs: { alertOptIn },
});

const ALERT_DELIVERY_SQL = 'ae.delivered_at IS NULL'; // substring unique to the delivery query
const MARK_SQL = 'SET delivered_at = now()';

describe('deliverAlertEvents (TDD — should FAIL until implemented)', () => {
  it('sends ONE email for an opted-in user with 2 undelivered events, then marks both delivered by event id', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    const sent: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      sent.push(body.to);
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(101, 'u1', 201), ...listing(201), ...profile('u1', 'u1@x.com', true) },
          { ...ev(102, 'u1', 202), ...listing(202), ...profile('u1', 'u1@x.com', true) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 2 },
    });

    const calls: string[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push(text + (p ? ' :: ' + String(p) : ''));
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    const log = { info: () => {}, warn: () => {}, error: () => {} };
    await deliverAlertEvents(pool, log as any);

    expect(sent).toEqual(['u1@x.com']);
    const markCalls = calls.filter((c) => c.includes(MARK_SQL));
    expect(markCalls).toHaveLength(1);
    // The exact undelivered event ids (101, 102) must be in the mark params.
    const markParams = markCalls.map((c) => c.split(':: ')[1] ?? '').join(' ');
    expect(markParams).toContain('101');
    expect(markParams).toContain('102');
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('does NOT send and does NOT mark for a user with alertOptIn != true', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    const sent: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      sent.push(body.to);
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(201, 'u2', 301), ...listing(301), ...profile('u2', 'u2@x.com', false) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 0 },
    });
    const calls: string[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push(text);
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(sent).toHaveLength(0);
    expect(calls.some((c) => c.includes(MARK_SQL))).toBe(false);
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('does NOT send when the user has no email', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    const sent: string[] = [];
    globalThis.fetch = (async (_url: any) => {
      sent.push('CALLED');
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(301, 'u3', 401), ...listing(401), ...profile('u3', null, true) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 0 },
    });
    const calls: string[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push(text);
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(sent).toHaveLength(0);
    expect(calls.some((c) => c.includes(MARK_SQL))).toBe(false);
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('skips entirely when RESEND_API_KEY is absent (no send, no mark)', async () => {
    const { deliverAlertEvents } = await import('./digest');
    delete process.env.RESEND_API_KEY;
    const sent: string[] = [];
    globalThis.fetch = (async () => {
      sent.push('CALLED');
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(401, 'u4', 501), ...listing(501), ...profile('u4', 'u4@x.com', true) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 0 },
    });
    const calls: string[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push(text);
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(sent).toHaveLength(0);
    expect(calls.some((c) => c.includes(MARK_SQL))).toBe(false);
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('retry-safe: an already-delivered event is excluded and never re-sent', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    const sentHtml: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      sentHtml.push(body.html);
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    // Event 999 is already delivered: the SQL `delivered_at IS NULL` guard
    // filters it out, so ALERT_DELIVERY_SQL returns ONLY the undelivered 501.
    // 999 must therefore never reach the email body nor the mark params.
    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(501, 'u5', 601), ...listing(601), ...profile('u5', 'u5@x.com', true) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 1 },
    });
    // Capture BOTH sql text and params so the assertion is not vacuous.
    const calls: { text: string; params: any[] }[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push({ text, params: p ?? [] });
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(sentHtml).toHaveLength(1);
    const html = sentHtml[0];
    expect(html).toContain('Deal St 601');

    // The mark query must be called with exactly the undelivered event id (501).
    const markCall = calls.find((c) => c.text.includes(MARK_SQL));
    expect(markCall).toBeDefined();
    const markIds = (markCall!.params[0] ?? []) as string[];
    expect(markIds).toContain('501');
    // The delivered event 999 never reaches the mark params nor the email body.
    expect(markIds.some((id) => String(id) === '999')).toBe(false);
    expect(html).not.toContain('999');
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('send THROWS → delivered_at NOT stamped for that user (run continues)', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    // fetch throws → sendAlertEmails catches internally and returns 0.
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as any;

    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: {
        rows: [
          { ...ev(601, 'u6', 701), ...listing(701), ...profile('u6', 'u6@x.com', true) },
          { ...ev(602, 'u7', 702), ...listing(702), ...profile('u7', 'u7@x.com', true) },
        ],
      },
      [MARK_SQL]: { rows: [], rowCount: 0 },
    });
    const calls: string[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push(text);
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    // Should not throw; both users' send failed → no mark stamps.
    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(calls.some((c) => c.includes(MARK_SQL))).toBe(false);
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('caps at 20 events per email: 21 undelivered → 20 sent+marked, 1 stays undelivered', async () => {
    const { deliverAlertEvents } = await import('./digest');
    process.env.RESEND_API_KEY = 're_test_key';
    const sentHtml: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      sentHtml.push(body.html);
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;

    // 21 undelivered events for one opted-in user; ids 1..21, listings 1..21.
    const rows = Array.from({ length: 21 }, (_, i) => ({
      ...ev(i + 1, 'u8', i + 1),
      ...listing(i + 1),
      ...profile('u8', 'u8@x.com', true),
    }));
    const { pool, query } = makePool({
      [ALERT_DELIVERY_SQL]: { rows },
      [MARK_SQL]: { rows: [], rowCount: 20 },
    });
    const calls: { text: string; params: any[] }[] = [];
    pool.query = (async (text: string, p?: any[]) => {
      calls.push({ text, params: p ?? [] });
      return query(text, p);
    }) as any;
    pool.connect = async () => ({ query: pool.query, release: () => {} });

    await deliverAlertEvents(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);

    // Exactly one email sent.
    expect(sentHtml).toHaveLength(1);
    // Mark params carry exactly 20 ids — the newest 20 (rows[0..19] → ids 1..20).
    const markCall = calls.find((c) => c.text.includes(MARK_SQL));
    expect(markCall).toBeDefined();
    const markIds = (markCall!.params[0] ?? []) as string[];
    expect(markIds).toHaveLength(20);
    // Event 21 (the overflow) is NOT marked → stays undelivered for next run.
    expect(markIds.some((id) => String(id) === '21')).toBe(false);
    expect(markIds).toContain('1');
    expect(markIds).toContain('20');
    globalThis.fetch = (async () => ({} as any)) as any;
  });
});
