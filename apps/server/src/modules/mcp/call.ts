import type { FastifyInstance } from 'fastify';
import type { McpScope, SessionUser } from '@spolu/shared';
import { runAsUser } from '../auth/internal-calls.js';
import { isAllowedRoute } from './allowlist.js';

/**
 * Calls our own HTTP API in process as a user (ADR 0033): `app.inject` with the internal-call
 * header, so the route's guards, validation, policy, service, socket events and notifications run
 * exactly as for that user in the app. Only allowlisted routes; anything else throws (and the
 * route guard, `guard.ts`, refuses a resolved route that is not an exact entry).
 */
export type ApiResult = {
  status: number;
  /** The JSON answer, or null for an empty or non-JSON one. */
  body: unknown;
  /** The bytes of a non-JSON answer (a file). */
  raw?: Buffer;
  contentType?: string;
  /** The answer's headers of a non-JSON answer (`content-range`, `content-disposition`). */
  headers?: Record<string, string>;
};

export type ApiCaller = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options?: {
    query?: Record<string, string>;
    body?: unknown;
    /** A `Range` header (`bytes=0-1023`), for reading the start of a file only. */
    range?: string;
    /** Keep the answer as bytes even when it is JSON (a file's content). */
    binary?: boolean;
  },
) => Promise<ApiResult>;

export class RouteNotAllowedError extends Error {
  constructor(method: string, path: string) {
    super(`MCP may not call ${method} ${path}`);
    this.name = 'RouteNotAllowedError';
  }
}

/**
 * `scope` is the token's: a `read` caller sends GET requests only, whatever a tool asks (defence
 * in depth; `canCallTool` already keeps write tools from read-only tokens).
 */
export function createApiCaller(
  app: FastifyInstance,
  user: SessionUser,
  remoteAddress: string,
  scope: McpScope,
): ApiCaller {
  return async (method, path, options = {}) => {
    if (scope !== 'write' && method !== 'GET') throw new RouteNotAllowedError(method, path);
    if (!isAllowedRoute(method, path, user)) throw new RouteNotAllowedError(method, path);
    const search = new URLSearchParams(options.query ?? {}).toString();
    const url = search ? `${path}?${search}` : path;
    const hasBody = options.body !== undefined;
    const res = await runAsUser(user, (headers) =>
      app.inject({
        method,
        url,
        remoteAddress,
        headers: {
          ...headers,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...(options.range ? { range: options.range } : {}),
        },
        ...(hasBody ? { payload: JSON.stringify(options.body) } : {}),
      }),
    );
    const contentType = String(res.headers['content-type'] ?? '');
    if (!options.binary && contentType.includes('application/json')) {
      return { status: res.statusCode, body: res.body === '' ? null : res.json() };
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    return { status: res.statusCode, body: null, raw: res.rawPayload, contentType, headers };
  };
}
