// Next.js instrumentation entry. Next discovers this file automatically
// (it must live at `src/instrumentation.ts`) and calls `register()`
// once per server runtime (Node + Edge).
//
// Wave 2 design choices:
// 1. **Vercel OTel SDK** — handles batching, exporter wiring, and the
//    edge/node runtime split. We don't roll our own NodeSDK setup.
// 2. **No-op when no exporter endpoint** — `OTEL_EXPORTER_OTLP_ENDPOINT`
//    is the trip-wire. Unset → we still call `registerOTel` so the
//    `pg` instrumentation hooks AsyncLocalStorage and spans become
//    available to in-process code, but nothing is exported off-box.
//    This keeps `next build`, `next dev`, and CI green without a
//    running Tempo or OTel collector.
// 3. **`@opentelemetry/instrumentation-pg` is loaded eagerly** so SQL
//    spans become children of the request span without the route
//    needing to know anything about OTel.
//
// Service name `apps-one` matches the docker-compose service name —
// keeps trace search predictable.

import { registerOTel } from '@vercel/otel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

export function register(): void {
  registerOTel({
    serviceName: 'apps-one',
    instrumentations: [
      new PgInstrumentation({
        // Don't include parameter values — they're often PII / large.
        enhancedDatabaseReporting: false,
      }),
    ],
    // When OTEL_EXPORTER_OTLP_ENDPOINT is unset, @vercel/otel skips the
    // exporter setup quietly. When it IS set (e.g. http://tempo:4318
    // in compose), spans go out as OTLP/HTTP.
  });
}
