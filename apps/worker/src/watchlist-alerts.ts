/**
 * Wave 6: Watchlist alerts worker
 *
 * Every 15 minutes (configurable):
 * 1. For each watchlist that needs evaluation:
 *    - Compile query_json to SQL using strict column whitelist
 *    - Query for new matching listings
 *    - Create alert rows
 * 2. For each unsent alert:
 *    - Look up user's alert preferences
 *    - Send via email (Resend) or webhook
 *    - Mark sent_at
 *
 * Strict column whitelist: price, bedrooms, bathrooms, sqft, estimated_rent,
 * year_built, state, city, zip_code
 */

import { Pool } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, type WorkerLogger } from './logger.js';

type Logger = WorkerLogger;

const env = loadEnv();
const logger = getLogger(env.LOG_LEVEL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 2,
});

pool.on('error', err => {
  logger.error({ err }, 'Unexpected pool error');
  process.exit(1);
});

/**
 * Validate a column name against the watchlist whitelist.
 * Matches the query-lang package's ALLOWED_COLUMNS.
 */
function validateWatchlistColumn(col: string): boolean {
  const allowed = new Set([
    'price',
    'bedrooms',
    'bathrooms',
    'sqft',
    'estimated_rent',
    'year_built',
    'state',
    'city',
    'zip_code',
  ]);
  return allowed.has(col);
}

/**
 * Compile a watchlist's query_json to parameterized SQL.
 * Returns { sql, params } or throws if invalid.
 */
function compileWatchlistQuery(queryJson: Record<string, any>): {
  sql: string;
  params: any[];
} {
  const conditions: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(queryJson)) {
    if (!validateWatchlistColumn(key)) {
      throw new Error(`Invalid column in watchlist query: ${key}`);
    }

    if (Array.isArray(value)) {
      // IN clause
      if (value.length === 0) continue;
      const placeholders = value.map((_, i) => `$${params.length + i + 1}`).join(', ');
      conditions.push(`"${key}" IN (${placeholders})`);
      params.push(...value);
    } else if (typeof value === 'object' && value !== null) {
      // Range query: { min: X, max: Y }
      if ('min' !== undefined && value.min !== undefined) {
        conditions.push(`"${key}" >= $${params.length + 1}`);
        params.push(value.min);
      }
      if ('max' !== undefined && value.max !== undefined) {
        conditions.push(`"${key}" <= $${params.length + 1}`);
        params.push(value.max);
      }
    } else {
      // Simple equality
      conditions.push(`"${key}" = $${params.length + 1}`);
      params.push(value);
    }
  }

  const sql = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
  return { sql, params };
}

/**
 * Evaluate a single watchlist: find new matches, create alerts.
 */
async function evaluateWatchlist(client: any, watchlistId: bigint, userId: string, queryJson: Record<string, any>, lastEvaluatedAt: Date | null): Promise<void> {
  try {
    const { sql, params } = compileWatchlistQuery(queryJson);

    // Look for new listings since last evaluation (or last 30 days)
    const cutoff = lastEvaluatedAt ? new Date(lastEvaluatedAt.getTime()) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const listingsResult = await client.query(
      `
        SELECT id, address, price, estimated_rent
        FROM listings
        WHERE listing_type = 'for_sale'
          AND created_at > $1
          AND ${sql}
        LIMIT 50
      `,
      [cutoff, ...params]
    );

    // Create alert records for each new match
    for (const listing of listingsResult.rows) {
      const payload = {
        address: listing.address,
        price: listing.price,
        estimated_rent: listing.estimated_rent,
      };

      await client.query(
        `
          INSERT INTO alerts (watchlist_id, listing_id, kind, channel, payload, created_at)
          SELECT $1, $2, 'new_match', COALESCE(
            (SELECT 'email' WHERE (SELECT email FROM user_alert_prefs WHERE user_id = $3) IS NOT NULL),
            'email'
          ), $4, now()
          ON CONFLICT DO NOTHING
        `,
        [watchlistId, listing.id, userId, JSON.stringify(payload)]
      );
    }

    // Update last_evaluated_at
    await client.query(
      `UPDATE watchlists SET last_evaluated_at = now() WHERE id = $1`,
      [watchlistId]
    );

    logger.info({ watchlistId, listingsCount: listingsResult.rows.length }, 'Evaluated watchlist');
  } catch (err) {
    logger.error({ err, watchlistId }, 'Error evaluating watchlist');
    // Mark as evaluated anyway to avoid repeated failures
    await client.query(
      `UPDATE watchlists SET last_evaluated_at = now() WHERE id = $1`,
      [watchlistId]
    );
  }
}

