import { eq, sql } from 'drizzle-orm';
import {
  AI_TITLE_MAX,
  MeetingSummarySchema,
  type FileInfo,
  type MeetingAiError,
  type MeetingAiState,
  type MeetingActionItem,
  type MeetingDetail,
  type MeetingInput,
  type MeetingPatch,
  type MeetingRecordingState,
  type MeetingSummary,
  type MeetingTaskLink,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { knowledgeMeetings } from './schema.js';

// Phase 30: the `knowledge_meetings` rows of meeting items (read, write, the detail).

export type MeetingRow = typeof knowledgeMeetings.$inferSelect;

/** The meeting row of an item, or null. `lock` takes it `for update` (inside a transaction). */
export async function getMeetingRow(
  db: Db,
  itemId: string,
  lock = false,
): Promise<MeetingRow | null> {
  const query = db.select().from(knowledgeMeetings).where(eq(knowledgeMeetings.itemId, itemId));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** A stored summary, or null when it is missing or no longer matches the schema. */
export function parseSummary(value: unknown): MeetingSummary | null {
  if (value === null || value === undefined) return null;
  const parsed = MeetingSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The summary as plain text, for the search column. */
export function summaryText(summary: MeetingSummary | null): string[] {
  if (!summary) return [];
  return [
    summary.summary,
    ...summary.decisions,
    ...summary.actionItems.map((a) => [a.text, a.assignee ?? ''].join(' ')),
    ...summary.openQuestions,
  ];
}

/**
 * The meeting's text that search covers besides title, notes and file names. A summary held
 * for admins (Teams T1) is left out, so a client's search cannot probe it.
 */
export function meetingSearchExtras(row: {
  meetingUrl: string | null;
  recordingUrl: string | null;
  transcriptUrl: string | null;
  summary: unknown;
  transcriptAdminsOnly: boolean;
}): string[] {
  return [
    row.meetingUrl ?? '',
    row.recordingUrl ?? '',
    row.transcriptUrl ?? '',
    ...(row.transcriptAdminsOnly ? [] : summaryText(parseSummary(row.summary))),
  ];
}

/** Inserts the meeting row of a new item (inside the create's transaction). */
export async function insertMeeting(tx: Db, itemId: string, input: MeetingInput): Promise<void> {
  await tx.insert(knowledgeMeetings).values({
    itemId,
    startsAt: new Date(input.startsAt),
    meetingUrl: input.meetingUrl,
    recordingUrl: input.recordingUrl,
    transcriptUrl: input.transcriptUrl,
    transcript: input.transcript,
    transcriptSource: input.transcript.trim() === '' ? null : 'manual',
  });
}

/** Applies an edit of the meeting's fields (inside the update's transaction); the new row. */
export async function patchMeeting(
  tx: Db,
  itemId: string,
  patch: MeetingPatch,
  current: MeetingRow,
): Promise<MeetingRow> {
  const set: Partial<typeof knowledgeMeetings.$inferInsert> = {};
  if (patch.startsAt !== undefined) set.startsAt = new Date(patch.startsAt);
  if (patch.meetingUrl !== undefined) set.meetingUrl = patch.meetingUrl;
  if (patch.recordingUrl !== undefined) set.recordingUrl = patch.recordingUrl;
  if (patch.transcriptUrl !== undefined) set.transcriptUrl = patch.transcriptUrl;
  if (patch.transcript !== undefined && patch.transcript !== current.transcript) {
    set.transcript = patch.transcript;
    set.transcriptSource = patch.transcript.trim() === '' ? null : 'manual';
    // Nothing left to hold back once the transcript is emptied.
    if (patch.transcript.trim() === '') set.transcriptAdminsOnly = false;
  }
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (Object.keys(set).length === 0) return current;
  const [row] = await tx
    .update(knowledgeMeetings)
    .set(set)
    .where(eq(knowledgeMeetings.itemId, itemId))
    .returning();
  return row!;
}

const cut = (text: string, max: number) => Array.from(text).slice(0, max).join('').trim();
const titleKey = (title: string) => title.trim().toLocaleLowerCase();

/** An action item's task title: its text, cut to the task title's limit. */
export const actionItemTitle = (action: MeetingActionItem) => cut(action.text, AI_TITLE_MAX);

/**
 * The action items no task of the meeting covers yet: none of `taskTitles` is the item's title
 * (case and surrounding spaces ignored). A task renamed in the review counts as no match.
 */
export function actionItemsLeft(
  summary: MeetingSummary | null,
  taskTitles: readonly string[],
): MeetingActionItem[] {
  if (!summary) return [];
  const taken = new Set(taskTitles.map(titleKey));
  return summary.actionItems.filter((action) => !taken.has(titleKey(actionItemTitle(action))));
}

/**
 * Whether `viewerIsAdmin` may see the transcript and the summary (Teams T1): always, unless a
 * Teams transcript is still held for admins.
 */
export const canSeeTranscript = (row: MeetingRow, viewerIsAdmin: boolean): boolean =>
  viewerIsAdmin || !row.transcriptAdminsOnly;

/**
 * The detail of a meeting; `file` is its stored audio, `tasks` the tasks made from it.
 * `canProcess` is set by the route. A transcript held for admins reaches a non-admin as an
 * empty transcript without a summary (and `transcriptAdminsOnly` false: nothing to see).
 */
export function toMeetingDetail(
  row: MeetingRow,
  file: FileInfo | null,
  tasks: MeetingTaskLink[],
  viewerIsAdmin: boolean,
): MeetingDetail {
  const visible = canSeeTranscript(row, viewerIsAdmin);
  const summary = visible ? parseSummary(row.summary) : null;
  return {
    startsAt: row.startsAt.toISOString(),
    meetingUrl: row.meetingUrl,
    recordingUrl: row.recordingUrl,
    transcriptUrl: row.transcriptUrl,
    transcript: visible ? row.transcript : '',
    transcriptSource: visible
      ? ((row.transcriptSource as 'manual' | 'ai' | 'teams' | null) ?? null)
      : null,
    transcriptAdminsOnly: visible && row.transcriptAdminsOnly,
    recording: {
      state: row.recordingState as MeetingRecordingState,
      file: row.recordingState === 'ready' ? file : null,
    },
    ai: {
      state: row.aiState as MeetingAiState,
      error: (row.aiError as MeetingAiError | null) ?? null,
      updatedAt: row.aiUpdatedAt?.toISOString() ?? null,
    },
    summary,
    canProcess: false,
    tasks,
    actionItemsLeft: actionItemsLeft(
      summary,
      tasks.map((t) => t.title),
    ).length,
  };
}

/** Bumps the item's `updated_at`, so readers see that the meeting changed (a job's step). */
export async function touchItem(db: Db, itemId: string): Promise<void> {
  await db.execute(sql`update knowledge_items set updated_at = now() where id = ${itemId}`);
}
