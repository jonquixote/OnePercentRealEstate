import { NextResponse } from 'next/server';
import { z, type ZodTypeAny } from 'zod';

export interface ApiErrorBody {
  error: { code: string; message: string };
  fields?: unknown;
}

/**
 * Standard error envelope (backend-hardening plan A2):
 *   { error: { code, message } }
 * plus any `extra` fields (e.g. a rate-limit Retry-After hint).
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

export type ParsedQuery<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Validate a route's query string against a zod schema at the boundary.
 * On failure returns a 400 with per-field errors; the caller early-returns
 * `parsed.response`. Never throws — callers degrade to 400, never 500.
 */
export function parseQuery<T extends ZodTypeAny>(
  schema: T,
  request: Request,
): ParsedQuery<z.infer<T>> {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(400, 'invalid_query', 'Invalid query parameters', {
        fields: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Coerce a numeric query param. Empty strings and non-numeric values become
 * `undefined` so a required number fails validation — instead of coercing
 * '' -> 0 or 'abc' -> NaN and surfacing a 500 deep in a SQL cast later.
 */
export function numericParam(min?: number, max?: number) {
  let inner = z.coerce.number().finite();
  if (min !== undefined) inner = inner.min(min);
  if (max !== undefined) inner = inner.max(max);
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    inner,
  );
}
