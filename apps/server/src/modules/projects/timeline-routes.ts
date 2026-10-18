import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  ErrorCodes,
  EventItemsQuerySchema,
  TimelineQuerySchema,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { clientGroupIds } from '../groups/memberships.js';
import { getGroup } from '../groups/service.js';
import { getActiveCards } from './overview.js';
import { canReadProjects } from './policy.js';
import { eventOwner, InvalidProjectCursorError } from './service.js';
import { eventItems, getTimeline } from './timeline.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

/**
 * The Prehľad tab's reads (Phase 33 part P4, spec §7.3, §7.4): the timeline, an event's lists and
 * the active cards. Everyone who reads the client (`canReadProjects`) reaches them; a žiadateľ,
 * another client and an unknown id get 404.
 */
export const timelineRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const readsGroup = async (actor: SessionUser, groupId: string) =>
    canReadProjects(actor, groupId, await clientGroupIds(db, actor.id)) &&
    (await getGroup(db, groupId)) !== null;

  app.get<IdParams>('/groups/:id/timeline', { preHandler: anyUser }, async (request, reply) => {
    const query = TimelineQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    if (!(await readsGroup(request.user!, request.params.id))) return notFound(reply);
    try {
      return await getTimeline(db, request.params.id, query.data);
    } catch (error) {
      if (error instanceof InvalidProjectCursorError) return invalid(reply);
      throw error;
    }
  });

  app.get<IdParams>(
    '/project-events/:id/items',
    { preHandler: anyUser },
    async (request, reply) => {
      const query = EventItemsQuerySchema.safeParse(request.query);
      if (!query.success) return invalid(reply);
      const actor = request.user!;
      const owner = await eventOwner(db, request.params.id);
      if (
        owner === null ||
        !canReadProjects(actor, owner.groupId, await clientGroupIds(db, actor.id))
      ) {
        return notFound(reply);
      }
      try {
        return await eventItems(db, owner.groupId, request.params.id, query.data);
      } catch (error) {
        if (error instanceof InvalidProjectCursorError) return invalid(reply);
        throw error;
      }
    },
  );

  app.get<IdParams>(
    '/groups/:id/overview/active',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      if (!(await readsGroup(actor, request.params.id))) return notFound(reply);
      return getActiveCards(db, request.params.id, actor.id);
    },
  );
};
