import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, ne, sql } from 'drizzle-orm';
import { MEETING_LIMITS, type SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobQueue } from '../../infra/jobs/jobs.js';
import type { MediaTools } from '../../infra/media/media.js';
import type { Storage } from '../../infra/storage/index.js';
import {
  attachReceivedFiles,
  createStoredFile,
  deleteDetachedFiles,
  deleteFiles,
  detachFiles,
  FileTooLargeError,
  getFile,
  setFilesAdminsOnly,
} from '../files/service.js';
import { InvalidRecordingError, KnowledgeNotFoundError, RecordingBusyError } from './errors.js';
import { findMeetingItem, meetingFor } from './meeting-access.js';
import { announceMeeting } from './meeting-realtime.js';
import { getMeetingRow, touchItem } from './meeting-store.js';
import { knowledgeAttachments, knowledgeMeetings } from './schema.js';
import { refreshSearchText } from './service.js';
import { userActor, type AuditActor } from '../audit/actor.js';
import { recordAudit } from '../audit/service.js';
import { knowledgeSnapshots } from './audit.js';

// Phase 30: a meeting's recording. The upload is streamed to storage as it is; a job transcodes
// it to compact speech audio (`MediaTools.toSpeechAudio`), keeps only that and deletes the upload.

export const RECORDING_JOB = 'knowledge.meeting-transcode';
/** Attempts of one transcode before the recording is `failed`. */
const RECORDING_ATTEMPTS = 3;
const RETRY_SECONDS = 60;
const AUDIO_MIME = 'audio/mp4';

const MEDIA_EXTENSIONS =
  /\.(mp3|m4a|mp4|m4v|mov|wav|webm|ogg|oga|opus|aac|flac|wma|wmv|mkv|avi|mpeg|mpg|3gp|amr|aif|aiff|aifc|m2ts|mts)$/i;

/** `audio/*` or `video/*`, or an octet stream whose name has a media extension. */
export function isRecordingUpload(declaredType: string | undefined, name: string): boolean {
  const mime = declaredType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (/^(audio|video)\/[a-z0-9.+-]+$/.test(mime)) return true;
  return (mime === '' || mime === 'application/octet-stream') && MEDIA_EXTENSIONS.test(name);
}

type RecordingDeps = { db: Db; storage: Storage; jobs: JobQueue };

