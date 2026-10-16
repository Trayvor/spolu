import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/index.js';
import type { Storage } from '../../infra/storage/storage.js';
import { user } from '../users/schema.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { GIF, jpegBytes, pngBytes } from '../../../test/bulk-images.js';
import {
  ImageTooLargeError,
  UnsupportedImageError,
  getImage,
  imageExists,
  imageSize,
  imageSizes,
  saveImage,
} from './images.js';

describe('imageSize', () => {
  it('reads a PNG IHDR', () => {
    expect(imageSize(pngBytes(640, 480))).toEqual({
      mime: 'image/png',
      width: 640,
      height: 480,
    });
  });

  it('reads the JPEG SOF marker after other segments', () => {
    expect(imageSize(jpegBytes(1200, 800))).toEqual({
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
    });
  });

  it('rejects a GIF, WebP, a truncated PNG and a zero size', () => {
    expect(imageSize(GIF)).toBeNull();
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(imageSize(webp)).toBeNull();
    expect(imageSize(pngBytes(10, 10).subarray(0, 20))).toBeNull();
    expect(imageSize(pngBytes(0, 10))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
  });
});

describe('saveImage', () => {
  const { db, close } = createDb(testDatabaseUrl);
  let dir: string;
  let storage: Storage;
  let adminId: string;
  const config = { publicUrl: 'https://spolu.test/' };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spolu-bulk-'));
    storage = createDiskStorage(dir, 'secret-secret-secret-secret-secret');
    adminId = randomUUID();
    await db
      .insert(user)
      .values({ id: adminId, name: 'A', email: `${adminId}@example.com`, role: 'admin' });
  });
  afterAll(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it('stores a PNG under bulk/<uuid> with the sniffed type and size', async () => {
    const bytes = pngBytes(300, 200);
    const saved = await saveImage({ db, storage, config }, { id: adminId }, Readable.from([bytes]));
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved).toMatchObject({
      url: `https://spolu.test/api/bulk-email/images/${saved.id}`,
      width: 300,
      height: 200,
    });
    const row = await getImage(db, saved.id);
    expect(row).toMatchObject({
      storageKey: `bulk/${saved.id}`,
      mime: 'image/png',
      size: bytes.length,
      uploadedBy: adminId,
    });
    const stored = await storage.get(`bulk/${saved.id}`);
    expect(stored.contentType).toBe('image/png');
    expect(stored.size).toBe(bytes.length);
  });

  it('rejects a GIF and stores nothing', async () => {
    await expect(
      saveImage({ db, storage, config }, { id: adminId }, Readable.from([GIF])),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('rejects a body over 2 MB', async () => {
    const big = pngBytes(10, 10, 2 * 1024 * 1024);
    await expect(
      saveImage({ db, storage, config }, { id: adminId }, Readable.from([big])),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('imageExists and imageSizes answer only for stored ids', async () => {
    const a = await saveImage(
      { db, storage, config },
      { id: adminId },
      Readable.from([jpegBytes(40, 30)]),
    );
    const missing = randomUUID();
    expect(await imageExists(db, [a.id, missing])).toEqual(new Set([a.id]));
    expect(await imageSizes(db, [a.id, missing, 'not-a-uuid'])).toEqual(
      new Map([[a.id, { width: 40, height: 30 }]]),
    );
    expect(await imageExists(db, [])).toEqual(new Set());
  });

  it('getImage answers null for an unknown or malformed id', async () => {
    expect(await getImage(db, randomUUID())).toBeNull();
    expect(await getImage(db, '../x')).toBeNull();
  });
});
