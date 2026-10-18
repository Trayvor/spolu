import { sql, type SQL } from 'drizzle-orm';
import { extractMentions, isPickable, type SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listGroupPeople } from '../groups/service.js';
import { descriptionMentionNotifiesSql } from './follows.js';
import { recordManyNotifications } from './service.js';

/**
 * The Mentions card's description mentions (2026-10-18), as an SQL fragment for the home's one
 * statement: the user's `description.mention` events created after `since`, that would notify
 * them under their current settings (`descriptionMentionNotifiesSql`), and that are newer than
 * their last open of the subject (`task_seen`, `ticket_seen`, `project_seen`, `knowledge_seen`;
 * one primary key lookup each). Columns: `id`, `group_id`, `created_at`, `author_name`,
 * `subject_kind`, `subject_id`. It may name a deleted subject: the caller joins its own tables
 * for what still exists, and orders and limits.
 *
 * It reads `notification_events_description_mention_idx` (the user's description mentions,
 * newest last). Events older than 30 days are purged, so an older mention is gone anyway.
 */
export function unreadDescriptionMentionsSql(userId: string, since: SQL): SQL {
  const subjectKind = sql`(e.payload ->> 'subjectKind')`;
  const subjectId = sql`(e.payload ->> 'subjectId')`;
  return sql`
    select e.id, e.group_id, e.created_at, (e.payload ->> 'actorName') as author_name,
      ${subjectKind} as subject_kind, ${subjectId} as subject_id
    from notification_events e
    where e.user_id = ${userId}
      and e.kind = 'description.mention'
      and e.created_at > ${since}
      and ${descriptionMentionNotifiesSql(userId, { groupId: sql`e.group_id`, subjectKind })}
      and e.created_at > coalesce(case ${subjectKind}
        when 'task' then (select s.seen_at from task_seen s
          where s.user_id = ${userId} and s.task_id = ${subjectId})
        when 'ticket' then (select s.seen_at from ticket_seen s
          where s.user_id = ${userId} and s.ticket_id = ${subjectId})
        when 'project' then (select s.seen_at from project_seen s
          where s.user_id = ${userId} and s.project_id = ${subjectId})
        when 'knowledge' then (select s.seen_at from knowledge_seen s
          where s.user_id = ${userId} and s.item_id = ${subjectId})
      end, '-infinity'::timestamptz)
  `;
}

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
 * read it). `@all` notifies nobody in a description. A person is notified at most once until they
 * open the subject (`dedupeKey` with their last open from `task_seen`, `ticket_seen`,
 * `project_seen` or `knowledge_seen`; review V10, 2026-10-19): naming them again after removing
 * them sends nothing, a mention after they opened it notifies again. Call it in the write's transaction and
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
  // Once until they open the subject: the key carries their last open of it, so removing a name
  // and adding it back notifies nobody again, and a mention after an open does (events are
  // purged after 30 days). One primary key lookup per recipient, in one statement.
  const seen = await lastSeen(tx, input.subject.kind, input.subject.id, recipients);
  const payload = payloadOf(input.subject, input.groupId, input.actor.name);
  return recordManyNotifications(
    tx,
    recipients.map((id) => ({
      kind: 'description.mention' as const,
      groupId: input.groupId,
      recipients: [id],
      payload,
      dedupeKey: `description:${input.subject.kind}:${input.subject.id}:${seen.get(id) ?? 'never'}`,
    })),
  );
}

const SEEN_TABLES = {
  task: { table: 'task_seen', column: 'task_id' },
  ticket: { table: 'ticket_seen', column: 'ticket_id' },
  project: { table: 'project_seen', column: 'project_id' },
  knowledge: { table: 'knowledge_seen', column: 'item_id' },
} as const;

/** When each of `userIds` last opened the subject (`seen_at` as text), for those who did. */
async function lastSeen(
  tx: Db,
  kind: DescriptionSubject['kind'],
  subjectId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const { table, column } = SEEN_TABLES[kind];
  const rows = await tx.execute<{ user_id: string; seen_at: string }>(sql`
    select s.user_id, s.seen_at::text as seen_at from ${sql.identifier(table)} s
    where s.${sql.identifier(column)} = ${subjectId}
      and s.user_id in (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `,
      )})
  `);
  return new Map([...rows].map((r) => [r.user_id, r.seen_at]));
}
