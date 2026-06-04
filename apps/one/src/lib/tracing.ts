// Thin wrapper over OTel API for route handlers. Use `withSpan('name', () => fn())`
// to wrap a DB query or any other discrete unit of work and surface it
// in Grafana Tempo as a child span of the request span. When OTel is
// not configured (no exporter endpoint), `trace.getTracer()` returns a
// no-op tracer and `withSpan` becomes a free function call — safe to
// sprinkle without conditional logic.

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const TRACER_NAME = 'apps-one';

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs: Record<string, string | number | boolean> = {},
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [k, v] of Object.entries(attrs)) {
        span.setAttribute(k, v);
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Synchronous variant for non-async work (URL parsing, validation, etc).
// Returned to keep call-site shape consistent.
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attrs: Record<string, string | number | boolean> = {},
): T {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, (span) => {
    try {
      for (const [k, v] of Object.entries(attrs)) {
        span.setAttribute(k, v);
      }
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}
