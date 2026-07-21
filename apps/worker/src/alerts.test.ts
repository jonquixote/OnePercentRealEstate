import { describe, it, expect, beforeAll } from 'vitest';

// alerts.ts calls loadEnv() at import time (and transitively watchlist-alerts.ts
// does too), so DATABASE_URL must be present before the modules are imported.
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';
  // Use a non-dummy key so instant-email fanout is exercised (fetch is stubbed
  // per-test). The 'dummy_key_for_dev' sentinel in code disables sending.
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';
});

describe('alerts SQL shape', () => {
  it('CANDIDATES_SQL is parameterized by a watermark and bounds 1%-clearers', async () => {
    const { CANDIDATES_SQL } = await import('./alerts');
    expect(CANDIDATES_SQL).toContain('last_seen_at > $1');
    expect(CANDIDATES_SQL).toContain('rent_price_ratio >= 0.01');
    // Mirrors RENT_TRUST.maxRatio (0.02) from apps/one/src/lib/rent-trust.ts.
    // Bulk-feed SQL proxy for the absolute plausibility ceiling. Threshold
    // values must be kept identical to RENT_TRUST.maxRatio; both cite each other.
    expect(CANDIDATES_SQL).toContain('rent_price_ratio <= 0.02');
    expect(CANDIDATES_SQL).toContain('price >= 30000');
  });

  it('CANDIDATES_SQL_NO_LIFECYCLE also applies the 0.02 ceiling', async () => {
    const { CANDIDATES_SQL_NO_LIFECYCLE } = await import('./alerts');
    expect(CANDIDATES_SQL_NO_LIFECYCLE).toContain('rent_price_ratio >= 0.01');
    expect(CANDIDATES_SQL_NO_LIFECYCLE).toContain('rent_price_ratio <= 0.02');
  });

  it('INSERT_EVENT_SQL dedups with ON CONFLICT (user_id, listing_id) DO NOTHING', async () => {
    const { INSERT_EVENT_SQL } = await import('./alerts');
    expect(INSERT_EVENT_SQL).toContain('ON CONFLICT (user_id, listing_id) DO NOTHING');
    expect(INSERT_EVENT_SQL).toContain('INSERT INTO alert_events');
  });
});