/**
 * Send a single alert via email or webhook.
 */
async function sendAlert(client: any, alertId: bigint, watchlistId: bigint, userId: string, alert: any): Promise<void> {
  try {
    // Fetch user prefs
    const prefsResult = await client.query(
      `SELECT email, webhook_url FROM user_alert_prefs WHERE user_id = $1`,
      [userId]
    );

    const prefs = prefsResult.rows[0];
    if (!prefs) {
      logger.warn({ userId }, 'No alert prefs found for user');
      return;
    }

    if (alert.channel === 'email' && prefs.email) {
      // Send via Resend
      await sendEmailAlert(alert, prefs.email);
      await client.query(`UPDATE alerts SET sent_at = now() WHERE id = $1`, [alertId]);
      logger.info({ alertId }, 'Sent email alert');
    } else if (alert.channel === 'webhook' && prefs.webhook_url) {
      // POST to webhook
      await sendWebhookAlert(alert, prefs.webhook_url);
      await client.query(`UPDATE alerts SET sent_at = now() WHERE id = $1`, [alertId]);
      logger.info({ alertId }, 'Sent webhook alert');
    }
  } catch (err) {
    logger.error({ err, alertId }, 'Error sending alert');
    // Leave sent_at NULL so it will retry next tick
  }
}

/**
 * Send an alert via Resend email API.
 */
async function sendEmailAlert(alert: any, recipientEmail: string): Promise<void> {
  const payload = JSON.parse(alert.payload);

  const htmlBody = `
    <h2>New Property Match</h2>
    <p><strong>Address:</strong> ${payload.address}</p>
    <p><strong>Price:</strong> $${payload.price?.toLocaleString() || 'N/A'}</p>
    <p><strong>Est. Rent:</strong> $${payload.estimated_rent?.toLocaleString() || 'N/A'}</p>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.WATCHLIST_FROM_EMAIL,
      to: recipientEmail,
      subject: `New property match: ${payload.address}`,
      html: htmlBody,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API error ${response.status}: ${text}`);
  }
}

/**
 * Send an alert via webhook.
 */
async function sendWebhookAlert(alert: any, webhookUrl: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alertId: alert.id,
      kind: alert.kind,
      payload: JSON.parse(alert.payload),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}

/**
 * Main tick: evaluate watchlists and send alerts.
 */
async function tick(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Evaluate watchlists
    const watchlistsResult = await client.query(
      `
        SELECT id, user_id, query_json, last_evaluated_at
        FROM watchlists
        WHERE last_evaluated_at IS NULL OR last_evaluated_at < now() - interval '15 minutes'
        LIMIT 100
      `
    );

    for (const wl of watchlistsResult.rows) {
      await evaluateWatchlist(client, wl.id, wl.user_id, wl.query_json, wl.last_evaluated_at);
    }

    // 2. Send unsent alerts
    const alertsResult = await client.query(
      `
        SELECT a.id, a.watchlist_id, w.user_id, a.channel, a.payload, a.kind
        FROM alerts a
        JOIN watchlists w ON a.watchlist_id = w.id
        WHERE a.sent_at IS NULL
        LIMIT 100
      `
    );

    for (const alert of alertsResult.rows) {
      await sendAlert(client, alert.id, alert.watchlist_id, alert.user_id, alert);
    }

    logger.debug(
      { watchlists: watchlistsResult.rows.length, alerts: alertsResult.rows.length },
      'Tick complete'
    );
  } finally {
    client.release();
  }
}

/**
 * Main loop.
 */
async function main() {
  logger.info({ tickMs: env.WATCHLIST_TICK_MS }, 'Watchlist alerts worker starting');

  // Initial tick
  await tick();

  // Scheduled ticks
  setInterval(tick, env.WATCHLIST_TICK_MS).unref();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing pool');
    await pool.end();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error({ err }, 'Startup error');
  process.exit(1);
});
