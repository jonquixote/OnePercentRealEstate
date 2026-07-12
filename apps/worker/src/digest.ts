/**
 * Tasks 2.1 & 2.2 — Saved-search daily digest + weekly ZIP market brief.
 *
 * Reuses the watchlist-alerts.ts conventions exactly:
 *  - HTML-escaping of all listing/user data via `escHtml`
 *  - Resend send via the same `fetch` + `env.RESEND_API_KEY` + `env.WATCHLIST_FROM_EMAIL`
 *  - `pg` Pool connection
 *  - a signed one-click unsubscribe link in every email
 *
 * Schedule: a single process ticks hourly and, at 14:00 UTC, runs the daily
 * digest (Task 2.1) and — on Monday — the weekly brief (Task 2.2). A small
 * `digest_runs` table dedupes by UTC date so a restart can't double-send.
 *
 * Per-user daily cap is structural: at most one email per user per day, with
 * all of that user's enabled searches batched into it (hard cap 6 listings).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { parse, compile } from '@oper/query-lang';
import { loadEnv } from './env.js';
import { getLogger, type WorkerLogger } from './logger.js';

type Logger = WorkerLogger;

const env = loadEnv();
const logger = getLogger(env.LOG_LEVEL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 2,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pool error');
  process.exit(1);
});

/** Run window (UTC hour) for both jobs. */
const DIGEST_HOUR_UTC = 14;
/** Hard cap on listings shown in a single daily digest email. */
const DAILY_LISTING_CAP = 6;

/**
 * HTML-escape an interpolation. Listing/user data is untrusted (MLS scrapes,
 * free-form search names) — escape before embedding in email HTML.
 */
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

// ---------------------------------------------------------------------------
// Signed one-click unsubscribe token
// ---------------------------------------------------------------------------
// Token = HMAC-SHA256 over `${searchId}|${email}`. The route recomputes it
// and compares with a constant-time check, so no login is needed to opt out.
function signUnsub(searchId: string, email: string): string {
  const payload = `${searchId}|${email}`;
  return createHmac('sha256', env.UNSUBSCRIBE_SECRET).update(payload).digest('hex');
}

