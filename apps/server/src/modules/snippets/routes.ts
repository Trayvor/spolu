import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { ErrorCodes, SnippetBodySchema, SnippetPatchSchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireAdmin } from '../auth/session.js';
import { canUseSnippets } from './policy.js';
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  SnippetForbiddenError,
  SnippetLimitError,
  updateSnippet,
} from './service.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * Canned replies (F7): `GET /snippets` (own and shared), `POST /snippets`, `PATCH` and
 * `DELETE /snippets/:id` (the author only). Admins only; MCP reaches all but the delete.
 */
export const snippetsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const guard: preHandlerAsyncHookHandler[] = [
    requireAdmin(app.auth),
    async (request, reply) => {
      if (!canUseSnippets(request.user!)) return send(reply, 403, ErrorCodes.forbidden);
    },
  ];

  app.get('/snippets', { preHandler: guard }, async (request) => listSnippets(db, request.user!));

  app.post('/snippets', { preHandler: guard }, async (request, reply) => {
    const body = SnippetBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      return reply.code(201).send(await createSnippet(db, request.user!, body.data));
    } catch (error) {
      if (error instanceof SnippetLimitError) return send(reply, 409, ErrorCodes.snippetLimit);
      throw error;
    }
  });

  app.patch<IdParams>('/snippets/:id', { preHandler: guard }, async (request, reply) => {
    const patch = SnippetPatchSchema.safeParse(request.body);
    if (!patch.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      const snippet = await updateSnippet(db, request.user!, request.params.id, patch.data);
      if (!snippet) return send(reply, 404, ErrorCodes.notFound);
      return snippet;
    } catch (error) {
      if (error instanceof SnippetForbiddenError) return send(reply, 403, ErrorCodes.forbidden);
      throw error;
    }
  });

  app.delete<IdParams>('/snippets/:id', { preHandler: guard }, async (request, reply) => {
    try {
      if (!(await deleteSnippet(db, request.user!, request.params.id))) {
        return send(reply, 404, ErrorCodes.notFound);
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof SnippetForbiddenError) return send(reply, 403, ErrorCodes.forbidden);
      throw error;
    }
  });
};
