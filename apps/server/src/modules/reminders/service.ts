import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { RecipientSource, ReminderSetDto, SessionUser, UpcomingReminder } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { groups } from '../groups/schema.js';
import { getGroupPeopleRoles, getMembershipGroupId } from '../groups/service.js';
import { isAdmin } from '../users/policy.js';
import { user } from '../users/schema.js';
import { getUserNames } from '../users/service.js';
import {
  AuthorRecipientError,
  InvalidRecipientError,
  InvalidReminderError,
  NoReminderSetError,
  NotReadableError,
  ReminderInPastError,
} from './errors.js';
import { buildIcsText, icsFilename } from './ics.js';
import { reminderRecipients, reminderSets, reminderTimes } from './schema.js';
import {
  getReminderSubject,
  subjectColumn,
  subjectColumnKey,
  type ReminderSubjectRef,
  type SubjectInfo,
} from './subjects.js';

export const REMINDER_LIMITS = {
  /** Unfired times per set. */
  times: 20,
  /** `added` recipients per set. */
  recipients: 50,
  /** A new or changed time is at least this far ahead. */
  minLeadMs: 60_000,
  maxYearsAhead: 5,
  /** Characters of the body in a calendar event's description. */
  icsDescription: 1000,
} as const;

const ADMIN_ROLES: ('admin' | 'superadmin')[] = ['admin', 'superadmin'];

/** The subject, if it exists and the actor may read it. */
async function readableSubject(
  db: Db,
  ref: ReminderSubjectRef,
  actor: SessionUser,
): Promise<SubjectInfo | null> {
  const actorGroupId = isAdmin(actor) ? null : await getMembershipGroupId(db, actor.id);
  const info = (await getReminderSubject(ref.kind).loadMany(db, [ref.id])).get(ref.id);
  return info && info.canRead(actor, actorGroupId) ? info : null;
}

async function findSetId(db: Db, ref: ReminderSubjectRef): Promise<string | null> {
  const [row] = await db
    .select({ id: reminderSets.id })
    .from(reminderSets)
    .where(eq(subjectColumn(ref.kind), ref.id));
  return row?.id ?? null;
}

const timeEquals = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * Saves the times and the `added` recipients of a subject, creating its set on first use. Call it
 * inside the owner's write transaction (`tx`); the caller has checked that `actor` may edit.
 *
 * Fired times are kept; an input time may repeat a fired one (same id and instant) untouched.
 * Unfired times missing from the input are deleted, changed ones updated, new ones inserted. The
 * author's row is added if missing and never removed; `subscribed` rows are kept.
 */
