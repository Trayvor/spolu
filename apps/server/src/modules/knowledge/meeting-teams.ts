import { eq } from 'drizzle-orm';
import { MEETING_LIMITS, type SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { KnowledgeForbiddenError } from './errors.js';
import { meetingFor } from './meeting-access.js';
import { announceMeeting } from './meeting-realtime.js';
import { getMeetingRow, touchItem } from './meeting-store.js';
import { canShareMeetingTranscript } from './policy.js';
import { knowledgeItems, knowledgeMeetings } from './schema.js';
import { refreshSearchText } from './service.js';

// Teams T1: what the teams module may read and change of a meeting item. The teams module
// never touches `knowledge_*` tables; the knowledge module never calls Microsoft Graph.

export type MeetingForTeams = {
  itemId: string;
  groupId: string;
  title: string;
  startsAt: Date;
  meetingUrl: string | null;
  /** The item's last change (the public `.ics` SEQUENCE). */
  updatedAt: Date;
};

/** The meeting's fields the Teams side needs, or null (no such meeting). No access check. */
export async function getMeetingForTeams(db: Db, itemId: string): Promise<MeetingForTeams | null> {
  const [row] = await db
    .select({
      itemId: knowledgeItems.id,
      groupId: knowledgeItems.groupId,
      title: knowledgeItems.title,
      updatedAt: knowledgeItems.updatedAt,
      startsAt: knowledgeMeetings.startsAt,
      meetingUrl: knowledgeMeetings.meetingUrl,
    })
    .from(knowledgeMeetings)
    .innerJoin(knowledgeItems, eq(knowledgeItems.id, knowledgeMeetings.itemId))
    .where(eq(knowledgeMeetings.itemId, itemId));
  return row ?? null;
}

/**
 * The meeting item for a Teams action of `actor`: readable and editable by them, else the
 * knowledge errors (404 unreadable, 403 not editable). The Teams policy adds "admins only".
 */
export async function meetingForTeamsAction(
  db: Db,
  actor: SessionUser,
  itemId: string,
): Promise<MeetingForTeams> {
  await meetingFor(db, actor, itemId, 'edit');
  const meeting = await getMeetingForTeams(db, itemId);
  if (!meeting) throw new KnowledgeForbiddenError();
  return meeting;
}

/** Sets the meeting's link (the Teams join URL) and tells its readers. No access check. */
export async function setMeetingUrlFromTeams(db: Db, itemId: string, url: string): Promise<void> {
  await db
    .update(knowledgeMeetings)
    .set({ meetingUrl: url })
    .where(eq(knowledgeMeetings.itemId, itemId));
  await refreshSearchText(db, itemId);
  await touchItem(db, itemId);
  await announceMeeting(db, itemId);
}

/**
 * What an import did: `imported` (stored, held for admins), `unchanged` (the same text is there
 * already), `kept` (the meeting has a transcript of its own and `replace` was not asked),
 * `missing` (no such meeting).
 */
export type TeamsTranscriptResult = 'imported' | 'unchanged' | 'kept' | 'missing';

/**
 * Stores a transcript imported from Teams on the meeting (no access check; the teams job and
 * the admins' "Check now" call it). A transcript typed, pasted or made by the AI is never
 * overwritten unless `replace`. The imported text is held for admins until shared.
 */
export async function attachTeamsTranscript(
  db: Db,
  itemId: string,
  text: string,
  options: { replace: boolean },
): Promise<TeamsTranscriptResult> {
  const transcript = Array.from(text).slice(0, MEETING_LIMITS.transcript).join('');
  const result = await db.transaction(async (tx) => {
    const row = await getMeetingRow(tx, itemId, true);
    if (!row) return 'missing' as const;
    if (row.transcriptSource === 'teams' && row.transcript === transcript) return 'unchanged';
    const ownTranscript = row.transcript.trim() !== '' && row.transcriptSource !== 'teams';
    if (ownTranscript && !options.replace) return 'kept';
    await tx
      .update(knowledgeMeetings)
      .set({ transcript, transcriptSource: 'teams', transcriptAdminsOnly: true })
      .where(eq(knowledgeMeetings.itemId, itemId));
    return 'imported' as const;
  });
  if (result === 'imported') {
    await refreshSearchText(db, itemId);
    await touchItem(db, itemId);
    await announceMeeting(db, itemId);
  }
  return result;
}

/**
 * "Share transcript with the client": the meeting's transcript and summary follow the item's
 * visibility again. Admins only (`canShareMeetingTranscript`), on a meeting they read.
 */
export async function shareMeetingTranscript(
  db: Db,
  actor: SessionUser,
  itemId: string,
): Promise<void> {
  await meetingFor(db, actor, itemId, 'read');
  if (!canShareMeetingTranscript(actor)) throw new KnowledgeForbiddenError();
  await db
    .update(knowledgeMeetings)
    .set({ transcriptAdminsOnly: false })
    .where(eq(knowledgeMeetings.itemId, itemId));
  await refreshSearchText(db, itemId);
  await touchItem(db, itemId);
  await announceMeeting(db, itemId);
}