/** Streams `body` into storage under `key`, at most `max` bytes (else FileTooLargeError). */
async function streamToStorage(
  storage: Storage,
  key: string,
  body: Readable,
  max: number,
): Promise<void> {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > max) return callback(new FileTooLargeError());
      callback(null, chunk);
    },
  });
  let putting: Promise<void> | undefined;
  try {
    const piping = pipeline(body, counter);
    piping.catch(() => undefined);
    putting = storage.put(key, counter, 'application/octet-stream');
    await Promise.all([piping, putting]);
  } catch (error) {
    counter.destroy();
    body.destroy();
    await putting?.catch(() => undefined);
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

/**
 * Takes a meeting's recording upload (its editors): streamed to storage, the meeting set to
 * `processing` and the transcode job sent. A recording in `processing` answers RecordingBusyError
 * (checked before the upload and again after it).
 */
export async function uploadRecording(
  deps: RecordingDeps,
  actor: SessionUser,
  itemId: string,
  input: { name: string; declaredType: string | undefined; body: Readable },
): Promise<void> {
  const { db, storage, jobs } = deps;
  await meetingFor(db, actor, itemId, 'edit');
  if (!isRecordingUpload(input.declaredType, input.name)) throw new InvalidRecordingError();
  const before = await getMeetingRow(db, itemId);
  if (!before) throw new KnowledgeNotFoundError();
  if (before.recordingState === 'processing') throw new RecordingBusyError();

  const key = `meeting-uploads/${itemId}/${randomUUID()}`;
  await streamToStorage(storage, key, input.body, MEETING_LIMITS.recordingBytes);
  const started = await db
    .update(knowledgeMeetings)
    .set({ recordingState: 'processing', uploadKey: key })
    .where(
      and(eq(knowledgeMeetings.itemId, itemId), ne(knowledgeMeetings.recordingState, 'processing')),
    )
    .returning({ itemId: knowledgeMeetings.itemId });
  if (started.length === 0) {
    await storage.delete(key).catch(() => undefined);
    // The item went (cascade) or another upload won the race.
    if (!(await getMeetingRow(db, itemId))) throw new KnowledgeNotFoundError();
    throw new RecordingBusyError();
  }
  await touchItem(db, itemId);
  await jobs.send(
    RECORDING_JOB,
    { itemId, uploadKey: key, attempt: 1 },
    { expireInSeconds: 2 * 60 * 60, retryLimit: 1, retryDelay: RETRY_SECONDS },
  );
  await announceMeeting(db, itemId);
}

/**
 * Removes a meeting's stored audio (its editors), and a waiting upload with it. The audio file
 * is deleted after the commit.
 */
export async function deleteRecording(
  deps: { db: Db; storage: Storage },
  actor: SessionUser,
  itemId: string,
  by: AuditActor = userActor(actor),
): Promise<void> {
  const { db, storage } = deps;
  await meetingFor(db, actor, itemId, 'edit');
  const { fileId, uploadKey } = await db.transaction(async (tx) => {
    const row = await getMeetingRow(tx, itemId, true);
    if (!row) throw new KnowledgeNotFoundError();
    if (row.recordingFileId) {
      await tx
        .delete(knowledgeAttachments)
        .where(
          and(
            eq(knowledgeAttachments.itemId, itemId),
            eq(knowledgeAttachments.fileId, row.recordingFileId),
          ),
        );
      await detachFiles(tx, [row.recordingFileId]);
    }
    await tx
      .update(knowledgeMeetings)
      .set({ recordingState: 'none', recordingFileId: null, uploadKey: null })
      .where(eq(knowledgeMeetings.itemId, itemId));
    await tx.execute(sql`update knowledge_items set updated_at = now() where id = ${itemId}`);
    if (row.recordingFileId || row.uploadKey) {
      const item = (await knowledgeSnapshots(tx, [itemId])).get(itemId);
      if (item) {
        await recordAudit(tx, by, [
          {
            entityType: 'knowledge_item',
            entityId: itemId,
            entityLabel: item.title,
            groupId: item.groupId,
            action: 'recording_deleted',
          },
        ]);
      }
    }
    return { fileId: row.recordingFileId, uploadKey: row.uploadKey };
  });
  if (fileId) await deleteDetachedFiles({ db, storage }, [fileId]).catch(() => undefined);
  if (uploadKey) await storage.delete(uploadKey).catch(() => undefined);
  await refreshSearchText(db, itemId);
  await announceMeeting(db, itemId);
}

/**
 * A stored object as a local file for ffmpeg: the disk storage's own path, or a copy in `dir`
 * for a storage without one.
 */
async function localCopy(storage: Storage, key: string, dir: string): Promise<string> {
  const path = storage.localPath(key);
  if (path) return path;
  const target = join(dir, 'input');
  const { stream } = await storage.get(key);
  await pipeline(stream, createWriteStream(target));
  return target;
}

const audioName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'recording'}.m4a`;

type TranscodeJob = { itemId: string; uploadKey: string; attempt: number };

/**
 * One transcode: the upload → compact audio → a new file attached to the item (replacing the
 * previous recording), the meeting `ready`, the upload deleted. A job whose upload is no longer
 * the meeting's (deleted, replaced) only deletes its upload. On failure: again a minute later,
 * up to RECORDING_ATTEMPTS, then `failed` and the upload deleted.
 */
async function transcode(
  deps: { db: Db; storage: Storage; media: MediaTools; jobs: JobQueue },
  job: TranscodeJob,
): Promise<void> {
  const { db, storage, media, jobs } = deps;
  const current = await getMeetingRow(db, job.itemId);
  if (!current || current.uploadKey !== job.uploadKey) {
    await storage.delete(job.uploadKey).catch(() => undefined);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'spolu-meeting-'));
  let newFileId: string | null = null;
  try {
    const item = await findMeetingItem(db, job.itemId);
    if (!item) return;
    const input = await localCopy(storage, job.uploadKey, dir);
    const output = join(dir, 'speech.m4a');
    await media.toSpeechAudio(input, output);
    const file = await createStoredFile(
      { db, storage },
      { groupId: item.groupId, name: audioName(item.title), mime: AUDIO_MIME, path: output },
    );
    newFileId = file.id;
    const replaced = await db.transaction(async (tx) => {
      const row = await getMeetingRow(tx, job.itemId, true);
      if (!row || row.uploadKey !== job.uploadKey) return 'stale' as const;
      // The item's visibility now, under the row lock (a concurrent edit waits on it).
      const fresh = await findMeetingItem(tx, job.itemId);
      if (!fresh) return 'stale' as const;
      await attachReceivedFiles(tx, [file.id]);
      await setFilesAdminsOnly(tx, [file.id], fresh.visibility === 'admins');
      await tx.insert(knowledgeAttachments).values({ itemId: job.itemId, fileId: file.id });
      if (row.recordingFileId) {
        await tx
          .delete(knowledgeAttachments)
          .where(
            and(
              eq(knowledgeAttachments.itemId, job.itemId),
              eq(knowledgeAttachments.fileId, row.recordingFileId),
            ),
          );
        await detachFiles(tx, [row.recordingFileId]);
      }
      await tx
        .update(knowledgeMeetings)
        .set({ recordingState: 'ready', recordingFileId: file.id, uploadKey: null })
        .where(eq(knowledgeMeetings.itemId, job.itemId));
      await tx.execute(sql`update knowledge_items set updated_at = now() where id = ${job.itemId}`);
      return row.recordingFileId;
    });
    if (replaced === 'stale') {
      await deleteFiles({ db, storage }, [file.id]).catch(() => undefined);
    } else {
      if (replaced) await deleteDetachedFiles({ db, storage }, [replaced]).catch(() => undefined);
      await refreshSearchText(db, job.itemId);
    }
    newFileId = null;
    await storage.delete(job.uploadKey).catch(() => undefined);
    await announceMeeting(db, job.itemId);
  } catch (error) {
    if (newFileId) await deleteFiles({ db, storage }, [newFileId]).catch(() => undefined);
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn(`meetings: transcode of ${job.itemId} failed (attempt ${job.attempt}): ${reason}`);
    if (job.attempt < RECORDING_ATTEMPTS) {
      await jobs.send(
        RECORDING_JOB,
        { ...job, attempt: job.attempt + 1 },
        { startAfter: RETRY_SECONDS, expireInSeconds: 2 * 60 * 60, retryLimit: 1 },
      );
      return;
    }
    const failed = await db
      .update(knowledgeMeetings)
      .set({ recordingState: 'failed', uploadKey: null })
      .where(
        and(
          eq(knowledgeMeetings.itemId, job.itemId),
          eq(knowledgeMeetings.uploadKey, job.uploadKey),
        ),
      )
      .returning({ itemId: knowledgeMeetings.itemId });
    await storage.delete(job.uploadKey).catch(() => undefined);
    if (failed.length > 0) {
      await touchItem(db, job.itemId);
      await announceMeeting(db, job.itemId);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The transcode job's handler. */
export function recordingJobHandlers(deps: {
  db: Db;
  storage: Storage;
  media: MediaTools;
  jobs: JobQueue;
}): JobHandlers {
  return {
    [RECORDING_JOB]: (data) => transcode(deps, data as TranscodeJob),
  };
}

/** The stored audio of a meeting as a local file path (for the AI job); null without one. */
export async function recordingPath(
  db: Db,
  storage: Storage,
  fileId: string | null,
  dir: string,
): Promise<string | null> {
  if (!fileId) return null;
  const file = await getFile(db, fileId);
  if (!file) return null;
  return localCopy(storage, file.storageKey, dir);
}
