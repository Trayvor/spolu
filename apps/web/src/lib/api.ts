import type { ZodType } from 'zod';
import { i18n } from '@/i18n';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** Error code from the JSON body: `error` (our routes) or `code` (better-auth). */
  get code(): string | undefined {
    if (typeof this.body !== 'object' || this.body === null) return undefined;
    const { error, code } = this.body as { error?: unknown; code?: unknown };
    if (typeof error === 'string') return error;
    return typeof code === 'string' ? code : undefined;
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Send a JSON request to `/api${path}`. A 2xx answer is parsed with `schema` when given
 * (undefined without one); any other status rejects with ApiError carrying the parsed body.
 */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  schema?: ZodType<T>,
): Promise<T | undefined> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok)
    throw new ApiError(`${method} ${path} failed (HTTP ${res.status})`, res.status, data);
  if (!schema) return undefined;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(`Response from ${path} does not match the expected shape`, res.status, data);
  }
  return parsed.data;
}

/**
 * GET `/api${path}` and parse the JSON body with `schema`.
 * The body is parsed whatever the status, so a 503 health response yields the degraded object.
 * A body that is not JSON, or does not match the schema, rejects with ApiError.
 */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'Accept-Language': i18n.language },
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
