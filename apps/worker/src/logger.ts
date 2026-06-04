// pino logger with trace_id propagation. Use `withTrace()` in handlers
// to bind a per-job correlation id so all downstream log lines (claim,
// scrape POST, update) share it. Maps cleanly onto OTel trace_id once
// the Wave 2 OTel work is rolled into the worker (deferred to Wave 7
// when the monitoring stack is wired into compose).

import pino, { type Logger } from 'pino';

export type WorkerLogger = Logger;

let rootLogger: Logger | null = null;

export function getLogger(level = 'info'): Logger {
  if (rootLogger) return rootLogger;
  rootLogger = pino({
    level,
    // ISO timestamps line up with the Next app's logger for cross-service
    // grep-ability before we have proper trace correlation.
    timestamp: pino.stdTimeFunctions.isoTime,
    // JSON to stdout — `docker logs` is the contract here, and json-file
    // log driver in compose preserves structure.
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: { service: 'worker' },
  });
  return rootLogger;
}

export function withTrace(parent: Logger, traceId: string, extra: Record<string, unknown> = {}): Logger {
  return parent.child({ trace_id: traceId, ...extra });
}

// Cheap, dependency-free request id. Not crypto-grade — fine for log
// correlation only. Format: w_<unix ms>_<rand4>.
export function newTraceId(): string {
  const r = Math.random().toString(36).slice(2, 6);
  return `w_${Date.now().toString(36)}_${r}`;
}
