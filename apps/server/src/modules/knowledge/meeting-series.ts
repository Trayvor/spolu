import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, isNotNull, lte, sql } from 'drizzle-orm';
import {
  latestSeriesEnd,
  MEETING_SERIES_LIMITS,
  occurrenceStart,
  withinSeriesEnd,
  zonedDay,
  type KnowledgePatch,
  type MeetingRepeat,
  type MeetingRepeatFrequency,
  type MeetingSeriesInfo,
  type SeriesRule,
  type SessionUser,
  type Visibility,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { pickableRecipients } from '../reminders/service.js';
import { user } from '../users/schema.js';
import { ValidationError } from './errors.js';
import { lockGroupKnowledge } from './folders.js';
import { announceMeeting } from './meeting-realtime.js';
import {
  knowledgeFolders,
  knowledgeItems,
  knowledgeMeetings,
  knowledgeMeetingSeries,
} from './schema.js';
import { insertItem } from './service.js';

// Recurring calls (ADR 0049): a series stores the rule and the template of its next calls; each
// call is a meeting item of its own, created ahead of time (at the series' creation and by the
// hourly series job, up to 60 days ahead). Everything per call (transcript, recording, AI,
// reminders, Teams) stays the call's, as for a single call.

export const MEETING_SERIES_JOB = 'knowledge.meeting-series';

export type SeriesRow = typeof knowledgeMeetingSeries.$inferSelect;

const DAY = 86_400_000;
const MINUTE = 60_000;
/** A reminder time is at least this far ahead (the reminders module's rule). */
const REMINDER_LEAD_MS = 60_000;
/** Calls one run creates for one series at most (a weekly series has 9 in the window). */
const MAX_PER_RUN = 70;

const horizonOf = (now: Date) => new Date(now.getTime() + MEETING_SERIES_LIMITS.horizonDays * DAY);

type RuleFields = Pick<
  SeriesRow,
  'frequency' | 'timeZone' | 'anchorStartsAt' | 'anchorIndex' | 'until' | 'count'
>;

const ruleOf = (s: RuleFields): SeriesRule => ({
  frequency: s.frequency as MeetingRepeatFrequency,
  timeZone: s.timeZone,
  anchorStartsAt: s.anchorStartsAt,
  anchorIndex: s.anchorIndex,
});

/** The start of occurrence `index`, or null when the series ends before it. */
function startOf(s: RuleFields, index: number): Date | null {
  const start = occurrenceStart(ruleOf(s), index);
  return withinSeriesEnd(s, index, start) ? start : null;
}

/**
 * A new series' rule against its first call: the first call at most 7 days ago, an end date
 * not before the first call's day and at most 2 years after it. ValidationError otherwise.
 */
export function checkRepeat(repeat: MeetingRepeat, firstStart: Date, now: Date = new Date()) {
  if (firstStart.getTime() < now.getTime() - MEETING_SERIES_LIMITS.maxPastDays * DAY) {
    throw new ValidationError('The first call of a series is too far in the past');
  }
  if (repeat.until === null) return;
  const first = zonedDay(firstStart, repeat.timeZone);
  if (repeat.until < first || repeat.until > latestSeriesEnd(firstStart, repeat.timeZone)) {
    throw new ValidationError('Invalid end of the series');
  }
}

/** Reminder times as minutes before the call's start (negative: after it). */
export function reminderOffsets(start: Date, times: { at: string }[]): number[] {
  return [...new Set(times.map((t) => Math.round((start.getTime() - Date.parse(t.at)) / MINUTE)))];
}

/** The reminder times of a call starting at `start`: only those still ahead. */
function reminderTimes(start: Date, offsets: number[], now: Date): { at: string }[] {
  const earliest = now.getTime() + REMINDER_LEAD_MS;
  return offsets
    .map((offset) => start.getTime() - offset * MINUTE)
    .filter((at) => at >= earliest)
    .sort((a, b) => a - b)
    .map((at) => ({ at: new Date(at).toISOString() }));
}

/** The author of a series as the actor of the calls it creates. */
async function authorOf(tx: Db, userId: string): Promise<SessionUser> {
  const [row] = await tx
    .select({ id: user.id, email: user.email, name: user.name, role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) throw new Error(`series author ${userId} not found`);
  return { ...row, role: row.role as SessionUser['role'], finance: false };
}

/**
 * Creates the series' calls from `series.next_index` on, up to 60 days after `now` (or the
 * series' end), with the template; moves the series' cursor on. Inside a transaction that holds
 * the group's knowledge lock. Returns the new items' ids.
 */
async function materialise(tx: Db, series: SeriesRow, now: Date): Promise<string[]> {
  const horizon = horizonOf(now).getTime();
  const created: string[] = [];
  let index = series.nextIndex;
  let start = startOf(series, index);
  if (start === null || start.getTime() > horizon) {
    await setCursor(tx, series.id, index, start);
    return created;
  }
  const author = await authorOf(tx, series.createdBy);
  // Inside an admins-only folder every call is admins-only, as for a new item.
  const [folder] = series.folderId
    ? await tx
        .select({ visibility: knowledgeFolders.visibility })
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.id, series.folderId))
    : [];
  const visibility: Visibility =
    folder?.visibility === 'admins' ? 'admins' : (series.visibility as Visibility);
  const recipientIds = await pickableRecipients(
    tx,
    series.groupId,
    visibility === 'admins',
    series.reminderRecipientIds.filter((id) => id !== series.createdBy),
  );
  while (start !== null && start.getTime() <= horizon && created.length < MAX_PER_RUN) {
    const { id } = await insertItem(tx, author, series.groupId, {
      type: 'meeting',
      title: series.title,
      body: series.body,
      visibility,
      folderId: folder ? series.folderId : null,
      fileIds: [],
      meeting: {
        startsAt: start.toISOString(),
        meetingUrl: series.meetingUrl,
        recordingUrl: null,
        transcriptUrl: null,
        transcript: '',
        repeat: null,
      },
      reminder: { times: reminderTimes(start, series.reminderOffsets, now), recipientIds },
    });
    await tx
      .update(knowledgeMeetings)
      .set({ seriesId: series.id, seriesIndex: index })
      .where(eq(knowledgeMeetings.itemId, id));
    created.push(id);
    index += 1;
    start = startOf(series, index);
  }
  await setCursor(tx, series.id, index, start);
  return created;
}

