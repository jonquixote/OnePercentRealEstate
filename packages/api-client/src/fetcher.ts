import { z } from "zod";

/**
 * Thin typed fetch wrapper. Both apps' query/mutation hooks call into this
 * so error handling, request-id propagation, and zod parsing are
 * centralized.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    super(message ?? `API ${status}`);
    this.name = "ApiError";
  }
}

export interface FetchOptions extends RequestInit {
  /** zod schema applied to the parsed JSON response */
  schema?: z.ZodTypeAny;
  /** abort signal (TanStack Query passes one for cancellable queries) */
  signal?: AbortSignal;
}

export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { schema, headers, ...rest } = options;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    ...rest,
  });

  let body: unknown = null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => null);
  }

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }

  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(200, body, `Response schema mismatch: ${parsed.error.message}`);
    }
    return parsed.data as T;
  }

  return body as T;
}
