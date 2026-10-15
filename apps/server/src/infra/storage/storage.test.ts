import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidStorageKeyError, StorageNotFoundError, createDiskStorage } from './index.js';
import type { Storage } from './index.js';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

describe('disk storage', () => {
  let dir: string;
  let storage: Storage;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spolu-storage-'));
    storage = createDiskStorage(dir, 'test-secret');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a buffer with its content type and size', async () => {
    const data = Buffer.from('hello world');
    await storage.put('groups/1/logo.png', data, 'image/png');
    const got = await storage.get('groups/1/logo.png');
    expect(got.contentType).toBe('image/png');
    expect(got.size).toBe(data.length);
    expect(await readAll(got.stream)).toEqual(data);
  });

  it('accepts a Readable and overwrites without leaving temp files', async () => {
    await storage.put('a.txt', Buffer.from('one'), 'text/plain');
    await storage.put('a.txt', Readable.from([Buffer.from('tw'), Buffer.from('o')]), 'text/plain');
    expect((await readAll((await storage.get('a.txt')).stream)).toString()).toBe('two');
    expect((await readdir(dir)).sort()).toEqual(['a.txt', 'a.txt.meta.json']);
  });

  it('deletes data and sidecar; exists reflects it; delete of missing is a no-op', async () => {
    await storage.put('a.txt', Buffer.from('x'), 'text/plain');
    expect(await storage.exists('a.txt')).toBe(true);
    await storage.delete('a.txt');
    expect(await storage.exists('a.txt')).toBe(false);
    expect(await readdir(dir)).toEqual([]);
    await expect(storage.delete('a.txt')).resolves.toBeUndefined();
  });

  it('a data file without its sidecar reads as not found', async () => {
    await writeFile(join(dir, 'orphan.txt'), 'x');
    await expect(storage.get('orphan.txt')).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('put writes the sidecar before the data', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    await expect(storage.put('b.txt', failing, 'text/plain')).rejects.toThrow('boom');
    expect(await storage.exists('b.txt')).toBe(false);
    expect(await readdir(dir)).toEqual(['b.txt.meta.json']);
  });

  it('throws StorageNotFoundError for a missing key', async () => {
    await expect(storage.get('nope.txt')).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it.each([
    '../x',
    '/etc/x',
    'a/../../x',
    'a/./b',
    'a//b',
    'a/',
    '',
    'A.txt',
    'a b',
    'a\\b',
    'x.meta.json',
    'dir/x.meta.json',
  ])('rejects invalid key %j before touching the filesystem', async (key) => {
    await expect(storage.put(key, Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.exists(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    expect(() => storage.signUrl(key, 60)).toThrow(InvalidStorageKeyError);
    expect(await readdir(dir)).toEqual([]);
  });

  describe('signed urls', () => {
    const parse = (url: string) => {
      const u = new URL(url, 'http://x');
      return {
        path: u.pathname,
        expires: Number(u.searchParams.get('expires')),
        sig: u.searchParams.get('sig') ?? '',
      };
    };

    it('signUrl then verifySignature is true', () => {
      const url = storage.signUrl('groups/1/logo.png', 60);
      expect(url.startsWith('/files/groups/1/logo.png?expires=')).toBe(true);
      const { expires, sig } = parse(url);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(storage.verifySignature('groups/1/logo.png', expires, sig)).toBe(true);
    });

    it('rejects a tampered signature, wrong length, other key, other expiry', () => {
      const { expires, sig } = parse(storage.signUrl('a.txt', 60));
      const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
      expect(storage.verifySignature('a.txt', expires, flipped)).toBe(false);
      expect(storage.verifySignature('a.txt', expires, sig.slice(2))).toBe(false);
      expect(storage.verifySignature('a.txt', expires, '')).toBe(false);
      expect(storage.verifySignature('b.txt', expires, sig)).toBe(false);
      expect(storage.verifySignature('a.txt', expires + 1, sig)).toBe(false);
    });

    it('rejects upper-case, short and non-hex signatures', () => {
      const { expires, sig } = parse(storage.signUrl('a.txt', 60));
      expect(storage.verifySignature('a.txt', expires, sig.toUpperCase())).toBe(false);
      expect(storage.verifySignature('a.txt', expires, sig.slice(0, 32))).toBe(false);
      expect(storage.verifySignature('a.txt', expires, 'z'.repeat(64))).toBe(false);
      expect(storage.verifySignature('a.txt', expires, `${sig}00`)).toBe(false);
    });

    it('rejects an expired signature', () => {
      const { expires, sig } = parse(storage.signUrl('a.txt', -1));
      expect(storage.verifySignature('a.txt', expires, sig)).toBe(false);
    });

    it('rejects a signature made with another secret', () => {
      const other = createDiskStorage(dir, 'other-secret');
      const { expires, sig } = parse(other.signUrl('a.txt', 60));
      expect(storage.verifySignature('a.txt', expires, sig)).toBe(false);
    });
  });
});