export async function replaceReminderSet(
  tx: Db,
  subject: ReminderSubjectRef & { groupId: string; adminsOnly: boolean; authorId: string },
  input: { times: { id?: string; at: string }[]; recipientIds: string[] },
  actor: SessionUser,
  now = new Date(),
): Promise<void> {
  // 1. Upsert the set.
  const key = subjectColumnKey(subject.kind);
  const [set] = await tx
    .insert(reminderSets)
    .values({
      id: randomUUID(),
      groupId: subject.groupId,
      createdBy: subject.authorId,
      [key]: subject.id,
    })
    .onConflictDoUpdate({ target: subjectColumn(subject.kind), set: { groupId: subject.groupId } })
    .returning({ id: reminderSets.id });
  const setId = set!.id;

  // 2. Read the existing times and work out the diff.
  const existing = new Map(
    (
      await tx
        .select({ id: reminderTimes.id, at: reminderTimes.at, firedAt: reminderTimes.firedAt })
        .from(reminderTimes)
        .where(eq(reminderTimes.setId, setId))
    ).map((row) => [row.id, row]),
  );
  const earliest = now.getTime() + REMINDER_LIMITS.minLeadMs;
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + REMINDER_LIMITS.maxYearsAhead);
  const checkWindow = (at: Date) => {
    if (at.getTime() < earliest) throw new ReminderInPastError();
    if (at.getTime() > latest.getTime()) throw new InvalidReminderError('Reminder too far ahead');
  };

  const kept = new Set<string>();
  const changed: { id: string; at: Date }[] = [];
  const inserted: { id: string; at: Date }[] = [];
  let unfired = 0;
  for (const time of input.times) {
    const at = new Date(time.at);
    if (Number.isNaN(at.getTime())) throw new InvalidReminderError();
    if (time.id === undefined) {
      checkWindow(at);
      inserted.push({ id: randomUUID(), at });
      unfired++;
      continue;
    }
    const row = existing.get(time.id);
    if (!row || kept.has(time.id)) throw new InvalidReminderError();
    kept.add(time.id);
    if (row.firedAt) {
      if (!timeEquals(row.at, at)) throw new InvalidReminderError('A sent time cannot change');
      continue;
    }
    unfired++;
    if (!timeEquals(row.at, at)) {
      checkWindow(at);
      changed.push({ id: time.id, at });
    }
  }
  if (unfired > REMINDER_LIMITS.times) throw new InvalidReminderError('Too many times');
  const deleted = [...existing.values()]
    .filter((row) => !row.firedAt && !kept.has(row.id))
    .map((row) => row.id);

  // The recipients are validated before anything is written.
  const added = [...new Set(input.recipientIds)].filter((id) => id !== subject.authorId);
  await validateRecipients(tx, subject, added);

  // 3. Write the time diff in one statement. A time that fired meanwhile is left alone.
  const parts: SQL[] = [];
  if (deleted.length > 0) {
    parts.push(sql`d as (delete from reminder_times
      where set_id = ${setId} and fired_at is null and id in (${sql.join(deleted, sql`, `)}))`);
  }
  if (changed.length > 0) {
    const values = changed.map((c) => sql`(${c.id}, ${c.at.toISOString()}::timestamptz)`);
    parts.push(sql`u as (update reminder_times t set at = v.at, updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(id, at)
      where t.id = v.id and t.set_id = ${setId} and t.fired_at is null)`);
  }
  if (inserted.length > 0) {
    const values = inserted.map(
      (c) => sql`(${c.id}, ${setId}, ${c.at.toISOString()}::timestamptz)`,
    );
    parts.push(sql`i as (insert into reminder_times (id, set_id, at)
      values ${sql.join(values, sql`, `)})`);
  }
  if (parts.length > 0) await tx.execute(sql`with ${sql.join(parts, sql`, `)} select 1`);

  // 4. Replace the `added` recipients and make sure the author is in.
  const rows = [
    sql`(${setId}, ${subject.authorId}, 'author', ${subject.authorId})`,
    ...added.map((id) => sql`(${setId}, ${id}, 'added', ${actor.id})`),
  ];
  const keepAdded =
    added.length > 0 ? sql`and user_id not in (${sql.join(added, sql`, `)})` : sql``;
  await tx.execute(sql`with d as (delete from reminder_recipients
      where set_id = ${setId} and source = 'added' ${keepAdded})
    insert into reminder_recipients (set_id, user_id, source, added_by)
    values ${sql.join(rows, sql`, `)}
    on conflict (set_id, user_id) do nothing`);
}

/** People of the group, admins for an admins-only subject, at most 50. */
async function validateRecipients(
  tx: Db,
  subject: { groupId: string; adminsOnly: boolean },
  ids: string[],
): Promise<void> {
  if (ids.length > REMINDER_LIMITS.recipients) throw new InvalidRecipientError();
  if (ids.length === 0) return;
  const people = await getGroupPeopleRoles(tx, subject.groupId, ids);
  for (const id of ids) {
    const person = people.get(id);
    if (!person || (subject.adminsOnly && !person.isAdmin)) throw new InvalidRecipientError();
  }
}

