import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { ReminderDuePayload, ReminderSubjectKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobQueue, JobSchedule } from '../../infra/jobs/jobs.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';
import { user } from '../users/schema.js';
import { reminderRecipients, reminderSets, reminderTimes } from './schema.js';
import { notifyTimesChanged } from './realtime.js';
import { listReminderSubjects, type ReminderSubjectRef, type SubjectInfo } from './subjects.js';

export const REMINDERS_FIRE_JOB = 'reminders.fire';

/** Every minute, so a reminder is at most a minute late. */
export const reminderSchedules: JobSchedule[] = [{ name: REMINDERS_FIRE_JOB, cron: '* * * * *' }];

/** A time older than this (an outage) is marked fired without a notification. */
const MAX_LATE_MS = 24 * 60 * 60_000;
const BATCH = 200;

type Deps = { db: Db; jobs: JobQueue };

/** Job handlers of the reminders module; passed to `startJobs`. */
export function remindersJobHandlers(deps: Deps): JobHandlers {
  return { [REMINDERS_FIRE_JOB]: async () => void (await fireDueReminders(deps)) };
}

/** What one batch processed: times, the users to deliver to, and the subjects whose times fired. */
type Batch = { count: number; eventIds: string[]; subjects: ReminderSubjectRef[] };

/** `afterSelect` is a test hook: it runs once the times are locked. */
export async function fireBatch(
  tx: Db,
  now: Date,
  limit: number,
  setIds: string[] | undefined,
  afterSelect?: () => Promise<void>,
): Promise<Batch> {
  const times = await tx
    .select({ id: reminderTimes.id, setId: reminderTimes.setId, at: reminderTimes.at })
    .from(reminderTimes)
    .where(
      and(
        isNull(reminderTimes.firedAt),
        lte(reminderTimes.at, now),
        setIds ? inArray(reminderTimes.setId, setIds) : undefined,
      ),
    )
    .orderBy(asc(reminderTimes.at), asc(reminderTimes.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  await afterSelect?.();
  if (times.length === 0) return { count: 0, eventIds: [], subjects: [] };

  // The sets, with the subject id of whichever kind they belong to.
  const setRows = await tx
    .select({
      id: reminderSets.id,
      groupId: reminderSets.groupId,
      knowledge: reminderSets.knowledgeItemId,
      task: reminderSets.taskId,
    })
    .from(reminderSets)
    .where(inArray(reminderSets.id, [...new Set(times.map((t) => t.setId))]));
  const subjectOf = new Map<string, { kind: ReminderSubjectKind; id: string; groupId: string }>();
  for (const s of setRows) {
    if (s.knowledge)
      subjectOf.set(s.id, { kind: 'knowledge', id: s.knowledge, groupId: s.groupId });
    else if (s.task) subjectOf.set(s.id, { kind: 'task', id: s.task, groupId: s.groupId });
  }
  const subjects = new Map<ReminderSubjectKind, Map<string, SubjectInfo>>();
  for (const subject of listReminderSubjects()) {
    const ids = [...subjectOf.values()].filter((s) => s.kind === subject.kind).map((s) => s.id);
    subjects.set(subject.kind, await subject.loadMany(tx, ids));
  }

  // An empty `in ()` is invalid SQL: with no sets there are no recipients.
  const recipientRows = !subjectOf.size
    ? []
    : await tx
        .select({
          setId: reminderRecipients.setId,
          userId: reminderRecipients.userId,
          role: user.role,
        })
        .from(reminderRecipients)
        .innerJoin(user, eq(user.id, reminderRecipients.userId))
        .where(inArray(reminderRecipients.setId, [...subjectOf.keys()]));
  const recipientsOf = new Map<string, { userId: string; isAdmin: boolean }[]>();
  for (const r of recipientRows) {
    const list = recipientsOf.get(r.setId) ?? [];
    list.push({ userId: r.userId, isAdmin: r.role === 'admin' || r.role === 'superadmin' });
    recipientsOf.set(r.setId, list);
  }

  const recorded: string[] = [];
  for (const time of times) {
    try {
      const ref = subjectOf.get(time.setId);
      const info = ref ? subjects.get(ref.kind)?.get(ref.id) : undefined;
      const stale = now.getTime() - time.at.getTime() > MAX_LATE_MS;
      if (ref && info && info.active && !stale) {
        const all = recipientsOf.get(time.setId) ?? [];
        const recipients = (info.adminsOnly ? all.filter((r) => r.isAdmin) : all).map(
          (r) => r.userId,
        );
        const payload: ReminderDuePayload = {
          subjectKind: ref.kind,
          subjectId: ref.id,
          groupId: info.groupId,
          title: info.title,
          at: time.at.toISOString(),
          // The task title lookup of the delivery shows the current title.
          ...(ref.kind === 'task' ? { taskId: ref.id } : {}),
        };
        // A savepoint, so one failing set does not abort the batch's transaction.
        await tx.transaction(async (sp) => {
          recorded.push(
            ...(await recordNotifications(sp, {
              kind: 'reminder.due',
              groupId: info.groupId,
              recipients,
              payload,
              dedupeKey: `reminder:${time.id}`,
            })),
          );
        });
      }
    } catch (error) {
      console.error(`reminders: firing time ${time.id} failed`, error);
    }
    await tx
      .update(reminderTimes)
      .set({ firedAt: sql`now()` })
      .where(eq(reminderTimes.id, time.id));
  }
  return {
    count: times.length,
    eventIds: recorded,
    subjects: [...subjectOf.values()].map(({ kind, id }) => ({ kind, id })),
  };
}

/**
 * Fires the due reminder times: one `reminder.due` event per recipient (dedupe key
 * `reminder:<timeId>`), then marks the time fired. After each batch commits it requests delivery
 * and tells the subjects' adapters their times changed (`notifyTimesChanged`). Safe to run in parallel (`skip locked`).
 * Returns how many times were processed. `setIds` limits it to those sets (tests).
 */
export async function fireDueReminders(
  deps: Deps,
  opts: { now?: Date; limit?: number; setIds?: string[] } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? BATCH;
  if (opts.setIds && opts.setIds.length === 0) return 0;
  let total = 0;
  for (;;) {
    const batch = await deps.db.transaction((tx) => fireBatch(tx, now, limit, opts.setIds));
    total += batch.count;
    await requestDelivery(deps.jobs, batch.eventIds);
    // Fired or silent, these subjects have fewer upcoming times now (the board's bell).
    await notifyTimesChanged(deps.db, batch.subjects);
    if (batch.count < limit) return total;
  }
}
