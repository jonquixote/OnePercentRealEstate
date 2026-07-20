/**
 * Pro Deal Flow — tiered deal alert tick (Task 2).
 *
 * Diffs "new since last tick" 1%-clearing listings against every user's
 * watched areas (profiles.prefs->'areas', set by the Investor's Shelf plan)
 * and their watchlists (via the shared compile path in watchlist-alerts.ts),
 * writes `alert_events` rows (the in-app inbox + the (user,listing) dedup
 * ledger), then fans out instantly for pro. Free users get in-app
 * alert_events rows only (no email) — the digest worker does NOT consume
 * alert_events, so free users are inbox-only by design.
 *
 * IMPORTANT: this module must NOT import digest.ts (it pulls in
 * @oper/query-lang, which is TS-only and would break the plain-`node dist`
 * runtime used by oper-worker-alerts.service). The Resend send below is the
 * same fetch+key+from triple, inlined, and gated on RESEND_API_KEY exactly
 * like the digest worker.
 */

import { Pool, type PoolClient } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, type WorkerLogger } from './logger.js';
import { evalWatchlistQuery } from './watchlist-alerts.js';
import { sendAlertEmails } from './alert-email.js';

type Logger = WorkerLogger;

const env = loadEnv();
const logger = getLogger(env.LOG_LEVEL);

// ---------------------------------------------------------------------------
// SQL constants (exported for tests to assert shape)
// ---------------------------------------------------------------------------

/**
 * Candidates: 1%-clearers seen since the watermark.
 *
 * `last_seen_at > $1` (NOT created_at) — a price cut can turn an old listing
 * into a fresh deal and created_at would miss it. The bounds mirror the
 * spotlight sanity filter. `listing_status` may not exist yet (Listing Truth
 * plan adds it); `runAlertTick` feature-detects and re-issues without it, so
 * this constant is the optimistic form and the runtime keeps a fallback.
 *
 * INDEX (#43): the `last_seen_at > $1 … ORDER BY last_seen_at` scan is served
 * by the PARTIAL index `idx_listings_last_seen ON listings (last_seen_at)
 * WHERE listing_type='for_sale' AND listing_status IN ('active','pending_verify')`
 * from migration 2026_07_18_listing_lifecycle.sql. This query's predicates
 * (`listing_type='for_sale'` + `listing_status='active'`) are a strict SUBSET
 * of that index predicate, so the planner can use it — keep both predicates
 * here. (The NO_LIFECYCLE fallback below runs only pre-migration, when neither
 * the column nor the index exist, so its lack of an index match is moot.)
 */
export const CANDIDATES_SQL = `
  SELECT id, address, zip_code, price, estimated_rent, rent_price_ratio,
         bedrooms, bathrooms, sqft, year_built, state, city,
         sale_type, price_cut_pct, days_on_market, property_type
  FROM listings
  WHERE last_seen_at > $1
    AND rent_price_ratio >= 0.01
    AND rent_price_ratio <= 0.05
    AND price >= 30000
    AND listing_type = 'for_sale'
    AND listing_status = 'active'
  ORDER BY last_seen_at ASC
  LIMIT 2000
`;

/** Same as CANDIDATES_SQL but without the listing_status predicate (fallback). */
export const CANDIDATES_SQL_NO_LIFECYCLE = `
  SELECT id, address, zip_code, price, estimated_rent, rent_price_ratio,
         bedrooms, bathrooms, sqft, year_built, state, city,
         sale_type, price_cut_pct, days_on_market, property_type
  FROM listings
  WHERE last_seen_at > $1
    AND rent_price_ratio >= 0.01
    AND rent_price_ratio <= 0.05
    AND price >= 30000
    AND listing_type = 'for_sale'
  ORDER BY last_seen_at ASC
  LIMIT 2000
`;

/**
 * Fetch every user's id, tier, and areas. `profiles.prefs` is created by a
 * different branch (investors-shelf plan) that may not be applied when our
 * alert worker runs. `runAlertTick` feature-detects the column: if selecting
 * `prefs` throws 42703 (undefined_column), it falls back to USERS_SQL_NO_PREFS
 * and treats every user's areas as empty `[]`.
 */
