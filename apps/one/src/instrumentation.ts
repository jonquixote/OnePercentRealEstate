// Next.js instrumentation entry. Next discovers this file automatically
// (it must live at `src/instrumentation.ts`) and calls `register()`
// once per server runtime.
//
// IMPORTANT: this file is loaded in BOTH the Node and Edge runtimes.
// `@opentelemetry/instrumentation-pg` relies on Node-only APIs
// (`require`, monkey-patching pg.Client) and crashed Edge chunks with
// `this.enable is not a function` until we started gating it by
// process.env.NEXT_RUNTIME === 'nodejs'.
//
// Wave 2 design notes:
// 1. **Vercel OTel SDK** — handles batching, exporter wiring, edge/node
//    runtime split. We don't roll our own NodeSDK setup.
// 2. **No-op when no exporter endpoint** — `OTEL_EXPORTER_OTLP_ENDPOINT`
//    is the trip-wire. Unset → registerOTel skips the exporter; spans
//    still bubble through in-process consumers (withSpan helpers) but
//    nothing leaves the box. Keeps `next build`, `next dev`, and CI
//    green without a running Tempo or OTel collector.
// 3. **PgInstrumentation Node-only** — see gate below.
//
// Service name `apps-one` matches the docker-compose service name.

export async function register(): Promise<void> {
  const { registerOTel } = await import('@vercel/otel');

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PgInstrumentation } = await import(
      '@opentelemetry/instrumentation-pg'
    );
    registerOTel({
      serviceName: 'apps-one',
      instrumentations: [
        new PgInstrumentation({
          // Don't include parameter values — often PII / large.
          enhancedDatabaseReporting: false,
        }),
      ],
    });
    return;
  }

  // Edge runtime — register without Node-only pg instrumentation.
  registerOTel({ serviceName: 'apps-one' });
}
