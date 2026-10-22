import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { ErrorCodes, McpTokenCreateBodySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { getUserById } from '../users/service.js';
import { listAudit } from './audit.js';
import { tokenCreatedEmail } from './emails.js';
import { mayUseMcp } from './access.js';
import { createToken, listTokens, revokeToken, TokenLimitError } from './tokens.js';
import { auditActorOf } from '../audit/request-actor.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * The signed-in user's own MCP tokens (admins and managers, `mayUseMcp`) and audit list (spec §3.2). Every route acts on
 * `request.user` only; none of them is reachable from MCP (not in the allowlist).
 */
export const mcpTokenRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const allowCreate = createRateLimiter({ windowMs: 3_600_000, max: 20 });
  const mcpUser: preHandlerAsyncHookHandler[] = [
    requireUser(app.auth),
    async (request, reply) => {
      if (!(await mayUseMcp(db, request.user!))) return send(reply, 403, ErrorCodes.forbidden);
    },
  ];

  app.get('/me/mcp/tokens', { preHandler: mcpUser }, async (request) =>
    listTokens(db, request.user!.id),
  );

  app.post('/me/mcp/tokens', { preHandler: mcpUser }, async (request, reply) => {
    const body = McpTokenCreateBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!allowCreate(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    let created;
    try {
      created = await createToken(db, request.user!.id, body.data, auditActorOf(request));
    } catch (error) {
      if (error instanceof TokenLimitError) return send(reply, 409, ErrorCodes.mcpTokenLimit);
      throw error;
    }
    // Tell the owner, so a token someone else made with their session gets noticed.
    try {
      const owner = await getUserById(db, request.user!.id);
      if (owner) {
        await sendEmailLater(
          deps.jobs,
          tokenCreatedEmail(
            { to: owner.email, lang: owner.language, publicUrl: deps.config.publicUrl },
            { name: created.item.name, createdAt: new Date(created.item.createdAt) },
          ),
        );
      }
    } catch (error) {
      request.log.error({ err: error }, 'could not queue the MCP token notice');
    }
    return reply.code(201).send(created);
  });

  app.delete<IdParams>('/me/mcp/tokens/:id', { preHandler: mcpUser }, async (request, reply) => {
    const revoked = await revokeToken(
      db,
      request.user!.id,
      request.params.id,
      auditActorOf(request),
    );
    if (!revoked) return send(reply, 404, ErrorCodes.notFound);
    return reply.code(204).send();
  });

  app.get('/me/mcp/audit', { preHandler: mcpUser }, async (request) =>
    listAudit(db, request.user!.id),
  );
};
