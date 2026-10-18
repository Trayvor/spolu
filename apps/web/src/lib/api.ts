/**
 * What parses a response body: a zod schema, or a small hand-written guard for eager code that
 * must not pull zod into the initial JS (see `features/auth/me-guard.ts`).
 */
export interface ResponseParser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}
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
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  schema: ResponseParser<T>,
): Promise<T>;
export async function apiSend(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<undefined>;
export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  schema?: ResponseParser<T>,
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
 * Send raw bytes (an image) as the request body with its own content type. Answers nothing;
 * a non-2xx status rejects with ApiError carrying the parsed JSON body.
 */
export async function apiSendRaw(
  method: 'PUT',
  path: string,
  body: Blob,
  contentType: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      ...headers,
      'Content-Type': contentType,
    },
    body,
  });
  if (!res.ok) {
    throw new ApiError(
      `${method} ${path} failed (HTTP ${res.status})`,
      res.status,
      await readJson(res),
    );
  }
}

/**
 * GET `/api${path}` and parse the JSON body with `schema`.
 * The body is parsed whatever the status, so a 503 health response yields the degraded object.
 * A body that is not JSON, or does not match the schema, rejects with ApiError.
 */
export async function apiGet<T>(path: string, schema: ResponseParser<T>): Promise<T> {
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
