import { createReadStream, createWriteStream } from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { InvalidStorageKeyError, StorageNotFoundError, type Storage } from './storage.js';

const KEY_PATTERN = /^[a-z0-9/_.-]+$/;
const META_SUFFIX = '.meta.json';

function assertValidKey(key: string): void {
  const segments = key.split('/');
  const ok =
    KEY_PATTERN.test(key) &&
    !key.startsWith('/') &&
    !key.endsWith(META_SUFFIX) &&
    segments.every((s) => s !== '' && s !== '.' && s !== '..');
  if (!ok) throw new InvalidStorageKeyError(key);
}

export function createDiskStorage(rootDir: string, secret: string): Storage {
  const root = resolve(rootDir);

  // Validates the key, then resolves it and asserts the result stays inside root.
  function pathFor(key: string): string {
    assertValidKey(key);
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new InvalidStorageKeyError(key);
    return full;
  }

  function sign(key: string, expires: number): string {
    return createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
  }

  async function atomicWrite(target: string, data: Buffer | Readable): Promise<void> {
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      if (Buffer.isBuffer(data)) await writeFile(tmp, data);
      else await pipeline(data, createWriteStream(tmp));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    async put(key, data, contentType) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await atomicWrite(path, data);
      await atomicWrite(path + META_SUFFIX, Buffer.from(JSON.stringify({ contentType })));
    },

    async get(key) {
      const path = pathFor(key);
      let size: number;
      let contentType: string;
      try {
        size = (await stat(path)).size;
        contentType = (JSON.parse(await readFile(path + META_SUFFIX, 'utf8')) as { contentType: string })
          .contentType;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
        throw err;
      }
      return { stream: createReadStream(path), contentType, size };
    },

    async delete(key) {
      const path = pathFor(key);
      await rm(path, { force: true });
      await rm(path + META_SUFFIX, { force: true });
    },

    async exists(key) {
      const path = pathFor(key);
      try {
        return (await stat(path)).isFile();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
    },

    signUrl(key, ttlSeconds) {
      assertValidKey(key);
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      return `/files/${key}?expires=${expires}&sig=${sign(key, expires)}`;
    },

    verifySignature(key, expires, sig) {
      try {
        assertValidKey(key);
      } catch {
        return false;
      }
      if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
      const expected = Buffer.from(sign(key, expires), 'hex');
      const given = Buffer.from(sig, 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
