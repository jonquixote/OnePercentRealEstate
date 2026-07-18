import { describe, it, expect, beforeAll } from 'vitest';

// alerts.ts calls loadEnv() at import time (and transitively watchlist-alerts.ts
// does too), so DATABASE_URL must be present before the modules are imported.
beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';
  process.env.RESEND_API_KEY = 'dummy_key_for_dev'; // gate instant email off
});

describe('alerts SQL shape', () => {
  it('CANDIDATES_SQL is parameterized by a watermark and bounds 1%-clearers', async () => {
    const { CANDIDATES_SQL } = await import('./alerts');
    expect(CANDIDATES_SQL).toContain('last_seen_at > $1');
    expect(CANDIDATES_SQL).toContain('rent_price_ratio >= 0.01');
    expect(CANDIDATES_SQL).toContain('rent_price_ratio <= 0.05');
    expect(CANDIDATES_SQL).toContain('price >= 30000');
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

    const mkSql = 'SELECT id, subscription_tier, prefs';
    const mkNoPrefsSql = 'SELECT id, subscription_tier';
    const candSql = 'last_seen_at >';
  const wmSql = 'SELECT last_seen_at FROM alert_state';
  const setWmSql = 'INSERT INTO alert_state';
  const insSql = 'INSERT INTO alert_events';
  const markSql = 'UPDATE alert_events';

  it('instant-fans out pro users and leaves free users untouched', async () => {
    const { runAlertTick } = await import('./alerts');
    const calls: string[] = [];
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
          { id: 'pro1', subscription_tier: 'pro', prefs: { areas: ['77002'] } },
          { id: 'free1', subscription_tier: 'free', prefs: { areas: ['77002'] } },
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
    expect(res.eventsInserted).toBeGreaterThanOrEqual(2); // pro1 + free1 both inserted
    // Pro user marked delivered; free user NOT in any mark query.
    const markCalls = calls.filter((c) => c.includes(markSql));
    expect(markCalls.length).toBe(1);
    // Free user must never be stamped delivered.
    expect(markCalls.join(' ')).not.toContain('free1');
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
});
