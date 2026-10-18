import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, ID_RE, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { requireUser } from '../auth/session.js';
import { registerFileReadRule, type FileReadRule } from '../files/read-rules.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadProjects } from '../projects/policy.js';
import { eventOwner, projectGroupId } from '../projects/service.js';
import { canUseBoard } from '../tasks/policy.js';
import { getTaskRef } from '../tasks/task-service.js';
import { isAdmin } from '../users/policy.js';
import { shareableItemCards } from './chat-items.js';
import { isLinked, subjectLinksOfFile, type LinkSubject } from './links.js';
import { canReadItem } from './policy.js';
import { getItemRef, getSharedItem } from './service.js';

/**
 * Phase 34 part P34-C: a client opens an admin-group item ("Shareable with clients") linked to
 * a description in their group read-only through that description, as a žiadateľ opens a
 * ticket's (`GET /api/tickets/:id/knowledge/:itemId`) and a chat reader a message's. Tasks,
 * projects, events and knowledge items are read by their group's readers (admins and its
 * clients), so one rule covers them: the actor reads the subject, the item is linked to it and
 * still shareable into its group. Anything else answers 404.
 */

type SubjectKind = Exclude<LinkSubject['kind'], 'ticket'>;
const KINDS: readonly SubjectKind[] = ['task', 'project', 'event', 'knowledge'];

/** The subject's group when the actor reads the subject, else null. */
async function readableSubjectGroup(
  db: Db,
  actor: SessionUser,
  subject: { kind: SubjectKind; id: string },
): Promise<string | null> {
  const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  switch (subject.kind) {
    case 'task': {
      const ref = await getTaskRef(db, subject.id);
      return ref && canUseBoard(actor, ref.groupId, groupIds) ? ref.groupId : null;
    }
    case 'project': {
      const groupId = await projectGroupId(db, subject.id);
      return groupId && canReadProjects(actor, groupId, groupIds) ? groupId : null;
    }
    case 'event': {
      const owner = await eventOwner(db, subject.id);
      return owner && canReadProjects(actor, owner.groupId, groupIds) ? owner.groupId : null;
    }
    case 'knowledge': {
      const ref = await getItemRef(db, subject.id);
      return ref && canReadItem(actor, ref, groupIds) ? ref.groupId : null;
    }
  }
}

export const knowledgeLinkRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
  registerFileReadRule(fileOfLinkedKnowledge);

  app.get<{ Params: { kind: string; subjectId: string; itemId: string } }>(
    '/knowledge-links/:kind/:subjectId/:itemId',
    { preHandler: anyUser },
    async (request, reply) => {
      const { kind, subjectId, itemId } = request.params;
      if (!KINDS.includes(kind as SubjectKind)) return notFound(reply);
      if (!ID_RE.test(subjectId) || !ID_RE.test(itemId)) return notFound(reply);
      const subject = { kind: kind as SubjectKind, id: subjectId };
      const groupId = await readableSubjectGroup(db, request.user!, subject);
      if (groupId === null) return notFound(reply);
      if (!(await isLinked(db, subject, itemId))) return notFound(reply);
      const item = await getSharedItem(db, itemId, groupId);
      return item ?? notFound(reply);
    },
  );
};

/**
 * A file of a knowledge item linked to the description of a task, project, event or knowledge
 * item the actor reads, while the item is still shareable into that subject's group: a client
 * downloads the files of an admin-group item shared there. `readableByRule` never opens an
 * admins-only or finance-only file.
 */
export const fileOfLinkedKnowledge: FileReadRule = async (db, actor, file) => {
  for (const { subject, itemId } of await subjectLinksOfFile(db, file.id)) {
    if (subject.kind === 'ticket') continue;
    const groupId = await readableSubjectGroup(db, actor, {
      kind: subject.kind,
      id: subject.id,
    });
    if (groupId === null) continue;
    if ((await shareableItemCards(db, groupId, [itemId])).has(itemId)) return true;
  }
  return false;
};
