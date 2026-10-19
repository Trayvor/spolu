import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, TicketRatingBodySchema, TicketRatingQuerySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { emitTicketRated } from './events.js';
import { notifyTicketRated } from './notify.js';
import { canRateTicket, canReadTicket, ratingOpen } from './policy.js';
import {
  getRatingSummary,
  InvalidRatingCursorError,
  listRatings,
  setTicketRating,
} from './ratings.js';
import { getTicketForActor, getTicketRow, roleIn } from './service.js';

/** Rating writes per minute and user (2026-10-19, anti-abuse). */
export const TICKET_RATING_WRITES_PER_MINUTE = 20;

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * Ticket rating (2026-10-19): the initiator rates a resolved ticket, admins read the totals and
 * the list. Every rule is a policy function; the comment is never logged, emitted or notified.
 */
export const ticketRatingsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db, config } = deps;
  const anyUser = requireUser(app.auth);
  const adminOnly = requireAdmin(app.auth);
  const allowWrite = createRateLimiter({
    windowMs: 60_000,
    max: config.ticketRatingsPerMinute ?? TICKET_RATING_WRITES_PER_MINUTE,
  });

  app.put<IdParams>('/tickets/:id/rating', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const row = await getTicketRow(db, request.params.id);
    const role = row ? await roleIn(db, actor, row.groupId) : null;
    // 404 first, so the answer tells an outsider nothing about the ticket.
    if (!row || !canReadTicket(actor, row, role)) return send(reply, 404, ErrorCodes.notFound);
    if (!canRateTicket(actor, row, role)) return send(reply, 403, ErrorCodes.forbidden);
    if (row.status !== 'resolved') return send(reply, 409, ErrorCodes.ticketNotResolved);
    const now = new Date();
    if (!ratingOpen(row, now)) return send(reply, 409, ErrorCodes.ratingClosed);
    const body = TicketRatingBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const { turnedDown } = await setTicketRating(db, row.id, actor.id, body.data, now);
    emitTicketRated(app.io, row, actor.id);
    if (turnedDown) {
      try {
        await notifyTicketRated(deps, row, actor.id);
      } catch (error) {
        // The rating is saved; ids only, never the comment.
        request.log.error({ err: error, ticketId: row.id }, 'ticket rated notification failed');
      }
    }
    return getTicketForActor(db, actor, row.id);
  });

  const parseQuery = (raw: unknown, reply: FastifyReply) => {
    const query = TicketRatingQuerySchema.safeParse(raw);
    if (!query.success) send(reply, 400, ErrorCodes.validationFailed);
    return query.success ? query.data : null;
  };

  app.get('/tickets/ratings/summary', { preHandler: adminOnly }, async (request, reply) => {
    const query = parseQuery(request.query, reply);
    if (!query) return reply;
    return getRatingSummary(db, { days: query.days, groupId: query.groupId }, new Date());
  });

  app.get('/tickets/ratings', { preHandler: adminOnly }, async (request, reply) => {
    const query = parseQuery(request.query, reply);
    if (!query) return reply;
    try {
      return await listRatings(db, query, new Date());
    } catch (error) {
      // The code the ticket lists answer for a bad cursor.
      if (error instanceof InvalidRatingCursorError) {
        return send(reply, 400, ErrorCodes.invalidFilter);
      }
      throw error;
    }
  });
};
