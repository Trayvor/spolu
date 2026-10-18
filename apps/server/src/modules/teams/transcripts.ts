import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { SessionUser, TeamsMeetingState, TeamsTranscriptState } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import {
  attachTeamsTranscript,
  getMeetingForTeams,
  meetingForTeamsAction,
} from '../knowledge/meeting-teams.js';
import { subtitlesToText } from '../knowledge/transcript-text.js';
import { GraphError, type TeamsGraph } from './graph-client.js';
import { inMeetingWindow, nextPollAt } from './schedule.js';
import { teamsMeetingLinks } from './schema.js';
import { ensureCanManage, toTeamsLink, type LinkRow, type TeamsDeps } from './service.js';

// Teams T1: the transcript import. A job every 5 minutes looks at the connected meetings that
// are due (`next_poll_at`, spec schedule in `schedule.ts`); an admin's "Check now" looks at one.
// The same set of Graph transcripts is never fetched twice, so a look is cheap and idempotent.

export const TRANSCRIPT_POLL_JOB = 'teams.transcript-poll';
/** Meetings one run looks at, at most. */
export const POLL_BATCH = 50;

/** WebVTT (or the unattributed text format) as the transcript's text, speakers as "Name: ". */
export function transcriptText(content: string): string {
  const text = subtitlesToText(content);
  return text !== '' ? text : content.replace(/\r\n?/g, '\n').trim();
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * One look at one connected meeting at `now`: finds the online meeting if still unknown,
 * applies automatic recording if Graph refused it before, lists the transcripts of the
 * record's time window and imports them (all of them, in order, joined by a blank line) when
 * the set changed. `replace` overwrites a transcript the meeting had of its own.
 */
export async function pollLink(
  deps: { db: Db; graph: TeamsGraph },
  row: LinkRow,
  now: Date,
  options: { replace?: boolean } = {},
): Promise<LinkRow | null> {
  const { db, graph } = deps;
  const meeting = await getMeetingForTeams(db, row.itemId);
  if (!meeting) return null; // the item is going; its row cascades
  const times = { startsAt: meeting.startsAt, durationMinutes: row.durationMinutes };
  let onlineMeetingId = row.onlineMeetingId;
  let recordApplied = row.recordApplied;
  let state = row.transcriptState as TeamsTranscriptState;
  let transcriptIds = row.transcriptIds;
  let lastError: string | null = null;
  try {
    if (!onlineMeetingId) {
      const online = await graph.findOnlineMeeting(row.organizerEntraId, {
        joinWebUrl: row.joinUrl,
      });
      onlineMeetingId = online?.id ?? null;
    }
    if (onlineMeetingId && row.recordAutomatically && !recordApplied && now < meeting.startsAt) {
      await graph.setRecordAutomatically(row.organizerEntraId, onlineMeetingId, true);
      recordApplied = true;
    }
    if (onlineMeetingId) {
      const listed = (await graph.listTranscripts(row.organizerEntraId, onlineMeetingId))
        .filter((t) => inMeetingWindow(new Date(t.createdDateTime), times))
        .sort((a, b) => Date.parse(a.createdDateTime) - Date.parse(b.createdDateTime));
      const ids = listed.map((t) => t.id);
      const known = sameSet(ids, transcriptIds) && (state === 'imported' || state === 'available');
      if (ids.length > 0 && (!known || options.replace)) {
        const parts: string[] = [];
        for (const transcript of listed) {
          const content = await graph.transcriptContent(
            row.organizerEntraId,
            onlineMeetingId,
            transcript.id,
          );
          const text = transcriptText(content);
          if (text !== '') parts.push(text);
        }
        if (parts.length > 0) {
          const result = await attachTeamsTranscript(db, row.itemId, parts.join('\n\n'), {
            replace: options.replace ?? false,
          });
          if (result === 'missing') return null;
          state = result === 'kept' ? 'available' : 'imported';
          transcriptIds = ids;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    // Only the code: a body may echo ids. Shown in the admins' Teams block.
    lastError = error.code === 'unknown' ? `http_${error.status}` : error.code;
  }
  const next = nextPollAt(now, times);
  if (next === null && state === 'waiting') state = lastError ? 'failed' : 'none';
  const [saved] = await db
    .update(teamsMeetingLinks)
    .set({
      onlineMeetingId,
      recordApplied,
      transcriptState: state,
      transcriptIds,
      lastError,
      lastPolledAt: now,
      nextPollAt: next,
      updatedAt: sql`now()`,
    })
    .where(eq(teamsMeetingLinks.itemId, row.itemId))
    .returning();
  return saved ?? null;
}

/** One run of the poll job: the due meetings, oldest due first, one after the other. */
export async function pollDueMeetings(
  deps: { db: Db; graph: TeamsGraph },
  now: Date = new Date(),
): Promise<number> {
  const due = await deps.db
    .select()
    .from(teamsMeetingLinks)
    .where(and(isNotNull(teamsMeetingLinks.nextPollAt), lte(teamsMeetingLinks.nextPollAt, now)))
    .orderBy(asc(teamsMeetingLinks.nextPollAt))
    .limit(POLL_BATCH);
  for (const row of due) {
    try {
      await pollLink(deps, row, now);
    } catch (error) {
      // One meeting's failure (the database) must not stop the others; the next run retries.
      console.error(`teams: could not poll meeting ${row.itemId}`, error);
    }
  }
  return due.length;
}

/** "Check now" (or "Replace with the Teams transcript" with `replace`) of one meeting. */
export async function checkTeamsMeeting(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
  options: { replace: boolean },
  now: Date = new Date(),
): Promise<TeamsMeetingState> {
  await meetingForTeamsAction(deps.db, actor, itemId);
  const row = await ensureCanManage(deps, actor, itemId);
  const saved = await pollLink(deps, row, now, options);
  return { link: saved ? toTeamsLink(deps.config, saved) : null };
}
