import { Pool, QueryResult } from 'pg';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_HOST) {
  throw new Error('DATABASE_URL or POSTGRES_HOST environment variable is required');
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 50,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD,
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'postgres',
        max: 50,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

const originalQuery = pool.query.bind(pool);

pool.query = async function wrappedQuery(text: string | { text: string; values?: unknown[] }, params?: unknown[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await originalQuery(text as any, params as any);
    const duration = Date.now() - start;
    if (duration > 200) {
      const queryText = typeof text === 'string' ? text : text.text;
      console.warn(`[SLOW QUERY] ${duration}ms: ${queryText?.substring(0, 100)}...`);
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
