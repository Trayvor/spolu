import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, ID_RE, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { requireUser } from '../auth/session.js';
import { registerFileReadRule, type FileReadRule } from '../files/read-rules.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadProjects } from '../projects/policy.js';
import { eventGroupIds, projectGroupIds } from '../projects/service.js';
import { canUseBoard } from '../tasks/policy.js';
import { getTaskGroupIds } from '../tasks/task-service.js';
import { isAdmin } from '../users/policy.js';
import { anyShareable } from './chat-items.js';
import { isLinked, subjectLinksOfFile, type LinkSubject } from './links.js';
import { canReadItem } from './policy.js';
import { getItemRefs, getSharedItem } from './service.js';

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

type Subject = { kind: SubjectKind; id: string };
const keyOf = (s: Subject) => `${s.kind}:${s.id}`;

/**
 * The group of each subject the actor reads, by `kind:id` (the others are absent): the actor's
 * memberships once and one query per kind, whatever the number of subjects (2026-10-18).
 */
async function readableSubjectGroups(
  db: Db,
  actor: SessionUser,
  subjects: Subject[],
): Promise<Map<string, string>> {
  const readable = new Map<string, string>();
  if (subjects.length === 0) return readable;
  const ids = (kind: SubjectKind) => subjects.filter((s) => s.kind === kind).map((s) => s.id);
  const [groupIds, taskGroups, projectGroups, eventGroups, items] = await Promise.all([
    isAdmin(actor) ? [] : clientGroupIds(db, actor.id),
    getTaskGroupIds(db, ids('task')),
    projectGroupIds(db, ids('project')),
    eventGroupIds(db, ids('event')),
    getItemRefs(db, ids('knowledge')),
  ]);
  for (const s of subjects) {
    let groupId: string | undefined;
    switch (s.kind) {
      case 'task':
        groupId = taskGroups.get(s.id);
        if (groupId && !canUseBoard(actor, groupId, groupIds)) groupId = undefined;
        break;
      case 'project':
      case 'event':
        groupId = (s.kind === 'project' ? projectGroups : eventGroups).get(s.id);
        if (groupId && !canReadProjects(actor, groupId, groupIds)) groupId = undefined;
        break;
      case 'knowledge': {
        const ref = items.get(s.id);
        groupId = ref && canReadItem(actor, ref, groupIds) ? ref.groupId : undefined;
        break;
      }
    }
    if (groupId) readable.set(keyOf(s), groupId);
  }
  return readable;
}

/** The subject's group when the actor reads the subject, else null. */
async function readableSubjectGroup(
  db: Db,
  actor: SessionUser,
  subject: Subject,
): Promise<string | null> {
  return (await readableSubjectGroups(db, actor, [subject])).get(keyOf(subject)) ?? null;
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
 * admins-only or finance-only file. A fixed number of queries however widely the item is linked
 * (2026-10-18): the subjects by kind, then the shareable items once per subject group.
 */
export const fileOfLinkedKnowledge: FileReadRule = async (db, actor, file) => {
  const links = (await subjectLinksOfFile(db, file.id)).flatMap(({ subject, itemId }) =>
    subject.kind === 'ticket' ? [] : [{ subject: { kind: subject.kind, id: subject.id }, itemId }],
  );
  const groups = await readableSubjectGroups(
    db,
    actor,
    links.map((l) => l.subject),
  );
  const itemsByGroup = new Map<string, string[]>();
  for (const { subject, itemId } of links) {
    const groupId = groups.get(keyOf(subject));
    if (groupId) itemsByGroup.set(groupId, [...(itemsByGroup.get(groupId) ?? []), itemId]);
  }
  return anyShareable(db, itemsByGroup);
};
