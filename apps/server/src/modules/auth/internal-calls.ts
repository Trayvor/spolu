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

/** How the call reached us: through an MCP token (its id and name, for the audit log). */
export type InternalVia = { kind: 'mcp'; tokenId: string; tokenName: string };

const calls = new Map<string, { user: SessionUser; via: InternalVia | null }>();

/** Runs `fn` with headers that make an injected request the user's own. */
export async function runAsUser<T>(
  user: SessionUser,
  fn: (headers: Record<string, string>) => Promise<T>,
  via?: InternalVia,
): Promise<T> {
  const id = randomBytes(32).toString('base64url');
  calls.set(id, { user, via: via ?? null });
  try {
    return await fn({ [INTERNAL_CALL_HEADER]: id });
  } finally {
    calls.delete(id);
  }
}

/** The user of a running internal call named by the headers, or null. */
export function internalCallUser(headers: IncomingHttpHeaders): SessionUser | null {
  return callOf(headers)?.user ?? null;
}

/** The `via` of a running internal call named by the headers, or null. */
export function internalCallVia(headers: IncomingHttpHeaders): InternalVia | null {
  return callOf(headers)?.via ?? null;
}

function callOf(headers: IncomingHttpHeaders) {
  const id = headers[INTERNAL_CALL_HEADER];
  if (typeof id !== 'string') return null;
  return calls.get(id) ?? null;
}
