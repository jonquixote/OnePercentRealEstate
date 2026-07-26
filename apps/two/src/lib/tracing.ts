import { trackRoute } from '@oper/observability/perf-track';

/**
 * Minimal route timing for the terminal.
 *
 * apps/one wraps OpenTelemetry here, but no exporter is configured on this box,
 * so those spans went nowhere and the durations were only ever useful because
 * they also fed the in-memory ring. This is that part, without the ceremony.
 *
 * Route names are prefixed `two.` so a shared perf snapshot never confuses the
 * two apps — apps/one uses bare names like `api.stats` and `market.zip`.
 */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    // Failures are latency too — a timeout is the worst experience of all.
    trackRoute(name, Date.now() - startedAt);
  }
}
