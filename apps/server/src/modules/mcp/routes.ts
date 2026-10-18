import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { ErrorCodes, McpTokenCreateBodySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin } from '../auth/session.js';
import { listAudit } from './audit.js';
import { canUseMcp } from './policy.js';
import { createToken, listTokens, revokeToken, TokenLimitError } from './tokens.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * The signed-in admin's own MCP tokens and audit list (spec §3.2). Every route acts on
 * `request.user` only; none of them is reachable from MCP (not in the allowlist).
 */
export const mcpTokenRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const allowCreate = createRateLimiter({ windowMs: 3_600_000, max: 20 });
  const mcpUser: preHandlerAsyncHookHandler[] = [
    requireAdmin(app.auth),
    async (request, reply) => {
      if (!canUseMcp(request.user!)) return send(reply, 403, ErrorCodes.forbidden);
    },
  ];

  app.get('/me/mcp/tokens', { preHandler: mcpUser }, async (request) =>
    listTokens(db, request.user!.id),
  );

  app.post('/me/mcp/tokens', { preHandler: mcpUser }, async (request, reply) => {
    const body = McpTokenCreateBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!allowCreate(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    try {
      return reply.code(201).send(await createToken(db, request.user!.id, body.data));
    } catch (error) {
      if (error instanceof TokenLimitError) return send(reply, 409, ErrorCodes.mcpTokenLimit);
      throw error;
    }
  });

  app.delete<IdParams>('/me/mcp/tokens/:id', { preHandler: mcpUser }, async (request, reply) => {
    const revoked = await revokeToken(db, request.user!.id, request.params.id);
    if (!revoked) return send(reply, 404, ErrorCodes.notFound);
    return reply.code(204).send();
  });

  app.get('/me/mcp/audit', { preHandler: mcpUser }, async (request) =>
    listAudit(db, request.user!.id),
  );
};
