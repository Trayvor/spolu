import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { inArray, eq } from 'drizzle-orm';
import { BULK_LIMITS, type BulkImageMime, type SessionUser } from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { sniffImageType } from '../files/sniff.js';
import { imageUrl } from './render.js';
import { bulkImages } from './schema.js';

/**
 * Images of bulk emails (spec §3): uploaded by admins, served publicly by their random id, so
 * mail apps can load them without a session. Only PNG and JPEG, sniffed from the bytes.
 */

export class ImageTooLargeError extends Error {
  constructor() {
    super(`Image over ${BULK_LIMITS.imageBytes} bytes`);
    this.name = 'ImageTooLargeError';
  }
}

export class UnsupportedImageError extends Error {
  constructor() {
    super('Not a PNG or JPEG image');
    this.name = 'UnsupportedImageError';
  }
}

type ImageRow = typeof bulkImages.$inferSelect;
type ImageDeps = { db: Db; storage: Storage; config: Pick<Config, 'publicUrl'> };

/** The largest side accepted; real uploads are shrunk by the browser to 1 200 px wide. */
const MAX_SIDE = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Type and pixel size of a PNG (IHDR) or a JPEG (first SOF marker); null for anything else. */
export function imageSize(
  buf: Buffer,
): { mime: BulkImageMime; width: number; height: number } | null {
  const mime = sniffImageType(buf);
  let size: { width: number; height: number } | null = null;
  if (mime === 'image/png') size = pngSize(buf);
  else if (mime === 'image/jpeg') size = jpegSize(buf);
  if (!mime || mime === 'image/webp' || !size) return null;
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;
  return ok(size.width) && ok(size.height) ? { mime, ...size } : null;
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // Signature (8), chunk length (4), "IHDR" (4), width (4), height (4).
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Walks the JPEG segments to the first start-of-frame (SOF0–SOF15 except DHT, JPG, DAC). */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = buf.readUInt16BE(at + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (at + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

/** Reads the whole body (at most `BULK_LIMITS.imageBytes`); stops reading once it is over. */
async function readLimited(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > BULK_LIMITS.imageBytes) {
      body.destroy();
      throw new ImageTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Stores an uploaded image under `bulk/<uuid>` and records it. The type comes from the bytes,
 * never from the request; the id (122 random bits) is the only secret of the public URL.
 */
export async function saveImage(
  deps: ImageDeps,
  actor: Pick<SessionUser, 'id'>,
  body: Readable,
): Promise<{ id: string; url: string; width: number; height: number }> {
  const bytes = await readLimited(body);
  const info = imageSize(bytes);
  if (!info) throw new UnsupportedImageError();

  const id = randomUUID();
  const storageKey = `bulk/${id}`;
  await deps.storage.put(storageKey, bytes, info.mime);
  try {
    await deps.db.insert(bulkImages).values({
      id,
      storageKey,
      mime: info.mime,
      size: bytes.length,
      width: info.width,
      height: info.height,
      uploadedBy: actor.id,
    });
  } catch (error) {
    await deps.storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  return { id, url: imageUrl(deps.config.publicUrl, id), width: info.width, height: info.height };
}

/** The image row, or null for an unknown id or one that is not a UUID. */
export async function getImage(db: Db, id: string): Promise<ImageRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(bulkImages).where(eq(bulkImages.id, id));
  return row ?? null;
}

/** Stored sizes of the given images (one query); unknown ids are left out. */
export async function imageSizes(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, { width: number; height: number }>> {
  const valid = [...new Set(ids)].filter((id) => UUID.test(id));
  if (valid.length === 0) return new Map();
  const rows = await db
    .select({ id: bulkImages.id, width: bulkImages.width, height: bulkImages.height })
    .from(bulkImages)
    .where(inArray(bulkImages.id, valid));
  return new Map(rows.map((r) => [r.id, { width: r.width, height: r.height }]));
}

/** Which of the given image ids exist (for `validateForSend`). */
export async function imageExists(db: Db, ids: readonly string[]): Promise<Set<string>> {
  return new Set((await imageSizes(db, ids)).keys());
}
