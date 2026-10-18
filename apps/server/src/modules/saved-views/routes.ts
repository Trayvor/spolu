import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, SavedViewBodySchema, SavedViewPageSchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { canUseSavedViews } from './policy.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  SavedViewLimitError,
} from './service.js';

type IdParams = { Params: { id: string } };
type PageQuery = { Querystring: { page?: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * Saved views (F5): the caller's own views of one page. `GET /me/saved-views?page=`,
 * `POST /me/saved-views`, `DELETE /me/saved-views/:id`; admins only, the finance page finance
 * admins only (`canUseSavedViews`).
 */
export const savedViewsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const user = requireUser(app.auth);

  app.get<PageQuery>('/me/saved-views', { preHandler: user }, async (request, reply) => {
    const page = SavedViewPageSchema.safeParse(request.query.page);
    if (!page.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!canUseSavedViews(request.user!, page.data)) return send(reply, 403, ErrorCodes.forbidden);
    return listSavedViews(db, request.user!.id, page.data);
  });

  app.post('/me/saved-views', { preHandler: user }, async (request, reply) => {
    const body = SavedViewBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!canUseSavedViews(request.user!, body.data.page)) {
      return send(reply, 403, ErrorCodes.forbidden);
    }
    try {
      return reply.code(201).send(await createSavedView(db, request.user!.id, body.data));
    } catch (error) {
      if (error instanceof SavedViewLimitError) return send(reply, 409, ErrorCodes.savedViewLimit);
      throw error;
    }
  });

  app.delete<IdParams>('/me/saved-views/:id', { preHandler: user }, async (request, reply) => {
    const actor = request.user!;
    if (!canUseSavedViews(actor)) return send(reply, 403, ErrorCodes.forbidden);
    // Someone else's view, or none: the same answer.
    if (!(await deleteSavedView(db, actor.id, request.params.id))) {
      return send(reply, 404, ErrorCodes.notFound);
    }
    return reply.code(204).send();
  });
};
