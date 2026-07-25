import { Pool, QueryResult } from 'pg';
import { env } from '@/lib/env';
import { reportSlowQuery, slowQueryThresholdMs } from '@/lib/slow-query';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const originalQuery = pool.query.bind(pool);

pool.query = async function wrappedQuery(text: string | { text: string; values?: unknown[] }, params?: unknown[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await originalQuery(text as any, params as any);
    const duration = Date.now() - start;
    if (duration > 200) {
      const queryText = typeof text === 'string' ? text : text.text;
      console.warn(`[SLOW QUERY] ${duration}ms: ${queryText?.substring(0, 100)}...`);
      // Above the (higher) alert threshold this also pushes, deduped by query
      // shape. Keep logging everything over 200ms — the journal stays the
      // detailed record, the alert is only for the ones worth waking up for.
      if (duration >= slowQueryThresholdMs()) reportSlowQuery(queryText ?? '', duration);
    }
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const queryText = typeof text === 'string' ? text : text.text;
    console.error(`[DB ERROR] ${duration}ms: ${queryText?.substring(0, 100)}...`, error);
    throw error;
  }
} as any;

export default pool;