describe('matchAreas (pure)', () => {
  const cand = (zip: string | null, id = 1) => ({
    id,
    address: '123 Main',
    zip_code: zip,
    price: 100000,
    estimated_rent: 1000,
    rent_price_ratio: 0.01,
  });

  it('matches a user area to a candidate by exact ZIP', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([cand('77002')], [{ id: 'u1', areas: ['77002'] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', listing_id: 1, source: 'area', source_label: '77002' });
  });

  it('does not match a different ZIP', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([cand('77003')], [{ id: 'u1', areas: ['77002'] }]);
    expect(rows).toHaveLength(0);
  });

  it('drops candidates with malformed/missing zip', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas(
      [cand(null), cand('')],
      [{ id: 'u1', areas: ['77002'] }],
    );
    expect(rows).toHaveLength(0);
  });

  it('matches the same candidate for multiple users', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas(
      [cand('77002')],
      [{ id: 'u1', areas: ['77002'] }, { id: 'u2', areas: ['77002', '77003'] }],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.user_id).sort()).toEqual(['u1', 'u2']);
  });

  it('matches the prefs-schema {zip, label} area objects and uses the label', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas(
      [cand('77002')],
      [{ id: 'u1', areas: [{ zip: '77002', label: 'Houston' }] }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', listing_id: 1, source: 'area', source_label: 'Houston' });
  });

  it('falls back to the zip as source_label when an area object has no label', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas(
      [cand('44102')],
      [{ id: 'u1', areas: [{ zip: '44102' }] }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_label).toBe('44102');
  });

  it('drops malformed area objects without a string zip', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas(
      [cand('77002')],
      [{ id: 'u1', areas: [{ zip: 77002 }, { label: 'Houston' }, null, 42] }],
    );
    expect(rows).toHaveLength(0);
  });

  const candHouston = {
    id: 7,
    address: '9 Suburb Ln',
    zip_code: '77099',
    city: 'Houston',
    state: 'TX',
    price: 120000,
    estimated_rent: 1300,
    rent_price_ratio: 0.0108,
  };

  it('matches an area to any candidate in the same city+state', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([candHouston as any], [
      { id: 'u1', areas: [{ zip: '77002', label: 'Houston', city: 'Houston', state: 'TX' }] } as any,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', listing_id: 7, source: 'area', source_label: 'Houston' });
  });

  it('city match is case-insensitive and state exact', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([{ ...candHouston, city: 'HOUSTON' } as any], [
      { id: 'u1', areas: [{ zip: '00000', label: 'H', city: 'houston', state: 'TX' }] } as any,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('emits ONE row when both zip and city match the same listing', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([{ ...candHouston, zip_code: '77002' } as any], [
      { id: 'u1', areas: [{ zip: '77002', label: 'Houston', city: 'Houston', state: 'TX' }] } as any,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('old ZIP-only blobs keep matching by zip alone', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([{ ...candHouston, zip_code: '77002', city: null } as any], [
      { id: 'u1', areas: [{ zip: '77002', label: 'Houston' }] } as any,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('area with city but NO state does not city-match', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([candHouston as any], [
      { id: 'u1', areas: [{ zip: '99999', label: 'H', city: 'Houston' }] } as any,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('area with state but NO city does not city-match', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([candHouston as any], [
      { id: 'u1', areas: [{ zip: '99999', label: 'H', state: 'TX' }] } as any,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('city match does not fire on city alone when states differ', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([candHouston as any], [
      { id: 'u1', areas: [{ zip: '00000', label: 'H', city: 'Houston', state: 'CA' }] } as any,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('candidate with null city/state does not falsely match and does not throw', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([{ ...candHouston, city: null, state: null } as any], [
      { id: 'u1', areas: [{ zip: '99999', label: 'H', city: 'Houston', state: 'TX' }] } as any,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('dedups: a candidate matching by zip (area A) AND city+state (area B) yields ONE row', async () => {
    const { matchAreas } = await import('./alerts');
    const rows = matchAreas([{ ...candHouston, zip_code: '77002' } as any], [
      {
        id: 'u1',
        areas: [
          { zip: '77002', label: 'ZIP Area' },
          { zip: '00000', label: 'City Area', city: 'Houston', state: 'TX' },
        ],
      } as any,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', listing_id: 7 });
  });
});

describe('runAlertTick tier split', () => {
  function makePool(rowsBySql: Record<string, { rows: any[]; rowCount?: number }>) {
    const query = async (text: string, _params?: any[]) => {
      const key = Object.keys(rowsBySql).find((k) => text.includes(k));
      const hit = key ? rowsBySql[key] : { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    };
    const pool: any = { query, connect: async () => poolClient };
    const poolClient = {
      query,
      release: () => {},
    };
    return { pool, query };
  }

  const mkSql = 'SELECT id, subscription_tier, prefs, email';
  const mkNoPrefsSql = 'SELECT id, subscription_tier, email';
    const candSql = 'last_seen_at >';
  const wmSql = 'SELECT last_seen_at FROM alert_state';
  const setWmSql = 'INSERT INTO alert_state';
  const insSql = 'INSERT INTO alert_events';
  const markSql = 'UPDATE alert_events';

  it('instant-fans out pro users and leaves free users untouched', async () => {
    const { runAlertTick } = await import('./alerts');
    const calls: string[] = [];
    const resendRecipients: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      resendRecipients.push(body.to);
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;
    const { pool, query } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000,
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      [mkSql]: {
        rows: [
          { id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'], alertOptIn: true }, email: 'pro1@example.com' },
          { id: 'free1', subscription_tier: 'free', prefs: { areas: ['77002'] }, email: 'free1@example.com' },
        ],
      },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
    });
    const origQuery = pool.query;
    pool.query = async (text: string, p?: any[]) => {
      calls.push(text);
      return origQuery(text, p);
    };
    const poolClient = { query: pool.query, release: () => {} };
    pool.connect = async () => poolClient;

    const res = await runAlertTick(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(res.eventsInserted).toBeGreaterThanOrEqual(1); // pro1 + free1 both inserted (bulk = single round-trip)
    // Pro user marked delivered; free user NOT in any mark query.
    const markCalls = calls.filter((c) => c.includes(markSql));
    expect(markCalls.length).toBe(1);
    // Free user must never be stamped delivered.
    expect(markCalls.join(' ')).not.toContain('free1');
    // Instant email must go to the pro user's ADDRESS, not their id.
    expect(resendRecipients).toEqual(['pro1@example.com']);
    globalThis.fetch = realFetch;
  });

  it('matches candidates to watchlists in memory (no N×M queries)', async () => {
    const { runAlertTick } = await import('./alerts');
    const sqlSeen: string[] = [];
    const { pool, query: origQuery } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000, city: 'Houston',
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      // Two pro users, neither with areas; matches come from watchlists.
      [mkSql]: {
        rows: [
          { id: 'pro1', subscription_tier: 'pro', prefs: {}, email: 'p1@x.com' },
          { id: 'pro2', subscription_tier: 'pro', prefs: {}, email: 'p2@x.com' },
        ],
      },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
      'SELECT user_id, name, query_json FROM watchlists': {
        rows: [
          { user_id: 'pro1', name: 'Houston deals', query_json: { city: 'Houston' } },
          { user_id: 'pro2', name: 'Dallas deals', query_json: { city: 'Dallas' } },
        ],
      },
    });
    pool.connect = async () => ({ query: pool.query, release: () => {} });
    pool.query = (async (text: string, p?: any[]) => {
      sqlSeen.push(text);
      return origQuery(text, p);
    }) as any;
    const res = await runAlertTick(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    const insertCalls = sqlSeen.filter((s) => s.includes('INSERT INTO alert_events'));
    expect(insertCalls.length).toBe(1); // bulk = single round-trip, not per-row
    // Only ONE watchlists fetch, then pure in-memory eval (no per-candidate query).
    const watchlistFetches = sqlSeen.filter((s) => s.includes('FROM watchlists')).length;
    expect(watchlistFetches).toBe(1);
    // pro1's 'Houston deals' matches; pro2's 'Dallas deals' does not.
    expect(res.eventsInserted).toBe(1);
  });

  it('skips instant email when pro user has no email', async () => {
    const { runAlertTick } = await import('./alerts');
    const resendRecipients: string[] = [];
    globalThis.fetch = (async (_url: any, _init: any) => {
      resendRecipients.push('CALLED');
      return { ok: true, text: async () => 'ok' } as any;
    }) as any;
    const { pool } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000,
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      [mkSql]: {
        rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'] }, email: null }],
      },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
    });
    pool.connect = async () => ({ query: pool.query, release: () => {} });
    const res = await runAlertTick(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(res.instantSent).toBe(0);
    expect(resendRecipients).toHaveLength(0);
    globalThis.fetch = (async () => ({} as any)) as any;
  });

  it('degrades (not throws) when profiles.prefs column is absent (42703)', async () => {
    const { runAlertTick } = await import('./alerts');
    // First USERS_SQL select throws 42703; client must retry USERS_SQL_NO_PREFS.
    const err42703 = Object.assign(new Error('column "prefs" does not exist'), { code: '42703' });
    const queryWithMissingPrefs = async (text: string, _params?: any[]) => {
      if (text.includes(mkSql) && !text.includes(mkNoPrefsSql)) {
        throw err42703;
      }
      const key = Object.keys(rowsBySql).find((k) => text.includes(k));
      const hit = key ? rowsBySql[key] : { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    };
    const rowsBySql: Record<string, { rows: any[]; rowCount?: number }> = {
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000,
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      [mkNoPrefsSql]: {
        rows: [
          { id: 'pro1', subscription_tier: 'pro' },
          { id: 'free1', subscription_tier: 'free' },
        ],
      },
      [insSql]: { rows: [], rowCount: 0 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 0 },
    };
    const pool: any = { query: queryWithMissingPrefs, connect: async () => poolClient };
    const poolClient = { query: queryWithMissingPrefs, release: () => {} };

    // Should NOT throw — falls back to no-prefs users and still completes the tick.
    const res = await runAlertTick(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    expect(res.candidates).toBe(1);
    // prefs absent → no area matches → only watchlist rows (none here) → 0 events.
    expect(res.eventsInserted).toBe(0);
  });

  it('skips a non-numeric listing_id without crashing the bulk insert', async () => {
    const { runAlertTick } = await import('./alerts');
    const { pool, query: origQuery } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [
          // Bad id — must be skipped, not abort the whole batch.
          { id: 'not-a-num', address: 'Bad', zip_code: '77002', price: 120000, estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(500) },
          // Good id — must still insert.
          { id: 42, address: '9 Deal St', zip_code: '77002', price: 120000, estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000) },
        ],
      },
      [mkSql]: {
        rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'] }, email: 'p1@x.com' }],
      },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
    });
    pool.connect = async () => ({ query: pool.query, release: () => {} });
    pool.query = (async (text: string, p?: any[]) => origQuery(text, p)) as any;

    // Must NOT throw on the bad id.
    const res = await runAlertTick(pool, { info: () => {}, warn: () => {}, error: () => {} } as any);
    // Watermark advances past both candidates; good row still inserted.
    expect(res.candidates).toBe(2);
    expect(res.eventsInserted).toBeGreaterThanOrEqual(1);
  });

  it('caps the watchlists fetch (LIMIT $1) and warns when the cap is hit (#41)', async () => {
    const { runAlertTick } = await import('./alerts');
    const seen: Array<{ text: string; params?: any[] }> = [];
    const warns: any[] = [];
    const rowsBySql: Record<string, { rows: any[]; rowCount?: number }> = {
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000, city: 'Houston',
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      [mkSql]: { rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: {}, email: 'p1@x.com' }] },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
      // Exactly one watchlist row returned; with watchlistBatch=1 the fetch is
      // AT the cap, so the warn must fire.
      'SELECT user_id, name, query_json FROM watchlists': {
        rows: [{ user_id: 'pro1', name: 'Houston deals', query_json: { city: 'Houston' } }],
      },
    };
    const query = async (text: string, params?: any[]) => {
      seen.push({ text, params });
      const key = Object.keys(rowsBySql).find((k) => text.includes(k));
      const hit = key ? rowsBySql[key] : { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    };
    const pool: any = { query, connect: async () => ({ query, release: () => {} }) };
    const log = { info: () => {}, warn: (...a: any[]) => warns.push(a), error: () => {} };

    await runAlertTick(pool, log as any, { watchlistBatch: 1 });

    const wlCall = seen.find((c) => c.text.includes('FROM watchlists'));
    expect(wlCall).toBeDefined();
    // Bounded fetch: keyset-free single capped query.
    expect(wlCall!.text).toMatch(/LIMIT \$1/);
    expect(wlCall!.params).toEqual([1]);
    // Cap hit (1 fetched >= batch 1) → a warn mentioning the cap fired.
    expect(warns.some((w) => JSON.stringify(w).includes('cap'))).toBe(true);
  });
});

describe('runAlertTick observability (backlogFull + watermarkLagSeconds)', () => {
  function makePool(rowsBySql: Record<string, { rows: any[]; rowCount?: number }>) {
    const query = async (text: string, _params?: any[]) => {
      const key = Object.keys(rowsBySql).find((k) => text.includes(k));
      const hit = key ? rowsBySql[key] : { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    };
    return { pool: { query, connect: async () => ({ query, release: () => {} }) } };
  }

  const mkSql = 'SELECT id, subscription_tier, prefs, email';
  const candSql = 'last_seen_at >';
  const wmSql = 'SELECT last_seen_at FROM alert_state';
  const setWmSql = 'INSERT INTO alert_state';
  const insSql = 'INSERT INTO alert_events';
  const markSql = 'UPDATE alert_events';

  it('backlogFull is true when the tick hits the candidate cap (2000)', async () => {
    const { runAlertTick } = await import('./alerts');
    const CAP = 2000;
    const rows = Array.from({ length: CAP }, (_unused, i) => ({
      id: i, address: 'x', zip_code: '77002', price: 120000,
      estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000 + i),
    }));
    const { pool } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: { rows },
      [mkSql]: { rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'], alertOptIn: true }, email: 'p1@x.com' }] },
      [insSql]: { rows: [], rowCount: CAP },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: CAP },
    });
    const infos: any[] = [];
    const res = await runAlertTick(pool as any, { info: (...a: any[]) => infos.push(a), warn: () => {}, error: () => {} } as any);
    expect(res.backlogFull).toBe(true);
    expect(infos[0][0]).toMatchObject({ backlogFull: true });
  });

  it('backlogFull is false when fewer than the cap candidates are returned', async () => {
    const { runAlertTick } = await import('./alerts');
    const { pool } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(0) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000,
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(1000),
        }],
      },
      [mkSql]: { rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'], alertOptIn: true }, email: 'p1@x.com' }] },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
    });
    const infos: any[] = [];
    const res = await runAlertTick(pool as any, { info: (...a: any[]) => infos.push(a), warn: () => {}, error: () => {} } as any);
    expect(res.backlogFull).toBe(false);
    expect(infos[0][0]).toMatchObject({ backlogFull: false });
  });

  it('watermarkLagSeconds reflects now minus the processed watermark', async () => {
    const { runAlertTick } = await import('./alerts');
    const now = Date.now();
    const wmMs = now - 120_000; // 120s behind
    const { pool } = makePool({
      [wmSql]: { rows: [{ last_seen_at: new Date(wmMs) }] },
      [candSql]: {
        rows: [{
          id: 42, address: '9 Deal St', zip_code: '77002', price: 120000,
          estimated_rent: 1500, rent_price_ratio: 0.0125, last_seen_at: new Date(wmMs),
        }],
      },
      [mkSql]: { rows: [{ id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'] }, email: 'p1@x.com' }] },
      [insSql]: { rows: [], rowCount: 1 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 1 },
    });
    const infos: any[] = [];
    const res = await runAlertTick(pool as any, { info: (...a: any[]) => infos.push(a), warn: () => {}, error: () => {} } as any);
    expect(Math.abs(res.watermarkLagSeconds - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(infos[0][0].watermarkLagSeconds - 120)).toBeLessThanOrEqual(2);
  });

  it('watermarkLagSeconds is 0 when the watermark is absent (caught up)', async () => {
    const { runAlertTick } = await import('./alerts');
    const { pool } = makePool({
      [wmSql]: { rows: [] }, // no watermark row → absent → lag must be 0
      [candSql]: { rows: [] },
      [mkSql]: { rows: [] },
      [insSql]: { rows: [], rowCount: 0 },
      [setWmSql]: { rows: [] },
      [markSql]: { rows: [], rowCount: 0 },
    });
    const infos: any[] = [];
    const res = await runAlertTick(pool as any, { info: (...a: any[]) => infos.push(a), warn: () => {}, error: () => {} } as any);
    expect(res.watermarkLagSeconds).toBe(0);
    expect(infos[0][0]).toMatchObject({ watermarkLagSeconds: 0 });
  });
});

describe('evalWatchlistQuery (pure, mirrors compileWatchlistQuery)', () => {
  it('matches equality, IN, and range semantics', async () => {
    const { evalWatchlistQuery } = await import('./watchlist-alerts');
    const c = { price: 100000, city: 'Houston', bedrooms: 3 };
    expect(evalWatchlistQuery({ city: 'Houston' }, c)).toBe(true);
    expect(evalWatchlistQuery({ city: 'Dallas' }, c)).toBe(false);
    expect(evalWatchlistQuery({ city: ['Houston', 'Dallas'] }, c)).toBe(true);
    expect(evalWatchlistQuery({ city: ['Austin'] }, c)).toBe(false);
    expect(evalWatchlistQuery({ price: { min: 50000, max: 150000 } }, c)).toBe(true);
    expect(evalWatchlistQuery({ price: { min: 200000 } }, c)).toBe(false);
    expect(evalWatchlistQuery({ bedrooms: 3, price: { max: 150000 } }, c)).toBe(true);
    expect(evalWatchlistQuery({}, c)).toBe(true); // empty query = match all
  });

  it('treats missing candidate columns as non-matching', async () => {
    const { evalWatchlistQuery } = await import('./watchlist-alerts');
    // candidate lacks `state` → condition can never be satisfied.
    expect(evalWatchlistQuery({ state: 'TX' }, { city: 'Houston' })).toBe(false);
  });
});
