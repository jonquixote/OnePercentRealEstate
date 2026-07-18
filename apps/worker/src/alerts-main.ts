/**
 * Pro Deal Flow — alert tick entry point.
 *
 * Loops runAlertTick on ALERT_TICK_MS (default 5 min). Plain `node dist`
 * runtime: this file's import graph must NOT pull in @oper/query-lang
 * (that is why alerts.ts reuses the compile path via watchlist-alerts.ts
 * WITHOUT importing digest.ts).
 */

import { Pool } from 'pg';
import { loadEnv } from './env.js';
import { getLogger } from './logger.js';
import { runAlertTick } from './alerts.js';

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

async function tickOnce(): Promise<void> {
  try {
    const res = await runAlertTick(pool, logger);
    logger.debug(res, 'alert tick');
  } catch (err) {
    logger.error({ err }, 'Alert tick error');
  }
}

async function main(): Promise<void> {
  logger.info({ tickMs: env.ALERT_TICK_MS }, 'Deal alert worker starting');
  await tickOnce();
  setInterval(tickOnce, env.ALERT_TICK_MS);
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
