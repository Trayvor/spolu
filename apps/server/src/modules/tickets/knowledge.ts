import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, ID_RE } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import type { FileReadRule } from '../files/read-rules.js';
import { shareableItemCards } from '../knowledge/chat-items.js';
import { isLinked, ticketLinksOfFile } from '../knowledge/links.js';
import { getSharedItem } from '../knowledge/service.js';
import { actorReadsTicket, getTicketRow } from './service.js';

/**
 * Phase 33 part P5: the knowledge attached to a ticket's text, for every reader of the ticket.
 * A žiadateľ reads no knowledge otherwise; through their own ticket they open the linked items
 * read-only (no reminders, never editable) and download their files, while the item is still
 * shareable in the ticket's client. Anything else answers 404.
 */
export const ticketKnowledgeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });

  app.get<{ Params: { id: string; itemId: string } }>(
    '/tickets/:id/knowledge/:itemId',
    { preHandler: anyUser },
    async (request, reply) => {
      const { id, itemId } = request.params;
      if (!ID_RE.test(id) || !ID_RE.test(itemId)) return notFound(reply);
      const ticket = await getTicketRow(db, id);
      if (!ticket || ticket.groupId === null) return notFound(reply);
      if (!(await actorReadsTicket(db, request.user!, ticket))) return notFound(reply);
      if (!(await isLinked(db, { kind: 'ticket', id }, itemId))) return notFound(reply);
      const item = await getSharedItem(db, itemId, ticket.groupId);
      return item ?? notFound(reply);
    },
  );
};

/**
 * A file of a knowledge item linked to the text of a ticket the actor reads, while the item is
 * still shareable in the ticket's client. Registered with the files module by the ticket chat;
 * `readableByRule` never opens an admins-only or finance-only file.
 */
export const fileOfTicketLinkedKnowledge: FileReadRule = async (db, actor, file) => {
  for (const { ticketId, itemId } of await ticketLinksOfFile(db, file.id)) {
    const ticket = await getTicketRow(db, ticketId);
    if (!ticket || ticket.groupId === null) continue;
    if (!(await actorReadsTicket(db, actor, ticket))) continue;
    if ((await shareableItemCards(db, ticket.groupId, [itemId])).has(itemId)) return true;
  }
  return false;
};