/** After a subject became admins-only: drops every non-admin recipient except the author. */
export async function pruneRecipientsForAdminsOnly(
  tx: Db,
  subject: ReminderSubjectRef,
): Promise<void> {
  await tx.delete(reminderRecipients).where(
    and(
      ne(reminderRecipients.source, 'author'),
      inArray(
        reminderRecipients.setId,
        tx
          .select({ id: reminderSets.id })
          .from(reminderSets)
          .where(eq(subjectColumn(subject.kind), subject.id)),
      ),
      inArray(
        reminderRecipients.userId,
        tx.select({ id: user.id }).from(user).where(notInArray(user.role, ADMIN_ROLES)),
      ),
    ),
  );
}

const SOURCE_ORDER: Record<RecipientSource, number> = { author: 0, added: 1, subscribed: 1 };

/**
 * The subject's times (upcoming first by `at`, then fired) and recipients (author first, then by
 * name). Null when there is no set or the actor cannot read the subject.
 */
export async function getReminderSet(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
): Promise<ReminderSetDto | null> {
  const info = await readableSubject(db, subject, actor);
  if (!info) return null;
  const setId = await findSetId(db, subject);
  if (!setId) return null;
  const [times, recipients] = await Promise.all([
    db
      .select({ id: reminderTimes.id, at: reminderTimes.at, firedAt: reminderTimes.firedAt })
      .from(reminderTimes)
      .where(eq(reminderTimes.setId, setId))
      .orderBy(sql`${reminderTimes.firedAt} is not null`, asc(reminderTimes.at)),
    db
      .select({ userId: reminderRecipients.userId, source: reminderRecipients.source })
      .from(reminderRecipients)
      .where(eq(reminderRecipients.setId, setId)),
  ]);
  const names = await getUserNames(
    db,
    recipients.map((r) => r.userId),
  );
  const people = recipients
    .map((r) => ({
      user: { id: r.userId, name: names.get(r.userId) ?? '' },
      source: r.source as RecipientSource,
    }))
    .sort(
      (a, b) =>
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        a.user.name.localeCompare(b.user.name) ||
        a.user.id.localeCompare(b.user.id),
    );
  return {
    times: times.map((t) => ({
      id: t.id,
      at: t.at.toISOString(),
      firedAt: t.firedAt?.toISOString() ?? null,
    })),
    recipients: people,
    subscribed: recipients.some((r) => r.userId === actor.id),
    canEdit: info.canEdit(actor),
  };
}

/**
 * The set of a subject the actor can read: `NotReadableError` when the subject is missing or
 * unreadable, `NoReminderSetError` when it has no set.
 */
async function readableSet(db: Db, subject: ReminderSubjectRef, actor: SessionUser) {
  const info = await readableSubject(db, subject, actor);
  if (!info) throw new NotReadableError();
  const setId = await findSetId(db, subject);
  if (!setId) throw new NoReminderSetError();
  return { info, setId };
}

/** Adds the actor as `subscribed`; an existing row (author, added) stays as it is. */
export async function subscribe(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
): Promise<void> {
  const { setId } = await readableSet(db, subject, actor);
  await db
    .insert(reminderRecipients)
    .values({ setId, userId: actor.id, source: 'subscribed', addedBy: actor.id })
    .onConflictDoNothing();
}

/** Removes the actor's row whatever its source, so an added person can opt out; not the author. */
export async function unsubscribe(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
): Promise<void> {
  const { info, setId } = await readableSet(db, subject, actor);
  if (info.authorId === actor.id) throw new AuthorRecipientError();
  const removed = await db
    .delete(reminderRecipients)
    .where(
      and(
        eq(reminderRecipients.setId, setId),
        eq(reminderRecipients.userId, actor.id),
        ne(reminderRecipients.source, 'author'),
      ),
    )
    .returning({ source: reminderRecipients.source });
  if (removed.length === 0) {
    const [author] = await db
      .select({ userId: reminderRecipients.userId })
      .from(reminderRecipients)
      .where(
        and(
          eq(reminderRecipients.setId, setId),
          eq(reminderRecipients.userId, actor.id),
          eq(reminderRecipients.source, 'author'),
        ),
      );
    if (author) throw new AuthorRecipientError();
  }
}

