import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, ID_RE } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { findReadableMessage } from '../chat/messages.js';
import { actorReadsTicket, getTicketRow } from '../tickets/service.js';
import type { TextToolCore } from './text-routes.js';

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });

/**
 * 2026-10-19 (ADR 0061): whoever reads a message someone else wrote (a group chat message, a
 * thread reply, a task or ticket chat message) or the description of a ticket someone else
 * wrote translates it into their own language, in every client group (since 2026-10-21, before
 * only off `.sk`) and on a ticket without a client. Access is the owning module's: a message the
 * actor cannot read, a deleted one and an unknown id are 404, like every chat route; the rest
 * (own text, the admin group, the limits, the stored translations) is the core's. Registered by
 * `textToolRoutes` with its core.
 */
export const translateRoutes: FastifyPluginAsync<{ deps: AppDeps; core: TextToolCore }> = async (
  app,
  { deps, core },
) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);

  app.post<IdParams>('/messages/:id/translate', { preHandler: anyUser }, async (request, reply) => {
    const found = await findReadableMessage(db, request.user!, request.params.id);
    if (!found || found.message.deletedAt !== null) return notFound(reply);
    const { message, channel } = found;
    return core.translateIncoming(request, reply, {
      subject: { messageId: message.id },
      groupId: channel.groupId,
      text: message.body,
      authorId: message.authorId,
      logFields: { channelId: channel.id, messageId: message.id },
    });
  });

  app.post<IdParams>('/tickets/:id/translate', { preHandler: anyUser }, async (request, reply) => {
    const id = request.params.id;
    const ticket = ID_RE.test(id) ? await getTicketRow(db, id) : null;
    if (!ticket || !(await actorReadsTicket(db, request.user!, ticket))) return notFound(reply);
    // A ticket without a client (an instance with no group) translates too (2026-10-21).
    return core.translateIncoming(request, reply, {
      subject: { ticketId: ticket.id },
      groupId: ticket.groupId,
      text: ticket.body ?? '',
      // A manual ticket is written by whoever created it, an intake ticket by its initiator.
      authorId: ticket.createdBy ?? ticket.requesterUserId,
      logFields: { ticketId: ticket.id },
    });
  });
};
