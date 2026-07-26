import { Pool, QueryResult } from 'pg';
import { reportSlowQuery, slowQueryThresholdMs } from '@oper/observability/slow-query';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const originalQuery = pool.query.bind(pool);

pool.query = async function wrappedQuery(
  text: string | { text: string; values?: unknown[] },
  params?: unknown[],
): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await originalQuery(text as never, params as never);
    const duration = Date.now() - start;
    if (duration > 200) {
      const queryText = typeof text === 'string' ? text : text.text;
      console.warn(`[SLOW QUERY] ${duration}ms: ${queryText?.substring(0, 100)}...`);
      // Same push apps/one gets. Dedup is keyed on the query's SHAPE, so the
      // two apps sharing a threshold and a Telegram channel will not
      // double-alert on identical statements, but genuinely different queries
      // still alert separately — which is the point of instrumenting both.
      if (duration >= slowQueryThresholdMs()) reportSlowQuery(queryText ?? '', duration);
    }
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const queryText = typeof text === 'string' ? text : text.text;
    console.error(`[DB ERROR] ${duration}ms: ${queryText?.substring(0, 100)}...`, error);
    throw error;
  }
} as never;

export default pool;
