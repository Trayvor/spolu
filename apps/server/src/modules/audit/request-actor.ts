import type { FastifyRequest } from 'fastify';
import { internalCallVia } from '../auth/internal-calls.js';
import type { AuditActor } from './actor.js';

/**
 * The author of a request's change (spec §7): the session's person, or that person through their
 * MCP token or OAuth connection when the request is an in-process MCP call (`runAsUser`'s `via`).
 * Only for routes behind `requireUser` / `requireAdmin`; throws when `request.user` is not set.
 */
export function auditActorOf(request: FastifyRequest): AuditActor {
  const user = request.user;
  if (!user) throw new Error('auditActorOf needs request.user');
  const via = internalCallVia(request.headers);
  if (via) {
    return {
      kind: 'mcp',
      userId: user.id,
      name: user.name,
      tokenId: via.tokenId,
      tokenName: via.tokenName,
    };
  }
  return { kind: 'user', userId: user.id, name: user.name };
}