const setCursor = (tx: Db, id: string, nextIndex: number, nextStartsAt: Date | null) =>
  tx
    .update(knowledgeMeetingSeries)
    .set({ nextIndex, nextStartsAt, updatedAt: sql`now()` })
    .where(eq(knowledgeMeetingSeries.id, id));

/** What a new series copies into its next calls. */
export type SeriesTemplate = {
  title: string;
  body: string;
  visibility: Visibility;
  folderId: string | null;
  meetingUrl: string | null;
  reminderTimes: { at: string }[];
  reminderRecipientIds: string[];
};

/**
 * Inside `createItem`'s transaction (group lock held): the series of the new call `firstItemId`
 * (occurrence 0) and its next calls inside the window. Returns the ids of the calls it created.
 */
export async function createSeries(
  tx: Db,
  args: {
    groupId: string;
    firstItemId: string;
    firstStart: Date;
    repeat: MeetingRepeat;
    template: SeriesTemplate;
    authorId: string;
    now?: Date;
  },
): Promise<string[]> {
  const now = args.now ?? new Date();
  const { repeat, template } = args;
  const rule = {
    frequency: repeat.frequency,
    timeZone: repeat.timeZone,
    anchorStartsAt: args.firstStart,
    anchorIndex: 0,
    until: repeat.until,
    count: repeat.count,
  };
  const [row] = await tx
    .insert(knowledgeMeetingSeries)
    .values({
      id: randomUUID(),
      groupId: args.groupId,
      ...rule,
      nextIndex: 1,
      nextStartsAt: startOf(rule, 1),
      title: template.title,
      body: template.body,
      visibility: template.visibility,
      folderId: template.folderId,
      meetingUrl: template.meetingUrl,
      reminderOffsets: reminderOffsets(args.firstStart, template.reminderTimes),
      reminderRecipientIds: template.reminderRecipientIds,
      createdBy: args.authorId,
    })
    .returning();
  await tx
    .update(knowledgeMeetings)
    .set({ seriesId: row!.id, seriesIndex: 0 })
    .where(eq(knowledgeMeetings.itemId, args.firstItemId));
  return materialise(tx, row!, now);
}

/** The series place of a call, or null for a single call. */
export async function seriesPlaceOf(
  db: Db,
  itemId: string,
): Promise<{ seriesId: string; index: number } | null> {
  const [row] = await db
    .select({ seriesId: knowledgeMeetings.seriesId, index: knowledgeMeetings.seriesIndex })
    .from(knowledgeMeetings)
    .where(eq(knowledgeMeetings.itemId, itemId));
  if (!row || row.seriesId === null || row.index === null) return null;
  return { seriesId: row.seriesId, index: row.index };
}

const lockSeries = async (tx: Db, id: string) =>
  (
    await tx
      .select()
      .from(knowledgeMeetingSeries)
      .where(eq(knowledgeMeetingSeries.id, id))
      .for('update')
  )[0];

