import { z } from 'zod';

// DATABASE_URL / REDIS_URL are required at RUNTIME but optional at BUILD
// time (e.g. `next build` on Vercel preview deploys without a real DB).
// We validate them lazily via `assertRuntimeEnv()` so the build graph can
// still be analyzed when these are missing.
const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),

  HUD_API_TOKEN: z.string().optional(),
  FRED_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ANNUAL: z.string().optional(),
  // Agency price id. NEXT_PUBLIC_ so the client pricing page can decide whether
  // to render the Agency column at build time (it is inlined into the bundle).
  NEXT_PUBLIC_STRIPE_PRICE_AGENCY: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables. See logs above.');
}

export const env = parsed.data;

/**
 * Throws if required runtime env vars are missing. Call from API routes
 * and server components that touch the DB or Redis — keeps `next build`
 * working in environments that don't have those secrets.
 */
export function assertRuntimeEnv(): void {
  const required = ['DATABASE_URL', 'REDIS_URL'] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required runtime env vars: ${missing.join(', ')}. ` +
        'Set them in your environment (e.g. /opt/onepercent/.env on the server).'
    );
  }
  if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 16) {
    throw new Error('ADMIN_API_KEY must be at least 16 characters.');
  }
}