function unsubUrl(searchId: string, email: string): string {
  const token = signUnsub(searchId, email);
  const base = env.DIGEST_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}&id=${encodeURIComponent(searchId)}&e=${encodeURIComponent(email)}`;
}

// ---------------------------------------------------------------------------
// Saved-search params -> SQL
// ---------------------------------------------------------------------------
// Stored shape is `toFilterState()` output: minPrice, maxPrice, minBeds,
// minBaths, propertyType, saleType, query (the `q` nuqs param, which may be a
// 5-digit ZIP). We also accept the legacy pmin/pmax/beds keys for forwards
// compat. ZIP is only derivable when `query` is exactly 5 digits.
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function compileSavedSearchParams(params: Record<string, any>): { sql: string; bind: any[] } {
  const conds: string[] = [];
  const bind: any[] = [];
  const add = (cond: string, val: any) => {
    bind.push(val);
    conds.push(cond.replace('?', `$${bind.length}`));
  };

  const minPrice = firstNum(params.minPrice, params.pmin);
  const maxPrice = firstNum(params.maxPrice, params.pmax);
  const minBeds = firstNum(params.minBeds, params.beds);
  const minBaths = firstNum(params.minBaths, params.baths);

  if (minPrice != null && minPrice > 0) add('price >= ?', minPrice);
  if (maxPrice != null && maxPrice < 2000000) add('price <= ?', maxPrice);
  if (minBeds != null && minBeds > 0) add('bedrooms >= ?', minBeds);
  if (minBaths != null && minBaths > 0) add('bathrooms >= ?', minBaths);
  if (typeof params.propertyType === 'string' && params.propertyType) {
    add('property_type = ?', params.propertyType);
  }
  if (typeof params.saleType === 'string' && params.saleType) {
    add('sale_type = ?', params.saleType);
  }

  const q = typeof params.query === 'string' ? params.query.trim() : '';
  if (/^\d{5}$/.test(q)) add('zip_code = ?', q);

  const sql = conds.length > 0 ? conds.join(' AND ') : '1=1';
  return { sql, bind };
}

// ---------------------------------------------------------------------------
// Resend send (mirrors watchlist-alerts.ts)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// TASK 2.1 — daily digest
// ---------------------------------------------------------------------------
interface DigestListing {
  id: number;
  address: string | null;
  price: number | null;
  estimated_rent: number | null;
  ratio: number | null;
  primary_photo: string | null;
}

function listingRowHtml(listing: DigestListing, base: string): string {
  const link = `${base}/property/${listing.id}`;
  const price = listing.price != null
    ? `$${escHtml(Number(listing.price).toLocaleString())}`
    : 'N/A';
  const rent = listing.estimated_rent != null
    ? `$${escHtml(Number(listing.estimated_rent).toLocaleString())}`
    : 'N/A';
  const ratio = listing.ratio != null
    ? `${escHtml((Number(listing.ratio) * 100).toFixed(1))}%`
    : 'N/A';
  const photo = listing.primary_photo
    ? `<a href="${escHtml(link)}"><img src="${escHtml(listing.primary_photo)}" alt="${escHtml(listing.address ?? 'listing')}" width="200" style="border-radius:8px" /></a>`
    : '';
  return `
    <tr>
      <td style="padding:8px">${photo}</td>
      <td style="padding:8px">
        <a href="${escHtml(link)}" style="color:#1d4ed8;text-decoration:none;font-weight:600">
          ${escHtml(listing.address ?? `Listing #${listing.id}`)}
        </a><br/>
        <span style="color:#374151">Price: ${price}</span><br/>
        <span style="color:#374151">Est. rent: ${rent}</span><br/>
        <span style="color:#374151">1% rule: ${ratio}</span>
      </td>
    </tr>`;
}

// ---------------------------------------------------------------------------
// Screen-alert compilation (Task AL1) — query-lang on a saved terminal screen
// ---------------------------------------------------------------------------
// Screen alerts reuse the EXACT same compile path as /api/properties/query:
// parse the expression string, then compile to a parameterized WHERE with a
// strict column whitelist and $N placeholders. No client SQL is interpolated.
async function compileScreenExpression(expression: string): Promise<{
  whereSql: string;
  params: any[];
  usedColumns: string[];
}> {
  const ast = parse(expression);
  const compiled = compile(ast);
  return {
    whereSql: compiled.whereSql,
    params: compiled.params,
    usedColumns: compiled.usedColumns,
  };
}

// Run a single screen alert's compiled expression, bounded to listings newer
// than `lastRunAt` and capped at LIMIT 20. Mirrors the /api/properties/query
// SELECT structure exactly — same columns, same sale_type-default logic, same
// statement_timeout guard — so digest results match the interactive grid.
async function runScreenAlertQuery(
  client: any,
  compiled: { whereSql: string; params: any[]; usedColumns: string[] },
  lastRunAt: Date,
): Promise<DigestListing[]> {
  const saleTypeDefault = compiled.usedColumns.includes('sale_type')
    ? ''
    : `sale_type = 'standard' AND`;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 5000');
    const result = await client.query(
      `
        SELECT id, address, price, estimated_rent,
               CASE WHEN price > 0 AND estimated_rent > 0
                    THEN estimated_rent / price ELSE NULL END AS ratio,
               primary_photo
        FROM listings
        WHERE listing_type = 'for_sale'
          AND ${saleTypeDefault} (${compiled.whereSql})
          AND created_at > $1
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [lastRunAt, ...compiled.params]
    );
    await client.query('COMMIT');
    return result.rows as DigestListing[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function runDailyDigest(): Promise<void> {
  const client = await pool.connect();
  try {
    // Users with at least one enabled search OR one enabled screen alert,
    // a reachable email, and who have not globally opted out. Both sources
    // feed the SAME one-email-per-user-per-day send below.
    const usersRes = await client.query(
      `
        SELECT DISTINCT s.user_id, u.email
        FROM saved_searches s
        JOIN user_alert_prefs u ON u.user_id = s.user_id
        WHERE s.email_digest = true
          AND u.email IS NOT NULL
          AND NOT u.email_optout
        UNION
        SELECT DISTINCT sa.user_id, u.email
        FROM screen_alerts sa
        JOIN user_alert_prefs u ON u.user_id = sa.user_id
        WHERE sa.enabled = true
          AND u.email IS NOT NULL
          AND NOT u.email_optout
      `
    );

    for (const { user_id, email } of usersRes.rows) {
      try {
        await sendDailyDigestForUser(client, user_id, email);
      } catch (err) {
        logger.error({ err, userId: user_id }, 'Daily digest send failed for user');
      }
    }

    logger.info({ users: usersRes.rows.length }, 'Daily digest pass complete');
  } finally {
    client.release();
  }
}

async function sendDailyDigestForUser(
  client: any,
  userId: string,
  email: string,
): Promise<void> {
  const searchesRes = await client.query(
    `
      SELECT id, name, params, created_at,
             COALESCE(last_digest_at, created_at) AS cutoff
      FROM saved_searches
      WHERE user_id = $1 AND email_digest = true
      ORDER BY created_at ASC
    `,
    [userId]
  );

  const listings: DigestListing[] = [];
  const searchIds: bigint[] = [];
  // Reference id used to build the one-click unsubscribe link. Prefer the
  // first saved search; fall back to the first screen alert when the user
  // only has screen alerts (so the link still resolves in the unsub route).
  let unsubRefId: string | null = null;
  // Footer notes (e.g. a disabled malformed screen) appended to the email.
  const footerNotes: string[] = [];

  for (const search of searchesRes.rows) {
    if (listings.length >= DAILY_LISTING_CAP) break;
    const { sql, bind } = compileSavedSearchParams(search.params ?? {});
    const remaining = DAILY_LISTING_CAP - listings.length;

    const res = await client.query(
      `
        SELECT id, address, price, estimated_rent,
               CASE WHEN price > 0 AND estimated_rent > 0
                    THEN estimated_rent / price ELSE NULL END AS ratio,
               primary_photo
        FROM listings
        WHERE listing_type = 'for_sale'
          AND created_at > $1
          AND ${sql}
        ORDER BY created_at DESC
        LIMIT ${remaining}
      `,
      [search.cutoff, ...bind]
    );

    for (const row of res.rows) listings.push(row);
    searchIds.push(search.id);
    if (unsubRefId == null) unsubRefId = String(search.id);
  }

  // Always stamp last_digest_at so we make forward progress even with 0 matches.
  if (searchIds.length > 0) {
    await client.query(
      `UPDATE saved_searches SET last_digest_at = now() WHERE id = ANY($1)`,
      [searchIds]
    );
  }

  // --- Task AL1: screen alerts, merged into the SAME one-email/day send ----
  // The same DAILY_LISTING_CAP (6) is shared — screen matches fill whatever
  // room the saved searches left. last_run_at advances regardless of matches
  // so a quiet screen doesn't re-scan its whole history the next day.
  const alertRes = await client.query(
    `
      SELECT sa.screen_id,
             COALESCE(sa.last_run_at, now() - interval '1 day') AS cutoff,
             ts.expression, ts.name
      FROM screen_alerts sa
      JOIN terminal_screens ts ON ts.id = sa.screen_id
      WHERE sa.user_id = $1 AND sa.enabled = true
      ORDER BY sa.created_at ASC
    `,
    [userId]
  );

  const touchedAlerts: bigint[] = [];
  for (const alert of alertRes.rows) {
    if (listings.length >= DAILY_LISTING_CAP) break;
    touchedAlerts.push(alert.screen_id);

    // An empty expression matches nothing meaningful — skip it (still push
    // to touchedAlerts below so its cursor advances) rather than compiling.
    if (!alert.expression || !alert.expression.trim()) {
      continue;
    }

    let compiled;
    try {
      compiled = await compileScreenExpression(alert.expression);
    } catch (err) {
      // Malformed/expensive expression: disable the alert so we don't keep
      // retrying it, and note it in the email footer.
      logger.warn({ err, userId, screenId: alert.screen_id }, 'Screen alert expression failed to compile');
      await client.query(
        `UPDATE screen_alerts SET enabled = false, updated_at = now() WHERE screen_id = $1 AND user_id = $2`,
        [alert.screen_id, userId]
      );
      footerNotes.push(
        `Your screen "${String(alert.name ?? 'unknown')}" was turned off — its filter expression is invalid.`
      );
      continue;
    }

    try {
      const matches = await runScreenAlertQuery(client, compiled, alert.cutoff);
      for (const row of matches) {
        if (listings.length >= DAILY_LISTING_CAP) break;
        listings.push(row);
      }
      if (unsubRefId == null) unsubRefId = String(alert.screen_id);
    } catch (err) {
      logger.error({ err, userId, screenId: alert.screen_id }, 'Screen alert query failed');
    }
  }

  // Advance every touched alert's cursor (compiled or not) so we make progress.
  if (touchedAlerts.length > 0) {
    await client.query(
      `UPDATE screen_alerts SET last_run_at = now(), updated_at = now()
       WHERE screen_id = ANY($1::bigint[]) AND user_id = $2`,
      [touchedAlerts, userId]
    );
  }

  if (listings.length === 0) return;

  const base = env.DIGEST_PUBLIC_URL.replace(/\/$/, '');
  const rowsHtml = listings.map((l) => listingRowHtml(l, base)).join('');
  const unsub = unsubRefId != null
    ? unsubUrl(unsubRefId, email)
    : `${base}/api/unsubscribe`;

  const footerHtml = footerNotes.length > 0
    ? `<p style="color:#b45309;font-size:12px">${footerNotes.map((n) => escHtml(n)).join('<br/>')}</p>`
    : '';

  const html = `
    <h2>Your daily new matches</h2>
    <p style="color:#374151">${listings.length} new listing${listings.length === 1 ? '' : 's'} matching your saved searches and screens since your last digest.</p>
    <table style="border-collapse:collapse;width:100%">${rowsHtml}</table>
    <hr style="margin-top:16px" />
    ${footerHtml}
    <p style="color:#6b7280;font-size:12px">
      <a href="${escHtml(unsub)}" style="color:#6b7280">Unsubscribe from these digests</a>
    </p>`;

  await sendResendEmail(email, 'Your daily new matches', html);
  logger.info({ userId, listings: listings.length }, 'Sent daily digest');
}

// ---------------------------------------------------------------------------
// TASK 2.2 — weekly ZIP market brief
// ---------------------------------------------------------------------------
interface ZipStats {
  zip: string;
  medianPriceNow: number | null;
  medianPricePrev: number | null;
  newCount: number;
  soldCount: number;
  rentPsfNow: number | null;
  rentPsfPrev: number | null;
  hpiYoy: number | null;
}

async function fetchZipStats(client: any, zip: string): Promise<ZipStats> {
  // Median active list price now vs the prior-week cohort (listings created
  // 7-14 days ago). `percentile_cont` needs an aggregate wrapper, so we use
  // the percentile_cont-based median over each window.
  const priceRes = await client.query(
    `
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (
          WHERE listing_type = 'for_sale' AND created_at > now() - interval '7 days'
        ) AS median_now,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (
          WHERE listing_type = 'for_sale'
            AND created_at > now() - interval '14 days'
            AND created_at <= now() - interval '7 days'
        ) AS median_prev
      FROM listings
      WHERE zip_code = $1
    `,
    [zip]
  );

  const countsRes = await client.query(
    `
      SELECT
        (SELECT count(*)::int FROM listings
           WHERE zip_code = $1 AND listing_type = 'for_sale'
             AND created_at > now() - interval '7 days') AS new_count,
        (SELECT count(*)::int FROM sold_listings
           WHERE zip_code = $1 AND sold_date > now() - interval '7 days') AS sold_count
    `,
    [zip]
  );

  // Rent $/sqft trend from listings (estimated_rent / sqft). h3_market_stats
  // is keyed by H3 hex with no H3 index available in Postgres, so it can't be
  // joined to a ZIP here — see report note. We fall back to the listings
  // surface, which is ZIP-keyed and real.
  const rentRes = await client.query(
    `
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent / NULLIF(sqft, 0)) FILTER (
          WHERE listing_type = 'for_sale' AND created_at > now() - interval '7 days'
            AND sqft > 0 AND estimated_rent > 0
        ) AS rent_now,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent / NULLIF(sqft, 0)) FILTER (
          WHERE listing_type = 'for_sale'
            AND created_at > now() - interval '14 days'
            AND created_at <= now() - interval '7 days'
            AND sqft > 0 AND estimated_rent > 0
        ) AS rent_prev
      FROM listings
      WHERE zip_code = $1
    `,
    [zip]
  );

  const hpiRes = await client.query(
    `
      SELECT annual_change_pct FROM fhfa_zip_hpi
      WHERE zip5 = $1
      ORDER BY year DESC
      LIMIT 1
    `,
    [zip]
  );

  const p = priceRes.rows[0] ?? {};
  const c = countsRes.rows[0] ?? { new_count: 0, sold_count: 0 };
  const r = rentRes.rows[0] ?? {};
  const h = hpiRes.rows[0] ?? {};

  return {
    zip,
    medianPriceNow: p.median_now ?? null,
    medianPricePrev: p.median_prev ?? null,
    newCount: c.new_count ?? 0,
    soldCount: c.sold_count ?? 0,
    rentPsfNow: r.rent_now ?? null,
    rentPsfPrev: r.rent_prev ?? null,
    hpiYoy: h.annual_change_pct ?? null,
  };
}

function pctChange(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

function zipRowHtml(stats: ZipStats, base: string): string {
  const link = `${base}/market/${stats.zip}`;
  const medNow = stats.medianPriceNow != null
    ? `$${escHtml(Number(stats.medianPriceNow).toLocaleString())}` : 'N/A';
  const medWoW = pctChange(stats.medianPriceNow, stats.medianPricePrev);
  const medTrend = medWoW != null
    ? `${medWoW >= 0 ? '▲' : '▼'} ${escHtml(Math.abs(medWoW).toFixed(1))}% WoW` : '—';
  const rentWoW = pctChange(stats.rentPsfNow, stats.rentPsfPrev);
  const rentTrend = rentWoW != null
    ? `${rentWoW >= 0 ? '▲' : '▼'} ${escHtml(Math.abs(rentWoW).toFixed(1))}% WoW` : '—';
  const rent = stats.rentPsfNow != null
    ? `$${escHtml(Number(stats.rentPsfNow).toFixed(2))}/sqft` : 'N/A';
  const hpi = stats.hpiYoy != null
    ? `${escHtml(Number(stats.hpiYoy).toFixed(1))}% YoY` : 'N/A';

  return `
    <tr>
      <td style="padding:8px">
        <a href="${escHtml(link)}" style="color:#1d4ed8;text-decoration:none;font-weight:600">${escHtml(stats.zip)}</a><br/>
        <span style="color:#374151">Median list: ${medNow} (${medTrend})</span><br/>
        <span style="color:#374151">New ${escHtml(String(stats.newCount))} / Sold ${escHtml(String(stats.soldCount))} (7d)</span><br/>
        <span style="color:#374151">Rent: ${rent} (${rentTrend})</span><br/>
        <span style="color:#374151">FHFA HPI: ${hpi}</span>
      </td>
    </tr>`;
}

async function runWeeklyBrief(): Promise<void> {
  const client = await pool.connect();
  try {
    // Users with enabled searches that carry a ZIP, reachable email, not opted out.
    const usersRes = await client.query(
      `
        SELECT DISTINCT s.user_id, u.email
        FROM saved_searches s
        JOIN user_alert_prefs u ON u.user_id = s.user_id
        WHERE s.email_digest = true
          AND u.email IS NOT NULL
          AND NOT u.email_optout
          AND s.params->>'query' ~ '^\\d{5}$'
      `
    );

    for (const { user_id, email } of usersRes.rows) {
      try {
        await sendWeeklyBriefForUser(client, user_id, email);
      } catch (err) {
        logger.error({ err, userId: user_id }, 'Weekly brief send failed for user');
      }
    }

    logger.info({ users: usersRes.rows.length }, 'Weekly brief pass complete');
  } finally {
    client.release();
  }
}

async function sendWeeklyBriefForUser(
  client: any,
  userId: string,
  email: string,
): Promise<void> {
  const searchesRes = await client.query(
    `
      SELECT DISTINCT params->>'query' AS zip
      FROM saved_searches
      WHERE user_id = $1 AND email_digest = true
        AND params->>'query' ~ '^\\d{5}$'
    `,
    [userId]
  );

  if (searchesRes.rows.length === 0) return;

  const stats: ZipStats[] = [];
  for (const { zip } of searchesRes.rows) {
    try {
      stats.push(await fetchZipStats(client, zip));
    } catch (err) {
      logger.error({ err, zip }, 'Failed to compute ZIP stats');
    }
  }
  if (stats.length === 0) return;

  const base = env.DIGEST_PUBLIC_URL.replace(/\/$/, '');
  const rowsHtml = stats.map((s) => zipRowHtml(s, base)).join('');
  // Unsubscribe from the first enabled ZIP search for this user.
  const firstSearch = await client.query(
    `SELECT id FROM saved_searches WHERE user_id = $1 AND email_digest = true LIMIT 1`,
    [userId]
  );
  const unsub = firstSearch.rows[0]
    ? unsubUrl(String(firstSearch.rows[0].id), email)
    : `${base}/api/unsubscribe`;

  const html = `
    <h2>Your weekly market brief</h2>
    <p style="color:#374151">ZIP-level market signals for the searches you watch.</p>
    <table style="border-collapse:collapse;width:100%">${rowsHtml}</table>
    <hr style="margin-top:16px" />
    <p style="color:#6b7280;font-size:12px">
      <a href="${escHtml(unsub)}" style="color:#6b7280">Unsubscribe from these emails</a>
    </p>`;

  // Stamp last_digest_at so the weekly run also advances the daily cursor for
  // these searches (one email/user/week — same cap discipline as the digest).
  await client.query(
    `UPDATE saved_searches SET last_digest_at = now()
     WHERE user_id = $1 AND email_digest = true`,
    [userId]
  );

  await sendResendEmail(email, 'Your weekly market brief', html);
  logger.info({ userId, zips: stats.length }, 'Sent weekly brief');
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
async function getRunDate(kind: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT last_run FROM digest_runs WHERE kind = $1`, [kind]);
    if (res.rows.length === 0) return null;
    return new Date(res.rows[0].last_run).toISOString().slice(0, 10);
  } finally {
    client.release();
  }
}

async function setRun(kind: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO digest_runs (kind, last_run) VALUES ($1, now())
       ON CONFLICT (kind) DO UPDATE SET last_run = now()`,
      [kind]
    );
  } finally {
    client.release();
  }
}

/** Hourly tick: fire daily at 14:00 UTC, weekly (Mon) at 14:00 UTC. */
async function maybeRun(): Promise<void> {
  const now = new Date();
  if (now.getUTCHours() !== DIGEST_HOUR_UTC) return;

  const today = now.toISOString().slice(0, 10);
  const dailyDone = await getRunDate('daily');
  if (dailyDone !== today) {
    try {
      await runDailyDigest();
      await setRun('daily');
    } catch (err) {
      logger.error({ err }, 'Daily digest job error');
    }
  }

  if (now.getUTCDay() === 1) {
    const weeklyDone = await getRunDate('weekly');
    if (weeklyDone !== today) {
      try {
        await runWeeklyBrief();
        await setRun('weekly');
      } catch (err) {
        logger.error({ err }, 'Weekly brief job error');
      }
    }
  }
}

async function main() {
  logger.info({ hour: DIGEST_HOUR_UTC }, 'Digest worker starting');
  // Catch up immediately if we're already in the target hour (e.g. restart).
  await maybeRun();
  setInterval(maybeRun, 60 * 60 * 1000);

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing pool');
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Startup error');
  process.exit(1);
});
