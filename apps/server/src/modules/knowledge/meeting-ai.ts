import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import {
  isMeetingAiBusy,
  MEETING_LIMITS,
  type MeetingAiError,
  type MeetingAiState,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobQueue } from '../../infra/jobs/jobs.js';
import type { MediaTools } from '../../infra/media/media.js';
import type { Storage } from '../../infra/storage/index.js';
import type { MeetingSummaryProvider } from '../ai/meeting-summary.js';
import type { TranscriptionProvider } from '../ai/transcription.js';
import { listPickablePeople } from '../groups/service.js';
import {
  KnowledgeNotFoundError,
  MeetingAiUnavailableError,
  MeetingBusyError,
  NothingToProcessError,
} from './errors.js';
import { findMeetingItem, meetingFor } from './meeting-access.js';
import { notifyMeetingAiResult } from './meeting-notify.js';
import { announceMeeting } from './meeting-realtime.js';
import { recordingPath } from './meeting-recording.js';
import { getMeetingRow, touchItem } from './meeting-store.js';
import { knowledgeItems, knowledgeMeetings } from './schema.js';
import { refreshSearchText } from './service.js';

// Phase 30: "Spracovať s AI". A run transcribes the stored audio when there is no transcript,
// then summarizes the transcript. One run per meeting at a time (`ai_run` names the current one).

export const MEETING_AI_JOB = 'knowledge.meeting-ai';
const MEETING_AI_ATTEMPTS = 3;
const RETRY_SECONDS = 60;
/** Segments sent to the transcription provider: under OpenAI's 25 MB and duration limits. */
const SEGMENT_SECONDS = 20 * 60;
const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000;
const SUMMARY_TIMEOUT_MS = 5 * 60_000;

/** The AI a run can use; either may be off. */
export type MeetingAi = {
  transcription: TranscriptionProvider | null;
  summary: MeetingSummaryProvider | null;
};

const BUSY: MeetingAiState[] = ['queued', 'transcribing', 'summarizing'];

/** Whether a run of this meeting could start now with this AI (the detail's `canProcess`). */
export function canRunMeetingAi(
  ai: MeetingAi,
  row: { transcript: string; recordingState: string },
): boolean {
  if (ai.summary === null) return false;
  if (row.transcript.trim() !== '') return true;
  return row.recordingState === 'ready' && ai.transcription !== null;
}

/**
 * Starts a run (admins): refused when there is nothing to process, the AI it needs is off, or a
 * run is queued or running (one conditional update decides). Sends the job.
 */
export async function requestMeetingAi(
  deps: { db: Db; jobs: JobQueue; ai: MeetingAi },
  actor: SessionUser,
  itemId: string,
): Promise<void> {
  const { db, jobs, ai } = deps;
  await meetingFor(db, actor, itemId, 'admin');
  const row = await getMeetingRow(db, itemId);
  if (!row) throw new KnowledgeNotFoundError();
  if (isMeetingAiBusy(row.aiState as MeetingAiState)) throw new MeetingBusyError();
  const hasTranscript = row.transcript.trim() !== '';
  if (!hasTranscript && row.recordingState !== 'ready') throw new NothingToProcessError();
  if (!canRunMeetingAi(ai, row)) throw new MeetingAiUnavailableError();
  const [started] = await db
    .update(knowledgeMeetings)
    .set({
      aiState: 'queued',
      aiError: null,
      aiRun: sql`${knowledgeMeetings.aiRun} + 1`,
      aiUpdatedAt: sql`now()`,
    })
    .where(and(eq(knowledgeMeetings.itemId, itemId), notInArray(knowledgeMeetings.aiState, BUSY)))
    .returning({ run: knowledgeMeetings.aiRun });
  if (!started) throw new MeetingBusyError();
  await touchItem(db, itemId);
  await jobs.send(
    MEETING_AI_JOB,
    { itemId, run: started.run, attempt: 1, requestedBy: actor.id },
    { expireInSeconds: 3 * 60 * 60, retryLimit: 1, retryDelay: RETRY_SECONDS },
  );
  await announceMeeting(db, itemId);
}

/** `requestedBy`: the admin who pressed the button (told how the run ended); absent on jobs queued before 2026-10-17. */
type AiJob = { itemId: string; run: number; attempt: number; requestedBy?: string };

/** A step's failure, with the code the meeting shows. */
class StepError extends Error {
  constructor(
    readonly code: MeetingAiError,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

const bratislava = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', ...options });
const whenText = bratislava({ dateStyle: 'full', timeStyle: 'short' });
const todayText = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bratislava',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Runs `step` with an abort signal that fires after `ms`. */
async function withTimeout<T>(ms: number, step: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
  });
  return Promise.race([step(signal), timedOut]);
}

type JobDeps = {
  db: Db;
  storage: Storage;
  media: MediaTools;
  jobs: JobQueue;
  ai: MeetingAi;
};

/** Sets the state of run `run` only (a newer run owns the row otherwise); false when stale. */
async function setState(
  db: Db,
  job: AiJob,
  set: Partial<typeof knowledgeMeetings.$inferInsert>,
): Promise<boolean> {
  const updated = await db
    .update(knowledgeMeetings)
    .set({ ...set, aiUpdatedAt: sql`now()` })
    .where(and(eq(knowledgeMeetings.itemId, job.itemId), eq(knowledgeMeetings.aiRun, job.run)))
    .returning({ itemId: knowledgeMeetings.itemId });
  if (updated.length === 0) return false;
  await touchItem(db, job.itemId);
  await announceMeeting(db, job.itemId);
  return true;
}

