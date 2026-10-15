import { randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FileInfo } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/index.js';
import { sanitizeFileName } from './file-name.js';
import { files } from './schema.js';
import { IMAGE_TYPES, sniffImageType } from './sniff.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const SNIFF_BYTES = 12;
const MIME_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const FALLBACK_MIME = 'application/octet-stream';

export type FileDeps = { db: Db; storage: Storage };
export type FileRow = typeof files.$inferSelect;

export class FileTooLargeError extends Error {
  constructor() {
    super('File is larger than the upload limit');
    this.name = 'FileTooLargeError';
  }
}

export class InvalidAttachmentError extends Error {
  constructor() {
    super('A file cannot be attached: unknown, foreign, not yours or already attached');
    this.name = 'InvalidAttachmentError';
  }
}

/** The sniffed image type, else the declared type unless it claims an image the bytes are not. */
function resolveMime(head: Buffer, declaredType: string | undefined): string {
  const sniffed = sniffImageType(head);
  if (sniffed) return sniffed;
  const declared = declaredType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!MIME_PATTERN.test(declared)) return FALLBACK_MIME;
  // A fake PNG/JPEG/WebP must never be served inline as an image.
  return (IMAGE_TYPES as readonly string[]).includes(declared) ? FALLBACK_MIME : declared;
}

export function toFileInfo(row: FileRow): FileInfo {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    hasPreview: row.previewKey !== null,
  };
}

export async function getFile(db: Db, id: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return row ?? null;
}

/**
 * Streams the upload into storage (at most MAX_FILE_BYTES), then inserts the row.
 * Any failure removes whatever was stored and rethrows.
 */
export async function createFile(
  { db, storage }: FileDeps,
  input: {
    groupId: string;
    uploadedBy: string;
    name: string;
    declaredType: string | undefined;
    body: Readable;
  },
): Promise<FileInfo> {
  const id = randomUUID();
  const key = `files/${input.groupId}/${id}`;

  let size = 0;
  let tooLarge = false;
  let head = Buffer.alloc(0);
  let resolveHead!: (head: Buffer) => void;
  const headSeen = new Promise<Buffer>((resolve) => (resolveHead = resolve));
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) {
        tooLarge = true;
        return callback(new FileTooLargeError());
      }
      if (head.length < SNIFF_BYTES) {
        head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
        if (head.length === SNIFF_BYTES) resolveHead(head);
      }
      callback(null, chunk);
    },
    flush(callback) {
      resolveHead(head);
      callback();
    },
  });

  let putting: Promise<void> | undefined;
  try {
    const piping = pipeline(input.body, counter);
    piping.catch(() => undefined); // awaited below; avoids an unhandled rejection meanwhile
    // The storage content type needs the sniffed mime, so wait for the first bytes.
    const sniffedHead = await Promise.race([headSeen, piping.then(() => headSeen)]);
    const mime = resolveMime(sniffedHead, input.declaredType);
    putting = storage.put(key, counter, mime);
    await Promise.all([piping, putting]);

    const [row] = await db
      .insert(files)
      .values({
        id,
        groupId: input.groupId,
        uploadedBy: input.uploadedBy,
        name: sanitizeFileName(input.name),
        mime,
        size,
        storageKey: key,
      })
      .returning();
    return toFileInfo(row!);
  } catch (error) {
    counter.destroy();
    input.body.destroy();
    // Let an in-flight put settle first, so it cannot recreate files after the delete.
    await putting?.catch(() => undefined);
    await storage.delete(key).catch(() => undefined);
    throw tooLarge ? new FileTooLargeError() : error;
  }
}

/**
 * Copies a file of `groupId` server-side into a new, unattached file of that group owned by `userId`
 * (a file that is unknown or in another group throws InvalidAttachmentError),
 * with its own storage objects (data, and the preview if any). A copy never shares objects with
 * the source, so either can be deleted alone. If anything fails, the copied objects are removed.
 */
