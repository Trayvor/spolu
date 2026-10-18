import { extractMentions, isPickable, type SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listGroupPeople } from '../groups/service.js';
import { recordNotifications } from './service.js';

/**
 * What a description belongs to (F16): a task, a ticket, a project or a knowledge item. The
 * payload of `description.mention` carries it, so the push and the digest open it.
 */
export type DescriptionSubject =
  | { kind: 'task'; id: string; title: string }
  | { kind: 'ticket'; id: string; number: number; subject: string }
  | { kind: 'project'; id: string; title: string }
  | { kind: 'knowledge'; id: string; title: string; adminsOnly: boolean };

/** The people named in `after` and not in `before` (mention tokens; code and `<@all>` ignored). */
export function addedMentions(before: string | null | undefined, after: string): string[] {
  if (!after.includes('<@')) return [];
  const old = new Set(before ? extractMentions(before).userIds : []);
  return extractMentions(after).userIds.filter((id) => !old.has(id));
}

function payloadOf(subject: DescriptionSubject, groupId: string, actorName: string) {
  const base = { subjectKind: subject.kind, subjectId: subject.id, groupId, actorName };
  switch (subject.kind) {
    case 'task':
      return { ...base, taskId: subject.id, title: subject.title };
    case 'ticket':
      return { ...base, ticketId: subject.id, number: subject.number, subject: subject.subject };
    case 'project':
      return { ...base, title: subject.title };
    case 'knowledge':
      return { ...base, itemId: subject.id, title: subject.title };
  }
}

/**
 * F16: a saved description that names people (`<@id>`, picked with `@` in the description
 * field) records `description.mention` for each person newly named, like a chat mention: only
 * the group's clients and managers (`isPickable`, the picker's list), never the actor, only
 * admins in an admins-only subject, and only those `readers` keeps (a ticket drops who cannot
 * read it). `@all` notifies nobody in a description. Call it in the write's transaction and
 * `requestDelivery` the returned ids after the commit.
 */
export async function recordDescriptionMentions(
  tx: Db,
  input: {
    actor: Pick<SessionUser, 'id' | 'name'>;
    groupId: string;
    subject: DescriptionSubject;
    before: string | null | undefined;
    after: string;
    readers?: (ids: string[]) => Promise<string[]>;
  },
): Promise<string[]> {
  const named = addedMentions(input.before, input.after).filter((id) => id !== input.actor.id);
  if (named.length === 0) return [];
  const adminsOnly = input.subject.kind === 'knowledge' && input.subject.adminsOnly;
  const people = await listGroupPeople(tx, input.groupId);
  const allowed = new Set(
    people.filter((p) => isPickable(p) && (!adminsOnly || p.isAdmin)).map((p) => p.id),
  );
  let recipients = named.filter((id) => allowed.has(id));
  if (input.readers && recipients.length > 0) recipients = await input.readers(recipients);
  if (recipients.length === 0) return [];
  return recordNotifications(tx, {
    kind: 'description.mention',
    groupId: input.groupId,
    recipients,
    payload: payloadOf(input.subject, input.groupId, input.actor.name),
  });
}
