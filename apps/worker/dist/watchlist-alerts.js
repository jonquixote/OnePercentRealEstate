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
import { getLogger } from './logger.js';
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
function validateWatchlistColumn(col) {
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
function compileWatchlistQuery(queryJson) {
    const conditions = [];
    const params = [];
    for (const [key, value] of Object.entries(queryJson)) {
        if (!validateWatchlistColumn(key)) {
            throw new Error(`Invalid column in watchlist query: ${key}`);
        }
        if (Array.isArray(value)) {
            // IN clause
            if (value.length === 0)
                continue;
            const placeholders = value.map((_, i) => `$${params.length + i + 1}`).join(', ');
            conditions.push(`"${key}" IN (${placeholders})`);
            params.push(...value);
        }
        else if (typeof value === 'object' && value !== null) {
            // Range query: { min: X, max: Y }
            if ('min' !== undefined && value.min !== undefined) {
                conditions.push(`"${key}" >= $${params.length + 1}`);
                params.push(value.min);
            }
            if ('max' !== undefined && value.max !== undefined) {
                conditions.push(`"${key}" <= $${params.length + 1}`);
                params.push(value.max);
            }
        }
        else {
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
async function evaluateWatchlist(client, watchlistId, userId, queryJson, lastEvaluatedAt) {
    try {
        const { sql, params } = compileWatchlistQuery(queryJson);
        // Look for new listings since last evaluation (or last 30 days)
        const cutoff = lastEvaluatedAt ? new Date(lastEvaluatedAt.getTime()) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const listingsResult = await client.query(`
        SELECT id, address, price, estimated_rent
        FROM listings
        WHERE listing_type = 'for_sale'
          AND created_at > $1
          AND ${sql}
        LIMIT 50
      `, [cutoff, ...params]);
        // Create alert records for each new match
        for (const listing of listingsResult.rows) {
            const payload = {
                address: listing.address,
                price: listing.price,
                estimated_rent: listing.estimated_rent,
            };
            await client.query(`
          INSERT INTO alerts (watchlist_id, listing_id, kind, channel, payload, created_at)
          SELECT $1, $2, 'new_match', COALESCE(
            (SELECT 'email' WHERE (SELECT email FROM user_alert_prefs WHERE user_id = $3) IS NOT NULL),
            'email'
          ), $4, now()
          ON CONFLICT DO NOTHING
        `, [watchlistId, listing.id, userId, JSON.stringify(payload)]);
        }
        // Update last_evaluated_at
        await client.query(`UPDATE watchlists SET last_evaluated_at = now() WHERE id = $1`, [watchlistId]);
        logger.info({ watchlistId, listingsCount: listingsResult.rows.length }, 'Evaluated watchlist');
    }
    catch (err) {
        logger.error({ err, watchlistId }, 'Error evaluating watchlist');
        // Mark as evaluated anyway to avoid repeated failures
        await client.query(`UPDATE watchlists SET last_evaluated_at = now() WHERE id = $1`, [watchlistId]);
    }
}
/**
 * Send a single alert via email or webhook.
 */
async function sendAlert(client, alertId, watchlistId, userId, alert) {
    try {
        // Fetch user prefs
        const prefsResult = await client.query(`SELECT email, webhook_url FROM user_alert_prefs WHERE user_id = $1`, [userId]);
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
        }
        else if (alert.channel === 'webhook' && prefs.webhook_url) {
            // POST to webhook
            await sendWebhookAlert(alert, prefs.webhook_url);
            await client.query(`UPDATE alerts SET sent_at = now() WHERE id = $1`, [alertId]);
            logger.info({ alertId }, 'Sent webhook alert');
        }
    }
    catch (err) {
        logger.error({ err, alertId }, 'Error sending alert');
        // Leave sent_at NULL so it will retry next tick
    }
}
/**
 * HTML-escape an interpolation. Listing addresses come from MLS scrapes
 * which we treat as untrusted; a value containing `<script>` or
 * `<img onerror=>` would otherwise execute in the recipient's mail client.
 */
function escHtml(input) {
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
/**
 * Send an alert via Resend email API. All interpolations are HTML-escaped
 * because the underlying listing data (address, etc.) is sourced from
 * untrusted MLS scrapes.
 */
async function sendEmailAlert(alert, recipientEmail) {
    const payload = JSON.parse(alert.payload);
    const address = escHtml(payload.address);
    const price = payload.price != null
        ? `$${escHtml(Number(payload.price).toLocaleString())}`
        : 'N/A';
    const rent = payload.estimated_rent != null
        ? `$${escHtml(Number(payload.estimated_rent).toLocaleString())}`
        : 'N/A';
    const htmlBody = `
    <h2>New Property Match</h2>
    <p><strong>Address:</strong> ${address}</p>
    <p><strong>Price:</strong> ${price}</p>
    <p><strong>Est. Rent:</strong> ${rent}</p>
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
            // Plain-text subject is rendered as text — no need to escape, but
            // strip newlines to prevent header-injection style abuse.
            subject: `New property match: ${String(payload.address ?? '')
                .replace(/[\r\n]+/g, ' ')
                .slice(0, 200)}`,
            html: htmlBody,
        }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Resend API error ${response.status}: ${text}`);
    }
}
/**
 * Validate that a user-supplied webhook URL is safe to call. Rejects
 * loopback / RFC1918 / link-local / ULA / non-https. This is an SSRF
 * mitigation because users supply webhook_url via user_alert_prefs and
 * the worker runs inside the docker network — without this we could be
 * tricked into reaching infrastructure-postgres-1, the redis container,
 * the host gateway, etc.
 */
function isPrivateIpv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
        return true; // bogus IPs are private-equivalent — reject
    }
    const [a, b] = parts;
    if (a === 10)
        return true;
    if (a === 127)
        return true;
    if (a === 169 && b === 254)
        return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 0)
        return true;
    return false;
}
async function assertSafeWebhookUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error('invalid webhook URL');
    }
    if (url.protocol !== 'https:') {
        throw new Error('webhook URL must be https://');
    }
    if (url.username || url.password) {
        throw new Error('webhook URL must not contain userinfo');
    }
    const host = url.hostname;
    if (host === 'localhost' ||
        host === '0.0.0.0' ||
        /\.local$/.test(host) ||
        /\.internal$/.test(host)) {
        throw new Error('webhook host blocked');
    }
    // Reject IPv6 ULA / loopback regardless of DNS.
    if (host.startsWith('[')) {
        const v6 = host.slice(1, -1).toLowerCase();
        if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) {
            throw new Error('webhook host blocked');
        }
    }
    // Resolve and ensure no resolution lands in private ranges.
    const { lookup } = await import('node:dns/promises');
    const addrs = await lookup(host, { all: true });
    for (const a of addrs) {
        if (a.family === 4 && isPrivateIpv4(a.address)) {
            throw new Error('webhook host resolves to private IP');
        }
        if (a.family === 6) {
            const v6 = a.address.toLowerCase();
            if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) {
                throw new Error('webhook host resolves to private IPv6');
            }
        }
    }
    return url;
}
/**
 * Send an alert via webhook. URL is SSRF-validated; redirects are
 * disabled because each hop would need re-validation and that's not
 * worth the complexity for a v1 — webhook destinations should give us
 * a stable terminal URL.
 */