/**
 * The `.ics` file of the subject's upcoming times. Null when the actor cannot read it or no time
 * is ahead. `publicUrl` is the app's origin; the events link to the subject.
 */
export async function buildIcs(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
  publicUrl: string,
  now = new Date(),
): Promise<{ filename: string; text: string } | null> {
  const info = await readableSubject(db, subject, actor);
  if (!info) return null;
  const times = await db
    .select({ id: reminderTimes.id, at: reminderTimes.at, updatedAt: reminderTimes.updatedAt })
    .from(reminderTimes)
    .innerJoin(reminderSets, eq(reminderSets.id, reminderTimes.setId))
    .where(
      and(
        eq(subjectColumn(subject.kind), subject.id),
        isNull(reminderTimes.firedAt),
        gt(reminderTimes.at, now),
      ),
    )
    .orderBy(asc(reminderTimes.at));
  if (times.length === 0) return null;
  const url = publicUrl.replace(/\/+$/, '') + info.link;
  const body = [...info.body.trim()].slice(0, REMINDER_LIMITS.icsDescription).join('');
  const description = body ? `${body}\n\n${url}` : url;
  return {
    filename: icsFilename(info.title),
    text: buildIcsText({
      now,
      events: times.map((t) => ({
        uid: `reminder-${t.id}@spolu`,
        start: t.at,
        title: info.title,
        description,
        url,
        updatedAt: t.updatedAt,
      })),
    }),
  };
}

/**
 * The actor's next unfired reminder times (`>= from`, default now) across groups, earliest first:
 * one query, then one `loadMany` per kind; subjects the actor can no longer read are dropped, so
 * the list can be shorter than `limit`.
 */
export async function listUpcomingForUser(
  db: Db,
  actor: SessionUser,
  opts: { from?: Date; limit: number },
): Promise<UpcomingReminder[]> {
  // A client only ever reads their current group: old sets from a group they left never fill
  // the limit.
  const actorGroupId = isAdmin(actor) ? null : await getMembershipGroupId(db, actor.id);
  if (!isAdmin(actor) && actorGroupId === null) return [];
  const rows = await db
    .select({
      id: reminderTimes.id,
      at: reminderTimes.at,
      groupId: reminderSets.groupId,
      groupName: groups.name,
      knowledgeItemId: reminderSets.knowledgeItemId,
    })
    .from(reminderTimes)
    .innerJoin(reminderSets, eq(reminderSets.id, reminderTimes.setId))
    .innerJoin(
      reminderRecipients,
      and(eq(reminderRecipients.setId, reminderSets.id), eq(reminderRecipients.userId, actor.id)),
    )
    .innerJoin(groups, eq(groups.id, reminderSets.groupId))
    .where(
      and(
        isNull(reminderTimes.firedAt),
        gte(reminderTimes.at, opts.from ?? new Date()),
        actorGroupId === null ? undefined : eq(reminderSets.groupId, actorGroupId),
      ),
    )
    .orderBy(asc(reminderTimes.at), asc(reminderTimes.id))
    .limit(opts.limit);
  if (rows.length === 0) return [];

  // Phase 19 adds the task column and kind here.
  const ids = [...new Set(rows.flatMap((r) => (r.knowledgeItemId ? [r.knowledgeItemId] : [])))];
  const subjects = await getReminderSubject('knowledge').loadMany(db, ids);
  return rows.flatMap((row) => {
    const info = row.knowledgeItemId ? subjects.get(row.knowledgeItemId) : undefined;
    if (!info || !info.canRead(actor, actorGroupId)) return [];
    return [
      {
        id: row.id,
        at: row.at.toISOString(),
        title: info.title,
        groupId: row.groupId,
        groupName: row.groupName,
        target: { kind: 'knowledge' as const, itemId: row.knowledgeItemId! },
      },
    ];
  });
}
