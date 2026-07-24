import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryResult } from 'pg';
import pool from '@/lib/db';

interface QueryTrace {
  text: string;
  duration: number;
}

interface RequestStats {
  queryCount: number;
  totalMs: number;
  slowest: QueryTrace | null;
}

const traceEnabled = process.env.QUERY_TRACE === '1';

const als = new AsyncLocalStorage<RequestStats>();

const noopGetRequestStats = (): RequestStats | null => null;
const noopResetRequestStats = (): void => {};

let resetRequestStats: () => void;
let getRequestStats: () => RequestStats | null;

if (!traceEnabled) {
  getRequestStats = noopGetRequestStats;
  resetRequestStats = noopResetRequestStats;
} else {
  const origQuery = pool.query.bind(pool);

  pool.query = async function tracedQuery(
    text: string | { text: string; values?: unknown[] },
    params?: unknown[]
  ): Promise<QueryResult> {
    const stats = als.getStore();
    if (!stats) {
      return origQuery(text as any, params as any);
    }

    const start = Date.now();
    const queryText = typeof text === 'string' ? text : text.text;
    try {
      const result = await origQuery(text as any, params as any);
      const duration = Date.now() - start;

      stats.queryCount++;
      stats.totalMs += duration;
      if (!stats.slowest || duration > stats.slowest.duration) {
        stats.slowest = { text: queryText, duration };
      }

      return result;
    } catch (error) {
      const duration = Date.now() - start;

      stats.queryCount++;
      stats.totalMs += duration;
      if (!stats.slowest || duration > stats.slowest.duration) {
        stats.slowest = { text: queryText, duration };
      }

      throw error;
    }
  } as typeof pool.query;

  resetRequestStats = (): void => {
    als.enterWith({ queryCount: 0, totalMs: 0, slowest: null });
  };

  getRequestStats = (): RequestStats | null => {
    const stats = als.getStore();
    if (!stats) return null;

    console.log(
      `[QUERY TRACE] queries=${stats.queryCount} total=${stats.totalMs}ms` +
        (stats.slowest
          ? ` slowest=${stats.slowest.duration}ms: ${stats.slowest.text.slice(0, 120)}`
          : '')
    );

    return stats;
  };
}

export { getRequestStats, resetRequestStats };

export type { RequestStats, QueryTrace };
