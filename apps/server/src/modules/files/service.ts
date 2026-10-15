import { randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FileInfo } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/index.js';
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

  try {
    const piping = pipeline(input.body, counter);
    piping.catch(() => undefined); // awaited below; avoids an unhandled rejection meanwhile
    // The storage content type needs the sniffed mime, so wait for the first bytes.
    const sniffedHead = await Promise.race([headSeen, piping.then(() => headSeen)]);
    const mime = resolveMime(sniffedHead, input.declaredType);
    await Promise.all([piping, storage.put(key, counter, mime)]);

    const [row] = await db
      .insert(files)
      .values({
        id,
        groupId: input.groupId,
        uploadedBy: input.uploadedBy,
        name: input.name,
        mime,
        size,
        storageKey: key,
      })
      .returning();
    return toFileInfo(row!);
  } catch (error) {
    counter.destroy();
    input.body.destroy();
    await storage.delete(key).catch(() => undefined);
    throw tooLarge ? new FileTooLargeError() : error;
  }
}

/** Stores the browser-made WebP preview and its dimensions; overwrites an earlier one. */
export async function setFilePreview(
  { db, storage }: FileDeps,
  row: FileRow,
  input: { body: Buffer; width: number; height: number },
): Promise<void> {
  const key = `files/${row.groupId}/${row.id}-preview`;
  await storage.put(key, input.body, 'image/webp');
  await db
    .update(files)
    .set({ previewKey: key, width: input.width, height: input.height })
    .where(eq(files.id, row.id));
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
