/**
 * Pro Deal Flow — tiered deal alert tick (Task 2).
 *
 * Diffs "new since last tick" 1%-clearing listings against every user's
 * watched areas (profiles.prefs->'areas', set by the Investor's Shelf plan)
 * and their watchlists (via the shared compile path in watchlist-alerts.ts),
 * writes `alert_events` rows (the in-app inbox + the (user,listing) dedup
 * ledger), then fans out instantly for pro / leaves rows for the daily digest
 * for free users.
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
import { matchWatchlists } from './watchlist-alerts.js';

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
 */
export const CANDIDATES_SQL = `
  SELECT id, address, zip_code, price, estimated_rent, rent_price_ratio
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
  SELECT id, address, zip_code, price, estimated_rent, rent_price_ratio
  FROM listings
  WHERE last_seen_at > $1
    AND rent_price_ratio >= 0.01
    AND rent_price_ratio <= 0.05
    AND price >= 30000
    AND listing_type = 'for_sale'
  ORDER BY last_seen_at ASC
  LIMIT 2000
`;

/** Fetch every user's id, tier, and areas (defensive — prefs may be absent). */
export const USERS_SQL = `
  SELECT id, subscription_tier, prefs
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
// Resend send (inlined — digest.ts is NOT imported, see header note)
// ---------------------------------------------------------------------------

function escHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

async function sendResendEmail(recipient: string, subject: string, html: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.WATCHLIST_FROM_EMAIL,
      to: recipient,
      subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
      html,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API error ${response.status}: ${text}`);
  }
}

function instantEmailHtml(row: AlertRow, candidate: Candidate): string {
  const address = escHtml(candidate.address ?? 'a property');
  const price = candidate.price != null
    ? `$${escHtml(Number(candidate.price).toLocaleString())}`
    : 'N/A';
  const ratio = candidate.rent_price_ratio != null
    ? `${escHtml((Number(candidate.rent_price_ratio) * 100).toFixed(2))}%`
    : 'N/A';
  return `
    <h2>New deal in your watched areas</h2>
    <p><strong>Address:</strong> ${address}</p>
    <p><strong>Price:</strong> ${price}</p>
    <p><strong>1% rule ratio:</strong> ${ratio}</p>
    <p><em>${escHtml(row.source_label)}</em></p>
  `;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export interface AlertTickConfig {
  /** Max rows to consider per tick (sanity cap). */
  limit?: number;
}

/**
 * Run one alert tick.
 *
 * 1. Read watermark from alert_state (id=1).
 * 2. Fetch candidates (1%-clearers since watermark), feature-detecting the
 *    listing_status column (42703 → fallback SQL).
 * 3. For each user with areas: build area AlertRows; for each user with
 *    watchlists: matchWatchlists → watchlist AlertRows.
 * 4. INSERT … ON CONFLICT DO NOTHING into alert_events.
 * 5. Fanout: pro users' fresh rows get instant email + delivered_at=now();
 *    free rows are left for the digest job.
 * 6. Advance watermark to the latest candidate last_seen_at.
 */
export async function runAlertTick(
  pool: Pool,
  log: Logger,
  _cfg?: AlertTickConfig,
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

    const usersRes = await client.query(USERS_SQL);
    const users = usersRes.rows;

    // Build all candidate AlertRows (area + watchlist) for dedup insert.
    const areaRows = matchAreas(
      candidates,
      users.map((u) => ({
        id: u.id,
        // prefs may be null/empty/missing 'areas' — treat as no areas.
        areas: (u.prefs && typeof u.prefs === 'object' ? (u.prefs as any).areas : undefined) ?? [],
      })),
    );

    const watchlistRows: AlertRow[] = [];
    for (const c of candidates) {
      for (const u of users) {
        const match = await matchWatchlists(pool, u.id, c as any);
        if (match) {
          watchlistRows.push({
            user_id: u.id,
            listing_id: c.id,
            source: 'watchlist',
            source_label: match.name,
            ratio: c.rent_price_ratio,
            price: c.price,
          });
        }
      }
    }

    const allRows = [...areaRows, ...watchlistRows];

    let eventsInserted = 0;
    for (const row of allRows) {
      const r = await client.query(INSERT_EVENT_SQL, [
        row.user_id,
        row.listing_id,
        row.source,
        row.source_label,
        row.ratio,
        row.price,
      ]);
      eventsInserted += r.rowCount ?? 0;
    }

    // Fanout — pro users instant; free users wait for digest.
    let instantSent = 0;
    const haveResend = !!env.RESEND_API_KEY && env.RESEND_API_KEY !== 'dummy_key_for_dev';
    for (const u of users) {
      if (u.subscription_tier !== 'pro') continue;
      const fresh = allRows.filter((r) => r.user_id === u.id);
      if (fresh.length === 0) continue;
      const ids = fresh.map((r) => r.listing_id);
      if (haveResend) {
        for (const row of fresh) {
          const c = candidates.find((x) => String(x.id) === String(row.listing_id));
          if (!c) continue;
          try {
            await sendResendEmail(
              u.id,
              `New deal in your areas: ${c.address ?? 'property'}`,
              instantEmailHtml(row, c),
            );
            instantSent++;
          } catch (err) {
            log.error({ err, userId: u.id }, 'Instant alert email failed');
          }
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