/** The calls of a series after occurrence `index`, in order. */
const followersOf = (db: Db, seriesId: string, index: number) =>
  db
    .select({ id: knowledgeMeetings.itemId, index: knowledgeMeetings.seriesIndex })
    .from(knowledgeMeetings)
    .where(and(eq(knowledgeMeetings.seriesId, seriesId), gt(knowledgeMeetings.seriesIndex, index)))
    .orderBy(asc(knowledgeMeetings.seriesIndex));

/**
 * "This and following" of an edit, inside `updateItem`'s transaction after the edited call was
 * updated: the patch's title, notes, visibility, folder, meeting link, start and reminder go to
 * the series' template and, through `apply` (the same update with the same actor and its
 * checks), to every later call. A moved start re-anchors the rule at the edited call, and every
 * later call moves to its place under the new rule. The rest (transcript, recording, summary,
 * linked items) stays per call. Returns the later calls changed, with their visibility before.
 */
export async function updateFollowing(
  tx: Db,
  args: {
    itemId: string;
    patch: KnowledgePatch;
    now: Date;
    apply: (id: string, patch: KnowledgePatch) => Promise<Visibility>;
  },
): Promise<{ id: string; previousVisibility: Visibility }[]> {
  const { patch } = args;
  const place = await seriesPlaceOf(tx, args.itemId);
  if (!place) throw new ValidationError('Not a recurring call');
  const series = await lockSeries(tx, place.seriesId);
  if (!series) throw new ValidationError('Not a recurring call');
  const [edited] = await tx
    .select({
      visibility: knowledgeItems.visibility,
      folderId: knowledgeItems.folderId,
      startsAt: knowledgeMeetings.startsAt,
    })
    .from(knowledgeItems)
    .innerJoin(knowledgeMeetings, eq(knowledgeMeetings.itemId, knowledgeItems.id))
    .where(eq(knowledgeItems.id, args.itemId));

  const set: Partial<typeof knowledgeMeetingSeries.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.visibility !== undefined || patch.folderId !== undefined) {
    // The edited call's resulting place: an admins-only folder made it admins-only.
    set.visibility = edited!.visibility;
    set.folderId = edited!.folderId;
  }
  const meetingUrl = patch.meeting?.meetingUrl;
  if (meetingUrl !== undefined) set.meetingUrl = meetingUrl;
  const moved = patch.meeting?.startsAt !== undefined;
  if (moved) {
    set.anchorStartsAt = edited!.startsAt;
    set.anchorIndex = place.index;
  }
  if (patch.reminder !== undefined) {
    set.reminderOffsets = reminderOffsets(edited!.startsAt, patch.reminder.times);
    set.reminderRecipientIds = patch.reminder.recipientIds;
  }
  const next = { ...series, ...set } as SeriesRow;
  if (moved) set.nextStartsAt = startOf(next, series.nextIndex);
  if (Object.keys(set).length > 0) {
    await tx
      .update(knowledgeMeetingSeries)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(knowledgeMeetingSeries.id, series.id));
  }

  const changed: { id: string; previousVisibility: Visibility }[] = [];
  // The reminders follow when they were edited, or when the calls moved and the series has some.
  const remind = patch.reminder !== undefined || (moved && next.reminderOffsets.length > 0);
  for (const follower of await followersOf(tx, series.id, place.index)) {
    const start = moved
      ? occurrenceStart(ruleOf(next), follower.index!)
      : (
          await tx
            .select({ startsAt: knowledgeMeetings.startsAt })
            .from(knowledgeMeetings)
            .where(eq(knowledgeMeetings.itemId, follower.id))
        )[0]!.startsAt;
    const meeting: NonNullable<KnowledgePatch['meeting']> = {};
    if (meetingUrl !== undefined) meeting.meetingUrl = meetingUrl;
    if (moved) meeting.startsAt = start.toISOString();
    const followerPatch: KnowledgePatch = {
      updatedAt: new Date(0).toISOString(),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(set.visibility !== undefined ? { visibility: set.visibility as Visibility } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(Object.keys(meeting).length > 0 ? { meeting } : {}),
      // Moved only: the recipients stay as they are (no `recipientIds`).
      ...(remind
        ? {
            reminder: {
              times: reminderTimes(start, next.reminderOffsets, args.now),
              recipientIds: patch.reminder?.recipientIds,
            } as KnowledgePatch['reminder'],
          }
        : {}),
    };
    changed.push({
      id: follower.id,
      previousVisibility: await args.apply(follower.id, followerPatch),
    });
  }
  return changed;
}

/**
 * "Cancel this and the following calls", inside `deleteItem`'s transaction: the later calls'
 * ids (to delete with the same checks) and the series ended after the calls before `itemId`.
 * Cancelling from the first call removes the series itself (with its Teams plan).
 */