export const USERS_SQL = `
  SELECT id, subscription_tier, prefs, email
  FROM profiles
  WHERE subscription_tier IS NOT NULL
`;

/** Same as USERS_SQL but without the prefs column (fallback when it's absent). */
export const USERS_SQL_NO_PREFS = `
  SELECT id, subscription_tier, email
  FROM profiles
  WHERE subscription_tier IS NOT NULL
`;

/** Read the alert tick watermark (single row id=1). */
export const GET_WATERMARK_SQL = `
  SELECT last_seen_at FROM alert_state WHERE id = 1
`;

/** Advance the watermark. */
export const SET_WATERMARK_SQL = `
  INSERT INTO alert_state (id, last_seen_at) VALUES (1, $1)
  ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
`;

/**
 * Insert a candidate match into the ledger. UNIQUE (user_id, listing_id) is
 * the dedup invariant — re-seen rows are absorbed by DO NOTHING, so over-
 * matching on the watermark is harmless.
 */
export const INSERT_EVENT_SQL = `
  INSERT INTO alert_events (user_id, listing_id, source, source_label, ratio, price)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (user_id, listing_id) DO NOTHING
`;

/**
 * Bulk-insert all candidate AlertRows in ONE round-trip. Same dedup
 * invariant as INSERT_EVENT_SQL (UNIQUE(user_id, listing_id) → DO NOTHING).
 * Six parallel arrays keep the per-row loop out of the tick hot path.
 */
export const INSERT_EVENTS_BULK_SQL = `
  INSERT INTO alert_events (user_id, listing_id, source, source_label, ratio, price)
  SELECT * FROM UNNEST(
    $1::text[], $2::bigint[], $3::text[], $4::text[], $5::numeric[], $6::numeric[]
  )
  ON CONFLICT (user_id, listing_id) DO NOTHING
`;