/** The transcript of the stored audio: its segments transcribed in order, blank lines between. */
async function transcribe(deps: JobDeps, fileId: string | null): Promise<string> {
  const provider = deps.ai.transcription;
  if (!provider) throw new StepError('transcription_failed', 'no transcription provider');
  const dir = await mkdtemp(join(tmpdir(), 'spolu-transcribe-'));
  try {
    const audio = await recordingPath(deps.db, deps.storage, fileId, dir);
    if (!audio) throw new StepError('transcription_failed', 'the recording is gone');
    const partsDir = join(dir, 'parts');
    await mkdir(partsDir);
    const parts = await deps.media.split(audio, partsDir, SEGMENT_SECONDS);
    const texts: string[] = [];
    for (const part of parts) {
      const bytes = await readFile(part);
      const { text } = await withTimeout(TRANSCRIBE_TIMEOUT_MS, (signal) =>
        provider.transcribe({ audio: bytes, fileName: basename(part), mime: 'audio/mp4' }, signal),
      );
      if (text.trim() !== '') texts.push(text.trim());
    }
    const transcript = Array.from(texts.join('\n\n')).slice(0, MEETING_LIMITS.transcript).join('');
    if (transcript.trim() === '') throw new StepError('transcription_failed', 'empty transcript');
    return transcript;
  } catch (error) {
    if (error instanceof StepError) throw error;
    const reason = error instanceof Error ? error.message : 'unknown';
    throw new StepError('transcription_failed', reason);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One run: transcribe if needed, then summarize; retried a minute later, then `failed`. */
async function runMeetingAi(deps: JobDeps, job: AiJob): Promise<void> {
  const { db } = deps;
  const row = await getMeetingRow(db, job.itemId);
  if (!row || row.aiRun !== job.run) return;
  const item = await findMeetingItem(db, job.itemId);
  if (!item) return;
  const meetingOf = () => ({
    itemId: job.itemId,
    groupId: item.groupId,
    title: item.title,
    startsAt: row.startsAt,
  });
  try {
    let transcript = row.transcript;
    if (transcript.trim() === '') {
      if (!(await setState(db, job, { aiState: 'transcribing' }))) return;
      transcript = await transcribe(deps, row.recordingFileId);
      // Kept even if the summary fails: a retry only summarizes.
      const saved = await db
        .update(knowledgeMeetings)
        .set({ transcript, transcriptSource: 'ai' })
        .where(and(eq(knowledgeMeetings.itemId, job.itemId), eq(knowledgeMeetings.aiRun, job.run)))
        .returning({ itemId: knowledgeMeetings.itemId });
      if (saved.length === 0) return;
    }
    if (!(await setState(db, job, { aiState: 'summarizing' }))) return;
    const provider = deps.ai.summary;
    if (!provider) throw new StepError('summary_failed', 'no summary provider');
    const [people, notes] = await Promise.all([
      listPickablePeople(db, item.groupId),
      db
        .select({ body: knowledgeItems.body })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.id, job.itemId))
        .then((rows) => rows[0]?.body ?? ''),
    ]);
    const started = Date.now();
    let result;
    try {
      result = await withTimeout(SUMMARY_TIMEOUT_MS, (signal) =>
        provider.summarize(
          {
            title: item.title,
            startsAt: whenText.format(row.startsAt),
            notes,
            transcript: Array.from(transcript).slice(0, MEETING_LIMITS.summaryInput).join(''),
            people: people.map((p) => p.name),
            today: todayText.format(new Date()),
          },
          signal,
        ),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      throw new StepError('summary_failed', reason);
    }
    // Cost tracking, like the task split's log line: never the transcript or the summary.
    console.info(
      JSON.stringify({
        msg: 'ai meeting summary',
        ai: { itemId: job.itemId, durationMs: Date.now() - started, usage: result.usage },
      }),
    );
    if (!(await setState(db, job, { aiState: 'done', aiError: null, summary: result.summary }))) {
      return;
    }
    await refreshSearchText(db, job.itemId);
    await notifyMeetingAiResult(deps, 'meeting.summary_ready', meetingOf(), job.requestedBy);
  } catch (error) {
    const code: MeetingAiError = error instanceof StepError ? error.code : 'summary_failed';
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn(`meetings: AI run of ${job.itemId} failed (attempt ${job.attempt}): ${reason}`);
    if (job.attempt < MEETING_AI_ATTEMPTS) {
      await deps.jobs.send(
        MEETING_AI_JOB,
        { ...job, attempt: job.attempt + 1 },
        { startAfter: RETRY_SECONDS, expireInSeconds: 3 * 60 * 60, retryLimit: 1 },
      );
      return;
    }
    if (await setState(db, job, { aiState: 'failed', aiError: code })) {
      await notifyMeetingAiResult(deps, 'meeting.summary_failed', meetingOf(), job.requestedBy);
    }
  }
}

export function meetingAiJobHandlers(deps: JobDeps): JobHandlers {
  return {
    [MEETING_AI_JOB]: (data) => runMeetingAi(deps, data as AiJob),
  };
}