export async function endSeriesAt(tx: Db, itemId: string): Promise<{ followerIds: string[] }> {
  const place = await seriesPlaceOf(tx, itemId);
  if (!place) throw new ValidationError('Not a recurring call');
  const series = await lockSeries(tx, place.seriesId);
  if (!series) throw new ValidationError('Not a recurring call');
  const followerIds = (await followersOf(tx, series.id, place.index)).map((f) => f.id);
  await tx
    .update(knowledgeMeetingSeries)
    .set({ count: place.index, until: null, nextStartsAt: null, updatedAt: sql`now()` })
    .where(eq(knowledgeMeetingSeries.id, series.id));
  return { followerIds };
}

/** Removes a series none of whose calls is left (after a delete of "this and following"). */
export async function dropEmptySeries(tx: Db, itemSeriesId: string): Promise<void> {
  await tx.execute(sql`delete from knowledge_meeting_series s where s.id = ${itemSeriesId}
    and not exists (select 1 from knowledge_meetings m where m.series_id = s.id)`);
}

/**
 * The series part of a call's detail. `viewerIsAdmin`: a client counts only the later calls
 * they can read.
 */
export async function seriesInfo(
  db: Db,
  place: { seriesId: string; index: number },
  viewerIsAdmin: boolean,
): Promise<MeetingSeriesInfo | null> {
  const [series] = await db
    .select()
    .from(knowledgeMeetingSeries)
    .where(eq(knowledgeMeetingSeries.id, place.seriesId));
  if (!series) return null;
  const visible = viewerIsAdmin ? sql`true` : sql`k.visibility = 'public'`;
  const [count] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from knowledge_meetings m join knowledge_items k on k.id = m.item_id
    where m.series_id = ${series.id} and m.series_index > ${place.index} and ${visible}`);
  return {
    id: series.id,
    frequency: series.frequency as MeetingRepeatFrequency,
    timeZone: series.timeZone,
    until: series.until,
    count: series.count,
    index: place.index,
    followingCount: count?.n ?? 0,
    ended: series.nextStartsAt === null,
  };
}

/** The calls of a series from occurrence `fromIndex` on, in order (no access check). */
export async function listSeriesCalls(
  db: Db,
  seriesId: string,
  fromIndex: number,
): Promise<{ itemId: string; index: number; startsAt: Date }[]> {
  const rows = await db
    .select({
      itemId: knowledgeMeetings.itemId,
      index: knowledgeMeetings.seriesIndex,
      startsAt: knowledgeMeetings.startsAt,
    })
    .from(knowledgeMeetings)
    .where(
      and(eq(knowledgeMeetings.seriesId, seriesId), gte(knowledgeMeetings.seriesIndex, fromIndex)),
    )
    .orderBy(asc(knowledgeMeetings.seriesIndex));
  return rows.map((r) => ({ itemId: r.itemId, index: r.index!, startsAt: r.startsAt }));
}

/**
 * The series job: every series whose next call falls inside the window gets its calls created
 * (each series in its own transaction, under its group's knowledge lock). Their readers get
 * the new rows. Returns how many calls it created.
 */
export async function materialiseDueSeries(
  deps: { db: Db },
  now: Date = new Date(),
): Promise<number> {
  const { db } = deps;
  const due = await db
    .select({ id: knowledgeMeetingSeries.id, groupId: knowledgeMeetingSeries.groupId })
    .from(knowledgeMeetingSeries)
    .where(
      and(
        isNotNull(knowledgeMeetingSeries.nextStartsAt),
        lte(knowledgeMeetingSeries.nextStartsAt, horizonOf(now)),
      ),
    )
    .orderBy(asc(knowledgeMeetingSeries.nextStartsAt))
    .limit(200);
  let total = 0;
  for (const { id, groupId } of due) {
    const created = await db.transaction(async (tx) => {
      // The group's lock first, then the row: the order of every knowledge write.
      await lockGroupKnowledge(tx, groupId);
      const series = await lockSeries(tx, id);
      if (!series || series.nextStartsAt === null) return [];
      return materialise(tx, series, now);
    });
    total += created.length;
    for (const itemId of created) await announceMeeting(db, itemId);
  }
  return total;
}

export function meetingSeriesJobHandlers(deps: { db: Db }): JobHandlers {
  return { [MEETING_SERIES_JOB]: async () => void (await materialiseDueSeries(deps)) };
}

/** Hourly: the window is 60 days, so an hour's delay never matters. */
export const meetingSeriesSchedules: JobSchedule[] = [
  { name: MEETING_SERIES_JOB, cron: '7 * * * *' },
];