export async function copyFile(
  { db, storage }: FileDeps,
  input: { fileId: string; groupId: string; userId: string },
): Promise<FileInfo> {
  const source = await getFile(db, input.fileId);
  if (!source || source.groupId !== input.groupId) throw new InvalidAttachmentError();
  const id = randomUUID();
  const storageKey = `files/${source.groupId}/${id}`;
  const preview = source.previewKey
    ? { from: source.previewKey, to: `files/${source.groupId}/${id}-preview-${randomUUID()}` }
    : null;
  const previewKey = preview?.to ?? null;
  try {
    await storage.copy(source.storageKey, storageKey);
    if (preview) await storage.copy(preview.from, preview.to);
    const [row] = await db
      .insert(files)
      .values({
        id,
        groupId: source.groupId,
        uploadedBy: input.userId,
        name: source.name,
        mime: source.mime,
        size: source.size,
        storageKey,
        previewKey,
        width: source.width,
        height: source.height,
      })
      .returning();
    return toFileInfo(row!);
  } catch (error) {
    await Promise.all(
      [storageKey, previewKey].flatMap((key) =>
        key ? [storage.delete(key).catch(() => undefined)] : [],
      ),
    );
    throw error;
  }
}

/**
 * Stores the browser-made WebP preview and its dimensions. The row update is a single
 * conditional UPDATE, so of two racing calls exactly one wins; the loser's object is removed
 * and `false` is returned (the route answers 400 invalid_preview).
 */
export async function setFilePreview(
  { db, storage }: FileDeps,
  row: FileRow,
  input: { body: Buffer; width: number; height: number },
): Promise<boolean> {
  const key = `files/${row.groupId}/${row.id}-preview-${randomUUID()}`;
  await storage.put(key, input.body, 'image/webp');
  const updated = await db
    .update(files)
    .set({ previewKey: key, width: input.width, height: input.height })
    .where(and(eq(files.id, row.id), isNull(files.previewKey), isNull(files.attachedAt)))
    .returning({ id: files.id });
  if (updated.length === 0) {
    await storage.delete(key).catch(() => undefined);
    return false;
  }
  return true;
}

/** Marks the caller's own unattached files of the group as used. Call inside the owner's transaction. */
export async function attachFiles(
  tx: Db,
  groupId: string,
  fileIds: string[],
  userId: string,
): Promise<void> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return;
  const attached = await tx
    .update(files)
    .set({ attachedAt: sql`now()` })
    .where(
      and(
        inArray(files.id, ids),
        eq(files.groupId, groupId),
        eq(files.uploadedBy, userId),
        isNull(files.attachedAt),
      ),
    )
    .returning({ id: files.id });
  if (attached.length < ids.length) throw new InvalidAttachmentError();
}

/**
 * Marks files as unattached again (the owner dropped them), so the daily unattached cleanup
 * removes them if their immediate deletion fails. Call inside the owner's transaction.
 */
export async function detachFiles(tx: Db, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await tx.update(files).set({ attachedAt: null }).where(inArray(files.id, fileIds));
}

/** In the order of `ids`; ids that are unknown or in another group are skipped. */
export async function getFilesForGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<FileInfo[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.groupId, groupId), inArray(files.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toFileInfo(row)] : [];
  });
}

/** Deletes the storage objects of removed rows, ignoring storage errors. */
async function dropStored(
  storage: Storage,
  removed: { storageKey: string; previewKey: string | null }[],
): Promise<void> {
  const keys = removed.flatMap((r) =>
    r.previewKey ? [r.storageKey, r.previewKey] : [r.storageKey],
  );
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)));
}

/** Rows first, then storage objects. Call after the owner's transaction commits. */
export async function deleteFiles({ db, storage }: FileDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const removed = await db
    .delete(files)
    .where(inArray(files.id, ids))
    .returning({ storageKey: files.storageKey, previewKey: files.previewKey });
  await dropStored(storage, removed);
}

/**
 * The owner's post-commit cleanup after `detachFiles`: deletes only those of `ids` that are still
 * unattached (rows, then storage objects). A file the uploader attached again in between, to
 * another message or task, is kept.
 */
export async function deleteDetachedFiles({ db, storage }: FileDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const removed = await db
    .delete(files)
    .where(and(inArray(files.id, ids), isNull(files.attachedAt)))
    .returning({ storageKey: files.storageKey, previewKey: files.previewKey });
  await dropStored(storage, removed);
}

/** Deletes files never attached and created before `olderThan`; returns how many. */
export async function deleteUnattachedFiles(
  { db, storage }: FileDeps,
  olderThan: Date,
): Promise<number> {
  const removed = await db
    .delete(files)
    .where(and(isNull(files.attachedAt), lt(files.createdAt, olderThan)))
    .returning({ storageKey: files.storageKey, previewKey: files.previewKey });
  await dropStored(storage, removed);
  return removed.length;
}
