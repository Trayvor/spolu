import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  ErrorCodes,
  PutMyTaskTimeBodySchema,
  PutMyTicketTimeBodySchema,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin } from '../auth/session.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canUseBoard } from '../tasks/policy.js';
import { getTaskTimeSubject, listTasksFromTicket } from '../tasks/task-service.js';
import { ticketAssigneeIds } from '../tickets/audience.js';
import { actorReadsTicket, getTicketRow } from '../tickets/service.js';
import { canLogOwnTaskTime, canLogOwnTicketTime, canSeeFinance } from './policy.js';
import { fillTaskTime, getTaskTime } from './task-time.js';
import { fillTicketTime, getTicketTime, type TicketTimeSubject } from './ticket-time.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * Time on done (Phase 32, spec §7): registered by `routes.ts` outside `requireFinance`, since
 * every admin assignee (riešiteľ) uses it.
 *   GET /api/tasks/:id/time · PUT /api/tasks/:id/time/me { minutes }
 *   GET /api/tickets/:id/time · PUT /api/tickets/:id/time/me { minutes } | { coveredByTasks }
 * Guards: `requireAdmin` (a client 403), the task's `canUseBoard` (the ticket's read rule; 404),
 * then `canLogOwnTaskTime` (`canLogOwnTicketTime`) to write; to read, that or `canSeeFinance`
 * (403). The answers are about the caller only unless `canSeeFinance`.
 */
export const taskTimeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const adminOnly = requireAdmin(app.auth);
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });

  /** The task when the actor may use its board, else null (404). */
  const readableTask = async (actor: SessionUser, id: string) => {
    const task = await getTaskTimeSubject(db, id);
    if (!task || !canUseBoard(actor, task.groupId, await clientGroupIds(db, actor.id))) {
      return null;
    }
    return task;
  };

  app.get<IdParams>('/tasks/:id/time', { preHandler: adminOnly }, async (request, reply) => {
    const actor = request.user!;
    const task = await readableTask(actor, request.params.id);
    if (!task) return send(reply, 404, ErrorCodes.notFound);
    if (!canLogOwnTaskTime(actor, task.assigneeIds) && !canSeeFinance(actor)) {
      return send(reply, 403, ErrorCodes.forbidden);
    }
    return getTaskTime(db, actor, task);
  });

  app.put<IdParams>('/tasks/:id/time/me', { preHandler: adminOnly }, async (request, reply) => {
    const actor = request.user!;
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = PutMyTaskTimeBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    const task = await readableTask(actor, request.params.id);
    if (!task) return send(reply, 404, ErrorCodes.notFound);
    if (!canLogOwnTaskTime(actor, task.assigneeIds)) return send(reply, 403, ErrorCodes.forbidden);
    return fillTaskTime({ db, io: app.io }, actor, task, body.data.minutes);
  });

  /** The ticket as the time code needs it when the actor reads it, else null (404). */
  const readableTicket = async (
    actor: SessionUser,
    id: string,
  ): Promise<TicketTimeSubject | null> => {
    const row = await getTicketRow(db, id);
    if (!row || !(await actorReadsTicket(db, actor, row))) return null;
    const [assigneeIds, linked] = await Promise.all([
      ticketAssigneeIds(db, id),
      listTasksFromTicket(db, id),
    ]);
    return {
      ticketId: id,
      groupId: row.groupId,
      number: row.number,
      title: row.subject ?? '',
      resolvedAt: row.status === 'resolved' ? row.resolvedAt : null,
      assigneeIds,
      linkedTasks: linked.map((t) => ({ taskId: t.id, title: t.title, done: t.completed })),
      projectId: row.projectId,
      eventId: row.eventId,
    };
  };

  app.get<IdParams>('/tickets/:id/time', { preHandler: adminOnly }, async (request, reply) => {
    const actor = request.user!;
    const ticket = await readableTicket(actor, request.params.id);
    if (!ticket) return send(reply, 404, ErrorCodes.notFound);
    if (!canLogOwnTicketTime(actor, ticket) && !canSeeFinance(actor)) {
      return send(reply, 403, ErrorCodes.forbidden);
    }
    return getTicketTime(db, actor, ticket);
  });

  app.put<IdParams>('/tickets/:id/time/me', { preHandler: adminOnly }, async (request, reply) => {
    const actor = request.user!;
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = PutMyTicketTimeBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    const ticket = await readableTicket(actor, request.params.id);
    if (!ticket) return send(reply, 404, ErrorCodes.notFound);
    if (!canLogOwnTicketTime(actor, ticket)) return send(reply, 403, ErrorCodes.forbidden);
    return fillTicketTime({ db, io: app.io }, actor, ticket, body.data);
  });
};