/** Stamp delivered_at on a batch of freshly-fanned-out rows for a user. */
export const MARK_DELIVERED_SQL = `
  UPDATE alert_events
  SET delivered_at = now()
  WHERE user_id = $1 AND listing_id = ANY($2::bigint[]) AND delivered_at IS NULL
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string | number;
  address: string | null;
  zip_code: string | null;
  price: number | null;
  estimated_rent: number | null;
  rent_price_ratio: number | null;
}

export interface AlertRow {
  user_id: string;
  listing_id: string | number;
  source: 'area' | 'watchlist';
  source_label: string;
  ratio: number | null;
  price: number | null;
}

// ---------------------------------------------------------------------------
// Pure matching
// ---------------------------------------------------------------------------

/**
 * Match candidates to user areas. Pure — no IO.
 *
 * User areas come from `profiles.prefs->'areas'` as an array of ZIP strings.
 * An area matches a candidate when `area === candidate.zip_code` (exact
 * 5-digit ZIP). Malformed/missing candidate zips and non-string areas are
 * dropped. Returns one AlertRow per (user, candidate, area) hit.
 */
export function matchAreas(
  candidates: Candidate[],
  users: Array<{ id: string; areas: unknown }>,
): AlertRow[] {
  const rows: AlertRow[] = [];
  for (const user of users) {
    const areas = Array.isArray(user.areas) ? user.areas : [];
    for (const area of areas) {
      if (typeof area !== 'string' || area.length === 0) continue;
      for (const c of candidates) {
        const zip = c.zip_code;
        if (typeof zip !== 'string' || zip.length === 0) continue;
        if (area !== zip) continue;
        rows.push({
          user_id: user.id,
          listing_id: c.id,
          source: 'area',
          source_label: area,
          ratio: c.rent_price_ratio,
          price: c.price,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Resend send now lives in ./alert-email.ts (renderAlertEmail + sendAlertEmails).
// digest.ts is NOT imported here (see header note) — alert-email.ts copies the
// inlined send + unsubscribe helpers instead.
// ---------------------------------------------------------------------------


// Tick
// ---------------------------------------------------------------------------

export interface AlertTickConfig {
  /** Max rows to consider per tick (sanity cap). */
  limit?: number;
  /**
   * Max watchlists to load per tick (#41). Keeps the fanout's in-memory
   * candidate×watchlist evaluation bounded. Defaults to
   * env.ALERT_WATCHLIST_BATCH (2000).
   */
  watchlistBatch?: number;
}

/**
 * Run one alert tick.
 *
 * 1. Read watermark from alert_state (id=1).
 * 2. Fetch candidates (1%-clearers since watermark), feature-detecting the
 *    listing_status column (42703 → fallback SQL).
 * 3. For each user with areas: build area AlertRows; for each user with
 *    watchlists: evalWatchlistQuery → watchlist AlertRows.
 * 4. INSERT … ON CONFLICT DO NOTHING into alert_events.
 * 5. Fanout: pro users' fresh rows get instant email + delivered_at=now().
 *    Free users get in-app alert_events rows only (no email). The digest
 *    worker does NOT consume alert_events, so free users are inbox-only by
 *    design.
 * 6. Advance watermark to the latest candidate last_seen_at.
 */
export async function runAlertTick(
  pool: Pool,
  log: Logger,
  cfg?: AlertTickConfig,
): Promise<{ candidates: number; eventsInserted: number; instantSent: number }> {
  const client: PoolClient = await pool.connect();
  try {
    const wmRes = await client.query(GET_WATERMARK_SQL);
    const watermark: Date = wmRes.rows[0]?.last_seen_at ?? new Date(0);

    let candidates: Candidate[] = [];
    try {
      const r = await client.query(CANDIDATES_SQL, [watermark]);
      candidates = r.rows;
    } catch (err: any) {
      if (err?.code === '42703') {
        // listing_status column missing — re-run without it.
        log.warn('listings.listing_status missing; using fallback candidates SQL');
        const r = await client.query(CANDIDATES_SQL_NO_LIFECYCLE, [watermark]);
        candidates = r.rows;
      } else {
        throw err;
      }
    }

    let users: Array<{ id: string; subscription_tier?: string; prefs?: unknown; email?: string | null }> = [];
    try {
      const usersRes = await client.query(USERS_SQL);
      users = usersRes.rows;
    } catch (err: any) {
      if (err?.code === '42703') {
        // profiles.prefs column missing — re-run without it; areas degrade to [].
        log.warn('profiles.prefs missing; fetching users without prefs (no area matches)');
        const usersRes = await client.query(USERS_SQL_NO_PREFS);
        users = usersRes.rows;
      } else {
        throw err;
      }
    }

    // Build all candidate AlertRows (area + watchlist) for dedup insert.
    const areaRows = matchAreas(
      candidates,
      users.map((u) => ({
        id: u.id,
        // prefs may be null/empty/missing 'areas' — treat as no areas.
        areas: (u.prefs && typeof u.prefs === 'object' ? (u.prefs as any).areas : undefined) ?? [],
      })),
    );

    // Watchlist match — fetch ALL watchlists once (not per user/candidate),
    // then evaluate each candidate in memory. The old code called
    // matchWatchlists(pool, user, candidate) for every (candidate × user)
    // pair, which issued ~candidates×users×watchlists DB queries per tick.
    const watchlistRows: AlertRow[] = [];
    let watchlists: Array<{ user_id: string; name: string; query_json: Record<string, any> }> = [];
    // Bounded fetch (#41): loading the whole watchlists table per tick grows
    // memory + CPU unbounded at scale. Cap at ALERT_WATCHLIST_BATCH (override
    // via cfg for tests). ORDER BY id makes the cap deterministic; a warn fires
    // when the cap is hit so we notice before watchlists silently stop being
    // evaluated and can shard/paginate this path.
    const watchlistBatch = cfg?.watchlistBatch ?? env.ALERT_WATCHLIST_BATCH;
    try {
      const wlRes = await client.query(
        `SELECT user_id, name, query_json FROM watchlists ORDER BY id LIMIT $1`,
        [watchlistBatch],
      );
      watchlists = wlRes.rows;
      if (watchlists.length >= watchlistBatch) {
        log.warn(
          { cap: watchlistBatch, fetched: watchlists.length },
          'watchlists fetch hit ALERT_WATCHLIST_BATCH cap — some watchlists were not evaluated this tick',
        );
      }
    } catch (err: any) {
      // watchlists table may not exist yet (Investor's Shelf plan owns it).
      // Degrade to no watchlist matches rather than failing the whole tick.
      if (err?.code === '42P01') {
        log.warn('watchlists table missing; skipping watchlist matches');
      } else {
        throw err;
      }
    }
    if (watchlists.length > 0) {
      for (const c of candidates) {
        for (const wl of watchlists) {
          try {
            if (evalWatchlistQuery(wl.query_json ?? {}, c as any)) {
              watchlistRows.push({
                user_id: wl.user_id,
                listing_id: c.id,
                source: 'watchlist',
                source_label: wl.name,
                ratio: c.rent_price_ratio,
                price: c.price,
              });
            }
          } catch (err) {
            // Misconfigured watchlist (invalid column) — skip, don't fail tick.
            log.warn({ err, userId: wl.user_id, name: wl.name }, 'Skipping uncompilable watchlist');
          }
        }
      }
    }

    const allRows = [...areaRows, ...watchlistRows];

    let eventsInserted = 0;
    if (allRows.length > 0) {
      const userIds: string[] = [];
      const listingIds: bigint[] = [];
      const sources: string[] = [];
      const labels: string[] = [];
      const ratios: (number | null)[] = [];
      const prices: (number | null)[] = [];
      for (const row of allRows) {
        let lid: bigint;
        try {
          lid = typeof row.listing_id === 'bigint' ? row.listing_id : BigInt(row.listing_id);
        } catch {
          // Non-numeric listing_id would crash the whole batch; skip that row.
          log.warn({ userId: row.user_id, listingId: row.listing_id }, 'Skipping alert row with non-numeric listing_id');
          continue;
        }
        userIds.push(row.user_id);
        listingIds.push(lid);
        sources.push(row.source);
        labels.push(row.source_label);
        ratios.push(row.ratio);
        prices.push(row.price);
      }
      const r = await client.query(INSERT_EVENTS_BULK_SQL, [
        userIds, listingIds, sources, labels, ratios, prices,
      ]);
      eventsInserted = r.rowCount ?? 0;
    }

    // Fanout — pro users instant email; free users stay inbox-only (no email by design).
    let instantSent = 0;
    const haveResend = !!env.RESEND_API_KEY && env.RESEND_API_KEY !== 'dummy_key_for_dev';
    for (const u of users) {
      if (u.subscription_tier !== 'pro') continue;
      const fresh = allRows.filter((r) => r.user_id === u.id);
      if (fresh.length === 0) continue;
      const ids = fresh.map((r) => r.listing_id);
      // Only email pro users who have opted in via prefs.alertOptIn. The
      // in-app alert_events row is still stamped delivered below regardless,
      // so an email failure can never lose the inbox event (try/catch).
      const alertOptIn = (u.prefs && typeof u.prefs === 'object' && (u.prefs as any).alertOptIn === true);
      if (haveResend && alertOptIn && u.email) {
        try {
          instantSent += await sendAlertEmails(u, fresh, candidates, log);
        } catch (err) {
          log.warn({ err, userId: u.id }, 'Alert email fanout failed');
        }
      }
      await client.query(MARK_DELIVERED_SQL, [u.id, ids]);
    }

    // Advance watermark.
    const maxSeen = candidates.reduce<number>((max, c) => {
      const t = (c as any).last_seen_at ? new Date((c as any).last_seen_at).getTime() : 0;
      return t > max ? t : max;
    }, watermark.getTime());
    await client.query(SET_WATERMARK_SQL, [new Date(maxSeen)]);

    log.info(
      { candidates: candidates.length, eventsInserted, instantSent },
      'Alert tick complete',
    );
    return { candidates: candidates.length, eventsInserted, instantSent };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Standalone entry: not executed when imported by tests.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('alerts.ts')) {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected pool error');
    process.exit(1);
  });
  runAlertTick(pool, logger)
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'Alert tick failed');
      process.exit(1);
    });
}