async function sendWebhookAlert(alert, webhookUrl) {
    const safe = await assertSafeWebhookUrl(webhookUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(safe.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            redirect: 'manual',
            signal: controller.signal,
            body: JSON.stringify({
                alertId: alert.id,
                kind: alert.kind,
                payload: JSON.parse(alert.payload),
            }),
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`webhook returned redirect ${response.status} (rejected)`);
        }
        if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}`);
        }
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Main tick: evaluate watchlists and send alerts.
 */
async function tick() {
    const client = await pool.connect();
    try {
        // 1. Evaluate watchlists
        const watchlistsResult = await client.query(`
        SELECT id, user_id, query_json, last_evaluated_at
        FROM watchlists
        WHERE last_evaluated_at IS NULL OR last_evaluated_at < now() - interval '15 minutes'
        LIMIT 100
      `);
        for (const wl of watchlistsResult.rows) {
            await evaluateWatchlist(client, wl.id, wl.user_id, wl.query_json, wl.last_evaluated_at);
        }
        // 2. Send unsent alerts
        const alertsResult = await client.query(`
        SELECT a.id, a.watchlist_id, w.user_id, a.channel, a.payload, a.kind
        FROM alerts a
        JOIN watchlists w ON a.watchlist_id = w.id
        WHERE a.sent_at IS NULL
        LIMIT 100
      `);
        for (const alert of alertsResult.rows) {
            await sendAlert(client, alert.id, alert.watchlist_id, alert.user_id, alert);
        }
        logger.debug({ watchlists: watchlistsResult.rows.length, alerts: alertsResult.rows.length }, 'Tick complete');
    }
    finally {
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
//# sourceMappingURL=watchlist-alerts.js.map