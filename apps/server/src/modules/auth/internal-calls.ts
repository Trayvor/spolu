import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { SessionUser } from '@spolu/shared';

/**
 * In-process requests made on a user's behalf (the MCP server, ADR 0033): the caller runs
 * `app.inject` inside `runAsUser`, with the header it is given. The header holds a random
 * 256-bit id that exists only in this process's memory and only while that call runs, so
 * `getSessionUser` (every `requireUser`, `requireAdmin`, `requireFinance`) treats the request as
 * that user's, and the same header sent from outside never matches anything.
 */
export const INTERNAL_CALL_HEADER = 'x-spolu-internal-call';

const calls = new Map<string, SessionUser>();

/** Runs `fn` with headers that make an injected request the user's own. */
export async function runAsUser<T>(
  user: SessionUser,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const id = randomBytes(32).toString('base64url');
  calls.set(id, user);
  try {
    return await fn({ [INTERNAL_CALL_HEADER]: id });
  } finally {
    calls.delete(id);
  }
}

/** The user of a running internal call named by the headers, or null. */
export function internalCallUser(headers: IncomingHttpHeaders): SessionUser | null {
  const id = headers[INTERNAL_CALL_HEADER];
  if (typeof id !== 'string') return null;
  return calls.get(id) ?? null;
}
