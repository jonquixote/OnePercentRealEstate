/**
 * Slow queries alert instead of scrolling past in the journal.
 *
 * `[SLOW QUERY]` has been logged for a long time and it was right every time:
 * the 9,985 ms market ranking, the 18.5 s hero aggregate. Nobody was reading
 * the journal, so each one was found later by a human noticing the page felt
 * slow. This turns that existing signal into a push.
 *
 * Two rules keep it from becoming noise or a liability:
 *  - DEDUP on the *shape* of the query (literals stripped), so one pathological
 *    statement executed a thousand times sends one message, not a thousand.
 *  - BEST EFFORT always. The notifier is fire-and-forget and swallows its own
 *    failures; a request must never fail, block, or reject because alerting is
 *    broken.
 */

const DEDUP_WINDOW_MS = 15 * 60_000;
const MAX_DEDUP_KEYS = 256;

const lastAlertedAt = new Map<string, number>();

/** Threshold in ms. Read per call so the env can be changed without a rebuild. */
export function slowQueryThresholdMs(): number {
  const raw = Number(process.env.SLOW_QUERY_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

/**
 * Reduce a statement to its shape: same query with different parameters yields
 * the same key, so `WHERE zip = '77002'` and `WHERE zip = '44102'` dedup together.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')       // string literals
    .replace(/\b\d+\b/g, '?')       // numeric literals
    .replace(/\$\d+/g, '?')         // bind params ($1 was already digit-stripped)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function shouldAlert(key: string): boolean {
  const now = Date.now();
  const last = lastAlertedAt.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  // Bound the map: drop the oldest entry rather than tracking keys forever.
  if (lastAlertedAt.size >= MAX_DEDUP_KEYS && !lastAlertedAt.has(key)) {
    const oldest = [...lastAlertedAt.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) lastAlertedAt.delete(oldest[0]);
  }
  lastAlertedAt.set(key, now);
  return true;
}

/** Fire-and-forget. Returns immediately; never throws, never rejects. */
export function reportSlowQuery(sql: string, durationMs: number): void {
  try {
    if (durationMs < slowQueryThresholdMs()) return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return; // not configured: stay silent, keep logging

    const shape = normalizeSql(sql);
    if (!shouldAlert(shape)) return;

    const text = `🐢 SLOW QUERY ${durationMs}ms\n\n${shape}`;
    void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    }).catch(() => {
      /* alerting must never surface as a request failure */
    });
  } catch {
    /* ditto — including anything thrown synchronously by fetch */
  }
}

/** Test-only. */
export function __resetSlowQuery(): void {
  lastAlertedAt.clear();
}
