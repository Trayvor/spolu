import type { ZodType } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * GET `/api${path}` and parse the JSON body with `schema`.
 * The body is parsed whatever the status, so a 503 health response yields the degraded object.
 * A body that is not JSON, or does not match the schema, rejects with ApiError.
 */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`Response from ${path} is not JSON (HTTP ${res.status})`, res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      `Response from ${path} does not match the expected shape (HTTP ${res.status})`,
      res.status,
    );
  }
  return parsed.data;
}
