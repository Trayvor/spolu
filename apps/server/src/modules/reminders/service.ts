import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  isPickable,
  type RecipientSource,
  type ReminderSetDto,
  type SessionUser,
  type ReminderSubjectKind,
  type UpcomingReminder,
  type UserLanguage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { groups } from '../groups/schema.js';
import { getGroupPeopleRoles } from '../groups/service.js';
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
import { texts } from '../notifications/texts.js';
import { buildIcsText, icsFilename, type IcsEvent } from './ics.js';
import { reminderRecipients, reminderSets, reminderTimes } from './schema.js';
import {
  getReminderSubject,
  subjectColumn,
  subjectColumnKey,
  type ReminderSubjectRef,
  type SubjectInfo,
} from './subjects.js';
import { clientGroupIds } from '../groups/memberships.js';

const REMINDER_LIMITS = {
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
  const actorGroupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  const info = (await getReminderSubject(ref.kind).loadMany(db, [ref.id])).get(ref.id);
  return info && info.canRead(actor, actorGroupIds) ? info : null;
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
 * `subject.authorId` becomes the set's author when this call creates the set; the set's stored
 * author (`created_by`) then has its row added if missing and never removed, so two first saves
 * at once still leave one author. `subscribed` rows are kept.
 *
 * Fired times are kept; an input time may repeat a fired one (same id and instant) untouched.
 * Changed times are updated, new ones inserted. Which unfired times missing from the input are
 * deleted depends on `baseTimeIds`:
 * - undefined (knowledge items, saved with their form): every one of them;
 * - set (stand-alone edits, tasks): only those in `baseTimeIds`, the times the sender had loaded,
 *   so a time someone else added meanwhile survives. An input id in `baseTimeIds` that no longer
 *   exists (someone else removed it) is dropped silently.
 *
 * `recipientIds` undefined leaves the `added` rows as they are. With an adapter that has
 * `addEditorsAsRecipients`, an actor who adds a time and has no row becomes `added` by
 * themselves. A subject with no set and no input time writes nothing.
 */
export async function replaceReminderSet(
  tx: Db,
  subject: ReminderSubjectRef & { groupId: string | null; adminsOnly: boolean; authorId: string },
  input: { times: { id?: string; at: string }[]; recipientIds?: string[]; baseTimeIds?: string[] },
  actor: SessionUser,
  now = new Date(),
): Promise<void> {
  if (input.times.length === 0 && !(await findSetId(tx, subject))) return;

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
    .returning({ id: reminderSets.id, createdBy: reminderSets.createdBy });
  const setId = set!.id;
  const authorId = set!.createdBy;

  // 2. Read the existing times and the recipients, and work out the diff.
  const [timeRows, recipientRows] = await Promise.all([
    tx
      .select({ id: reminderTimes.id, at: reminderTimes.at, firedAt: reminderTimes.firedAt })
      .from(reminderTimes)
      .where(eq(reminderTimes.setId, setId)),
    tx
      .select({ userId: reminderRecipients.userId })
      .from(reminderRecipients)
      .where(eq(reminderRecipients.setId, setId)),
  ]);
  const existing = new Map(timeRows.map((row) => [row.id, row]));
  const base = input.baseTimeIds === undefined ? null : new Set(input.baseTimeIds);
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
  for (const time of input.times) {
    const at = new Date(time.at);
    if (Number.isNaN(at.getTime())) throw new InvalidReminderError();
    if (time.id === undefined) {
      checkWindow(at);
      inserted.push({ id: randomUUID(), at });
      continue;
    }
    if (kept.has(time.id)) throw new InvalidReminderError();
    kept.add(time.id);
    const row = existing.get(time.id);
    if (!row) {
      // Removed by someone else meanwhile: dropped. An id never loaded is invalid.
      if (base?.has(time.id)) continue;
      throw new InvalidReminderError();
    }
    if (row.firedAt) {
      if (!timeEquals(row.at, at)) throw new InvalidReminderError('A sent time cannot change');
      continue;
    }
    if (!timeEquals(row.at, at)) {
      checkWindow(at);
      changed.push({ id: time.id, at });
    }
  }
  const deleted = timeRows
    .filter((row) => !row.firedAt && !kept.has(row.id) && (base === null || base.has(row.id)))
    .map((row) => row.id);
  if (base !== null) {
    // A stand-alone edit that adds an instant someone else added meanwhile adds nothing: the
    // recipients would get two pushes at once.
    const staying = new Set(
      timeRows
        .filter((row) => !row.firedAt && !deleted.includes(row.id))
        .map((row) => row.at.getTime()),
    );
    for (let i = inserted.length - 1; i >= 0; i--) {
      if (staying.has(inserted[i]!.at.getTime())) inserted.splice(i, 1);
    }
  }
  // Every unfired time after the merge counts, others' times included.
  const unfired = timeRows.filter((row) => !row.firedAt).length - deleted.length + inserted.length;
  if (unfired > REMINDER_LIMITS.times) throw new InvalidReminderError('Too many times');
  if (base !== null && unfired === 0) {
    // A stand-alone set with nothing left to send goes, with its recipients: whoever adds the
    // next time starts a new set as its author, and nobody stays bound to old reminders.
    await tx.delete(reminderSets).where(eq(reminderSets.id, setId));
    return;
  }

  // The recipients are validated before anything is written.
  const current = new Set(recipientRows.map((r) => r.userId));
  const added =
    input.recipientIds === undefined
      ? null
      : await validateRecipients(
          tx,
          subject,
          [...new Set(input.recipientIds)].filter((id) => id !== authorId),
          current,
        );
  const editorJoins =
    inserted.length > 0 &&
    getReminderSubject(subject.kind).addEditorsAsRecipients === true &&
    actor.id !== authorId &&
    !current.has(actor.id);

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

  // 4. Replace the `added` recipients (when given), make sure the author is in, and add the
  // editor who joined. The editor is on the kept list, so the replacement never removes them.
  const keep = [...(added ?? []), ...(editorJoins ? [actor.id] : [])];
  const rows = [
    sql`(${setId}, ${authorId}, 'author', ${authorId})`,
    ...keep.map((id) => sql`(${setId}, ${id}, 'added', ${actor.id})`),
  ];
  const insertRows = sql`insert into reminder_recipients (set_id, user_id, source, added_by)
    values ${sql.join(rows, sql`, `)}
    on conflict (set_id, user_id) do nothing`;
  if (added === null) {
    await tx.execute(insertRows);
  } else {
    const keepAdded =
      keep.length > 0 ? sql`and user_id not in (${sql.join(keep, sql`, `)})` : sql``;
    await tx.execute(sql`with d as (delete from reminder_recipients
        where set_id = ${setId} and source = 'added' ${keepAdded})
      ${insertRows}`);
  }
}

/**
 * The unfired times of each subject of one kind (0 for a subject without any): one grouped query
 * on the subject's unique index and `reminder_times_set_at_idx`.
 */
export async function countUpcomingTimes(
  db: Db,
  kind: ReminderSubjectKind,
  ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return counts;
  const column = subjectColumn(kind);
  const rows = await db
    .select({ id: column, count: sql<number>`count(*)::int` })
    .from(reminderSets)
    .innerJoin(reminderTimes, eq(reminderTimes.setId, reminderSets.id))
    .where(and(inArray(column, ids), isNull(reminderTimes.firedAt)))
    .groupBy(column);
  for (const row of rows) counts.set(row.id as string, row.count);
  return counts;
}

/** The author of the subject's reminder set (`created_by`), or null when it has no set. */
export async function getSetAuthorId(db: Db, subject: ReminderSubjectRef): Promise<string | null> {
  const [row] = await db
    .select({ createdBy: reminderSets.createdBy })
    .from(reminderSets)
    .where(eq(subjectColumn(subject.kind), subject.id));
  return row?.createdBy ?? null;
}

/**
 * True when the user is a recipient of the reminder of the knowledge item `knowledgeItemId` (an
 * SQL expression, e.g. `k.id`), for other modules' single statements (the Meetings card, which
 * shows a meeting whose reminder the admin gets). Reads `reminder_sets_knowledge_item_unique` and
 * the recipients' primary key.
 */
export function remindsUserSql(userId: string, knowledgeItemId: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from reminder_sets rs
    join reminder_recipients rr on rr.set_id = rs.id and rr.user_id = ${userId}
    where rs.knowledge_item_id = ${knowledgeItemId}
  )`;
}

/** What `GET …/reminders` answers for a readable subject that has no set yet. */
export function emptyReminderSet(canEdit: boolean): ReminderSetDto {
  return { times: [], recipients: [], subscribed: false, canEdit };
}

/**
 * The recipients to keep: people of the group, admins for an admins-only subject, at most 50. A
 * recipient new to the set must also be pickable (a client or one of the group's managers, Phase
 * 18), as for assignees, else `InvalidRecipientError`. Someone already on the set (`current`)
 * who has since stopped managing the group stays; one who is no longer a person of the group (a
 * removed client, a disabled admin) is dropped quietly, so the form, which sends back the
 * recipients it loaded, can still save.
 */
async function validateRecipients(
  tx: Db,
  subject: { kind: ReminderSubjectKind; groupId: string | null; adminsOnly: boolean },
  ids: string[],
  current: Set<string>,
): Promise<string[]> {
  if (ids.length > REMINDER_LIMITS.recipients) throw new InvalidRecipientError();
  if (ids.length === 0) return [];
  const filter = getReminderSubject(subject.kind).filterRecipients;
  if (filter) {
    // The adapter's own rule (finance admins only) replaces the group-people rule.
    const allowed = await filter(tx, ids);
    if (ids.some((id) => !allowed.has(id) && !current.has(id))) throw new InvalidRecipientError();
    return ids.filter((id) => allowed.has(id));
  }
  // Only a finance item (which has its own rule above) may lack a group.
  if (subject.groupId === null) throw new InvalidRecipientError();
  const people = await getGroupPeopleRoles(tx, subject.groupId, ids);
  const kept: string[] = [];
  for (const id of ids) {
    const person = people.get(id);
    const allowed = !!person && (!subject.adminsOnly || person.isAdmin);
    if (current.has(id)) {
      if (allowed) kept.push(id);
      continue;
    }
    if (!allowed || !isPickable({ id, name: '', ...person })) throw new InvalidRecipientError();
    kept.push(id);
  }
  return kept;
}

/** After a subject became admins-only: drops every non-admin recipient except the author. */
export async function pruneRecipientsForAdminsOnly(
  tx: Db,
  subject: ReminderSubjectRef,
): Promise<void> {
  await pruneRecipientsForAdminsOnlyMany(tx, subject.kind, [subject.id]);
}

/** `pruneRecipientsForAdminsOnly` for many subjects of one kind, in one statement. */
export async function pruneRecipientsForAdminsOnlyMany(
  tx: Db,
  kind: ReminderSubjectRef['kind'],
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(reminderRecipients).where(
    and(
      ne(reminderRecipients.source, 'author'),
      inArray(
        reminderRecipients.setId,
        tx
          .select({ id: reminderSets.id })
          .from(reminderSets)
          .where(inArray(subjectColumn(kind), ids)),
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
  return info ? loadSet(db, subject, actor, info) : null;
}

/**
 * As `getReminderSet`, but a readable subject without a set gives the empty set (`GET
 * …/reminders`); null only when the subject is missing or unreadable.
 */
export async function getReminderSetOrEmpty(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
): Promise<ReminderSetDto | null> {
  const info = await readableSubject(db, subject, actor);
  if (!info) return null;
  return (await loadSet(db, subject, actor, info)) ?? emptyReminderSet(info.canEdit(actor));
}

/**
 * A stand-alone edit (`PUT …/reminders`, subjects with `standaloneEdit`): checks `canRead` and
 * `canEdit` (`NotReadableError` otherwise) and saves in one transaction, the actor becoming the
 * author when this creates the set. The caller notifies after it returns (`notifyTimesChanged`).
 */
export async function saveReminderSet(
  db: Db,
  subject: ReminderSubjectRef,
  input: { times: { id?: string; at: string }[]; recipientIds?: string[]; baseTimeIds: string[] },
  actor: SessionUser,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const info = await readableSubject(tx, subject, actor);
      if (!info || !info.canEdit(actor)) throw new NotReadableError();
      await replaceReminderSet(
        tx,
        { ...subject, groupId: info.groupId, adminsOnly: info.adminsOnly, authorId: actor.id },
        input,
        actor,
      );
    });
  } catch (error) {
    // The subject was deleted between the read and the set's insert: a missing subject (404).
    if (isForeignKeyViolation(error)) throw new NotReadableError();
    throw error;
  }
}

/** A PostgreSQL foreign key violation (23503), as drizzle wraps it. */
function isForeignKeyViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(error) === '23503' || code((error as { cause?: unknown } | null)?.cause) === '23503';
}

async function loadSet(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
  info: SubjectInfo,
): Promise<ReminderSetDto | null> {
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
  const filter = getReminderSubject(subject.kind).filterRecipients;
  if (filter && !(await filter(db, [actor.id])).has(actor.id)) throw new NotReadableError();
  await db
    .insert(reminderRecipients)
    .values({ setId, userId: actor.id, source: 'subscribed', addedBy: actor.id })
    .onConflictDoNothing();
}

/**
 * Removes the actor's row whatever its source, so an added person can opt out; not the set's
 * author (`AuthorRecipientError`).
 */
export async function unsubscribe(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
): Promise<void> {
  const { setId } = await readableSet(db, subject, actor);
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
 * The `.ics` file of the subject: its deadline as an all-day event (subjects with `dueDate`,
 * tasks), then one timed event per upcoming time. Null when the actor cannot read it, or it has
 * no deadline and no time ahead. `publicUrl` is the app's origin; the events link to the subject.
 * `lang` is the requester's language (the deadline event's title).
 */
export async function buildIcs(
  db: Db,
  subject: ReminderSubjectRef,
  actor: SessionUser,
  publicUrl: string,
  now = new Date(),
  lang: UserLanguage = 'en',
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
  if (times.length === 0 && !info.dueDate) return null;
  const url = publicUrl.replace(/\/+$/, '') + info.link;
  const body = [...info.body.trim()].slice(0, REMINDER_LIMITS.icsDescription).join('');
  const description = body ? `${body}\n\n${url}` : url;
  const events: IcsEvent[] = times.map((t) => ({
    uid: `reminder-${t.id}@spolu`,
    start: t.at,
    title: info.title,
    description,
    url,
    updatedAt: t.updatedAt,
  }));
  if (info.dueDate) {
    // A stable UID, and `now` as the change time, so a re-import after a deadline change
    // updates the event instead of adding one.
    events.unshift({
      uid: `${subject.kind}-${subject.id}-deadline@spolu`,
      date: info.dueDate,
      title: texts(lang).deadlineEvent(info.title),
      description,
      url,
      updatedAt: now,
    });
  }
  return { filename: icsFilename(info.title), text: buildIcsText({ now, events }) };
}

/** Counts stop here (the dashboard shows "99+"). */
const UPCOMING_COUNT_CAP = 100;

/**
 * How many unfired reminder times the actor has in `[from, to)` across groups (a client: only in
 * their current group), at most `UPCOMING_COUNT_CAP`. One query (a client: two), for the
 * dashboard's count.
 * Unlike `listUpcomingForUser` it does not check each subject's readability: the dashboard is for
 * admins, who read every subject.
 */
export async function countUpcomingForUser(
  db: Db,
  actor: SessionUser,
  range: { from: Date; to: Date },
): Promise<number> {
  const actorGroupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  if (!isAdmin(actor) && actorGroupIds.length === 0) return 0;
  const onlyGroup = isAdmin(actor)
    ? sql``
    : sql`and s.group_id in (${sql.join(
        actorGroupIds.map((id) => sql`${id}`),
        sql`, `,
      )})`;
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from (
      select 1
      from reminder_recipients r
      join reminder_sets s on s.id = r.set_id
      join reminder_times t on t.set_id = s.id
      where r.user_id = ${actor.id}
        and t.fired_at is null
        and t.at >= ${range.from.toISOString()}::timestamptz
        and t.at < ${range.to.toISOString()}::timestamptz
        ${onlyGroup}
      limit ${UPCOMING_COUNT_CAP}
    ) capped
  `);
  return [...rows][0]?.n ?? 0;
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
  // A client only reads their current client groups: old sets from a group they left never fill
  // the limit.
  const actorGroupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  if (!isAdmin(actor) && actorGroupIds.length === 0) return [];
  const rows = await db
    .select({
      id: reminderTimes.id,
      at: reminderTimes.at,
      groupId: reminderSets.groupId,
      groupName: groups.name,
      knowledgeItemId: reminderSets.knowledgeItemId,
      taskId: reminderSets.taskId,
      financeItemId: reminderSets.financeItemId,
      eventId: reminderSets.eventId,
    })
    .from(reminderTimes)
    .innerJoin(reminderSets, eq(reminderSets.id, reminderTimes.setId))
    .innerJoin(
      reminderRecipients,
      and(eq(reminderRecipients.setId, reminderSets.id), eq(reminderRecipients.userId, actor.id)),
    )
    .leftJoin(groups, eq(groups.id, reminderSets.groupId))
    .where(
      and(
        isNull(reminderTimes.firedAt),
        gte(reminderTimes.at, opts.from ?? new Date()),
        isAdmin(actor) ? undefined : inArray(reminderSets.groupId, actorGroupIds),
      ),
    )
    .orderBy(asc(reminderTimes.at), asc(reminderTimes.id))
    .limit(opts.limit);
  if (rows.length === 0) return [];

  // One `loadMany` per kind that has rows.
  const load = (kind: ReminderSubjectKind, pick: (row: (typeof rows)[number]) => string | null) => {
    const ids = [...new Set(rows.flatMap((r) => pick(r) ?? []))];
    return ids.length > 0
      ? getReminderSubject(kind).loadMany(db, ids)
      : Promise.resolve(new Map<string, SubjectInfo>());
  };
  const [items, taskInfos, financeInfos, eventInfos] = await Promise.all([
    load('knowledge', (r) => r.knowledgeItemId),
    load('task', (r) => r.taskId),
    load('finance', (r) => r.financeItemId),
    load('event', (r) => r.eventId),
  ]);
  return rows.flatMap((row) => {
    const info = row.knowledgeItemId
      ? items.get(row.knowledgeItemId)
      : row.taskId
        ? taskInfos.get(row.taskId)
        : row.financeItemId
          ? financeInfos.get(row.financeItemId)
          : row.eventId
            ? eventInfos.get(row.eventId)
            : undefined;
    // A finance item reads only for a finance admin (`canSeeFinance`): never listed to others.
    if (!info || !info.canRead(actor, actorGroupIds)) return [];
    const target: UpcomingReminder['target'] = row.knowledgeItemId
      ? { kind: 'knowledge', itemId: row.knowledgeItemId }
      : row.financeItemId
        ? { kind: 'finance', itemId: row.financeItemId }
        : row.eventId
          ? { kind: 'event', eventId: row.eventId }
          : { kind: 'task', taskId: row.taskId! };
    return [
      {
        id: row.id,
        at: row.at.toISOString(),
        title: info.title,
        groupId: row.groupId,
        // A finance item of the organisation (Phase 32 E) has no client.
        groupName: row.groupName ?? '',
        target,
      },
    ];
  });
}
