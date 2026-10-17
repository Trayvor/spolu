import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/disk-storage.js';
import type { Storage } from '../../infra/storage/index.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient } from '../users/service.js';
import { files } from './schema.js';
import {
  attachFiles,
  attachReceivedFiles,
  copyFile,
  createFile,
  createReceivedFile,
  deleteDetachedFiles,
  deleteFiles,
  deleteUnattachedFiles,
  detachFiles,
  FileTooLargeError,
  getFile,
  getFilesForGroup,
  InvalidAttachmentError,
  setFilePreview,
  setFilesFinanceOnly,
  type FileDeps,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
let dir: string;
let storage: Storage;
let deps: FileDeps;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spolu-files-'));
  storage = createDiskStorage(dir, 'test-secret');
  deps = { db, storage };
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function setup() {
  const group = await createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const owner = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
  return { group, owner };
}

const upload = (
  groupId: string,
  uploadedBy: string,
  body: Buffer | Readable,
  declaredType: string | null = 'text/plain',
  name = 'notes.txt',
) =>
  createFile(deps, {
    groupId,
    uploadedBy,
    name,
    declaredType: declaredType ?? undefined,
    body: Buffer.isBuffer(body) ? Readable.from([body]) : body,
  });

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const rowsOf = (groupId: string) => db.select().from(files).where(eq(files.groupId, groupId));
const storedNames = (groupId: string) => readdir(join(dir, 'files', groupId)).catch(() => []);

describe('createFile', () => {
  it('stores the bytes and returns FileInfo', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, Buffer.from('hello'));
    expect(info).toEqual({
      id: info.id,
      name: 'notes.txt',
      mime: 'text/plain',
      size: 5,
      width: null,
      height: null,
      hasPreview: false,
    });
    const stored = await storage.get(`files/${group.id}/${info.id}`);
    expect((await readAll(stored.stream)).toString()).toBe('hello');
  });

  it('sniffs a PNG declared as application/pdf', async () => {
    const { group, owner } = await setup();
    expect((await upload(group.id, owner.id, PNG, 'application/pdf')).mime).toBe('image/png');
  });

  it('keeps a declared non-image type such as SVG, with parameters and case removed', async () => {
    const { group, owner } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(group.id, owner.id, svg, 'image/svg+xml')).mime).toBe('image/svg+xml');
    expect((await upload(group.id, owner.id, svg, 'Text/HTML; charset=utf-8')).mime).toBe(
      'text/html',
    );
  });

  it('falls back to application/octet-stream for an invalid or missing declared type', async () => {
    const { group, owner } = await setup();
    const body = Buffer.from('data');
    expect((await upload(group.id, owner.id, body, 'not a type')).mime).toBe(
      'application/octet-stream',
    );
    expect((await upload(group.id, owner.id, body, null)).mime).toBe('application/octet-stream');
  });

  it('does not trust a declared image type when the bytes are not an image', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, Buffer.from('<html></html>'), 'image/png');
    expect(info.mime).toBe('application/octet-stream');
  });

  it('accepts an empty body', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, Buffer.alloc(0));
    expect(info.size).toBe(0);
  });

  it('rejects with FileTooLargeError and keeps nothing over 25 MB', async () => {
    const { group, owner } = await setup();
    const chunk = Buffer.alloc(1024 * 1024, 1);
    const body = Readable.from(Array.from({ length: 26 }, () => chunk));
    await expect(upload(group.id, owner.id, body)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await rowsOf(group.id)).toHaveLength(0);
    expect(await storedNames(group.id)).toEqual([]);
  });

  it('keeps nothing when the upload is aborted midway', async () => {
    const { group, owner } = await setup();
    async function* aborted() {
      yield Buffer.alloc(1024, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('connection lost');
    }
    await expect(upload(group.id, owner.id, Readable.from(aborted()))).rejects.toThrow();
    expect(await rowsOf(group.id)).toHaveLength(0);
    expect(await storedNames(group.id)).toEqual([]);
  });

  it('sanitizes the name itself', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, Buffer.from('x'), 'text/plain', '../a\\b.txt');
    expect(info.name).toBe('..ab.txt');
  });

  it('removes the stored object when the insert fails', async () => {
    const { group } = await setup();
    // uploadedBy references no user, so the insert violates the foreign key
    await expect(upload(group.id, randomUUID(), Buffer.from('x'))).rejects.toThrow();
    expect(await rowsOf(group.id)).toHaveLength(0);
    expect(await storedNames(group.id)).toEqual([]);
  });

  it('leaves no row when storage.put fails', async () => {
    const { group, owner } = await setup();
    const failing: Storage = {
      ...storage,
      put: () => Promise.reject(new Error('disk full')),
    };
    await expect(
      createFile(
        { db, storage: failing },
        {
          groupId: group.id,
          uploadedBy: owner.id,
          name: 'a.txt',
          declaredType: 'text/plain',
          body: Readable.from([Buffer.from('x')]),
        },
      ),
    ).rejects.toThrow('disk full');
    expect(await rowsOf(group.id)).toHaveLength(0);
  });
});

describe('createReceivedFile', () => {
  const receive = (groupId: string | null, bytes = PNG, name = 'shot.png') =>
    createReceivedFile(deps, { groupId, name, mime: 'image/png', bytes });

  it('stores the bytes as an unattached file of the group without an uploader', async () => {
    const { group } = await setup();
    const info = await receive(group.id, PNG, '../a\\b.png');
    expect(info).toMatchObject({ name: '..ab.png', mime: 'image/png', size: PNG.length });
    const row = (await getFile(db, info.id))!;
    expect(row).toMatchObject({ groupId: group.id, uploadedBy: null, attachedAt: null });
    expect(await readAll((await storage.get(row.storageKey)).stream)).toEqual(PNG);
  });

  it('stores a file of no group (a ticket without a client)', async () => {
    const info = await receive(null);
    const row = (await getFile(db, info.id))!;
    expect(row.groupId).toBeNull();
    expect((await getFilesForGroup(db, null, [info.id])).map((f) => f.id)).toEqual([info.id]);
    await deleteFiles(deps, [info.id]);
    expect(await storage.exists(row.storageKey)).toBe(false);
  });

  it('removes the stored object when the insert fails', async () => {
    // The group does not exist, so the insert violates the foreign key.
    const groupId = randomUUID();
    await expect(receive(groupId)).rejects.toThrow();
    expect(await storedNames(groupId)).toEqual([]);
  });
});

describe('attachReceivedFiles', () => {
  it('attaches unattached received files; an uploaded or attached one is rejected', async () => {
    const { group, owner } = await setup();
    const a = await createReceivedFile(deps, {
      groupId: group.id,
      name: 'a.png',
      mime: 'image/png',
      bytes: PNG,
    });
    const uploaded = await upload(group.id, owner.id, Buffer.from('u'));
    await expect(attachReceivedFiles(db, [uploaded.id])).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    await attachReceivedFiles(db, [a.id]);
    expect((await getFile(db, a.id))?.attachedAt).toBeInstanceOf(Date);
    await expect(attachReceivedFiles(db, [a.id])).rejects.toBeInstanceOf(InvalidAttachmentError);
    await attachReceivedFiles(db, []);
  });
});

describe('finance-only files (Phase 32)', () => {
  it('setFilesFinanceOnly marks the files; attachFiles then refuses them', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    const plain = await upload(group.id, owner.id, Buffer.from('b'));
    await setFilesFinanceOnly(db, [a.id]);
    await setFilesFinanceOnly(db, []);
    expect((await getFile(db, a.id))?.financeOnly).toBe(true);
    expect((await getFile(db, plain.id))?.financeOnly).toBe(false);
    // Chat, tasks, tickets and knowledge all attach through attachFiles without the option.
    await expect(attachFiles(db, group.id, [a.id], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    await expect(attachFiles(db, group.id, [a.id, plain.id], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    expect((await getFile(db, a.id))?.attachedAt).toBeNull();
  });

  it("finance's own attach takes finance-only files only", async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    const plain = await upload(group.id, owner.id, Buffer.from('b'));
    await setFilesFinanceOnly(db, [a.id]);
    await expect(
      attachFiles(db, group.id, [plain.id], owner.id, { finance: true }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    await attachFiles(db, group.id, [a.id], owner.id, { finance: true });
    expect((await getFile(db, a.id))?.attachedAt).toBeInstanceOf(Date);
  });

  it('a finance-only file is never copied into another module', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    await setFilesFinanceOnly(db, [a.id]);
    await expect(
      copyFile(deps, { fileId: a.id, groupId: group.id, userId: owner.id }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
  });
});

describe('attachFiles', () => {
  it('attaches own unattached files of the group', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    const b = await upload(group.id, owner.id, Buffer.from('b'));
    await attachFiles(db, group.id, [a.id, b.id], owner.id);
    expect((await getFile(db, a.id))?.attachedAt).toBeInstanceOf(Date);
    expect((await getFile(db, b.id))?.attachedAt).toBeInstanceOf(Date);
  });

  it("rejects another group's file", async () => {
    const { group, owner } = await setup();
    const other = await setup();
    const foreign = await upload(other.group.id, owner.id, Buffer.from('a'));
    await expect(attachFiles(db, group.id, [foreign.id], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
  });

  it("rejects another user's file", async () => {
    const { group, owner } = await setup();
    const other = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    const theirs = await upload(group.id, other.id, Buffer.from('a'));
    await expect(attachFiles(db, group.id, [theirs.id], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
  });

  it('rejects an already attached file and an unknown id', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    await attachFiles(db, group.id, [a.id], owner.id);
    await expect(attachFiles(db, group.id, [a.id], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    await expect(attachFiles(db, group.id, [randomUUID()], owner.id)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
  });

  it('counts duplicate ids once and ignores an empty list', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    await attachFiles(db, group.id, [a.id, a.id], owner.id);
    await attachFiles(db, group.id, [], owner.id);
    expect((await getFile(db, a.id))?.attachedAt).not.toBeNull();
  });

  it('keeps attached_at null when the surrounding transaction throws later', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    await expect(
      db.transaction(async (tx) => {
        await attachFiles(tx, group.id, [a.id], owner.id);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect((await getFile(db, a.id))?.attachedAt).toBeNull();
  });
});

describe('getFilesForGroup', () => {
  it("returns files in the order of ids and skips other groups' files", async () => {
    const { group, owner } = await setup();
    const other = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    const b = await upload(group.id, owner.id, Buffer.from('b'));
    const foreign = await upload(other.group.id, owner.id, Buffer.from('c'));
    const result = await getFilesForGroup(db, group.id, [b.id, foreign.id, a.id, randomUUID()]);
    expect(result.map((f) => f.id)).toEqual([b.id, a.id]);
  });

  it('returns [] for empty ids', async () => {
    const { group } = await setup();
    expect(await getFilesForGroup(db, group.id, [])).toEqual([]);
  });
});

describe('setFilePreview', () => {
  it('stores the preview and dimensions; a second call changes nothing and removes its object', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, PNG);
    const row = (await getFile(db, info.id))!;
    expect(
      await setFilePreview(deps, row, { body: Buffer.from('one'), width: 10, height: 5 }),
    ).toBe(true);
    const first = (await getFile(db, info.id))!;
    expect(first).toMatchObject({ width: 10, height: 5 });
    expect(first.previewKey).toMatch(new RegExp(`^files/${group.id}/${info.id}-preview-`));
    const stored = await storage.get(first.previewKey!);
    expect(stored.contentType).toBe('image/webp');
    expect((await readAll(stored.stream)).toString()).toBe('one');

    const stale = { ...row, previewKey: null };
    expect(
      await setFilePreview(deps, stale, { body: Buffer.from('two'), width: 20, height: 8 }),
    ).toBe(false);
    expect(await getFile(db, info.id)).toMatchObject({ previewKey: first.previewKey, width: 10 });
  });
});

describe('deleteFiles', () => {
  it('removes rows and storage objects (data and preview)', async () => {
    const { group, owner } = await setup();
    const info = await upload(group.id, owner.id, PNG);
    await setFilePreview(deps, (await getFile(db, info.id))!, {
      body: Buffer.from('p'),
      width: 1,
      height: 1,
    });
    await deleteFiles(deps, [info.id]);
    expect(await getFile(db, info.id)).toBeNull();
    expect(await storage.exists(`files/${group.id}/${info.id}`)).toBe(false);
    expect(await storage.exists(`files/${group.id}/${info.id}-preview`)).toBe(false);
    await deleteFiles(deps, []);
  });
});

describe('deleteDetachedFiles', () => {
  it('deletes detached files (rows and storage) and keeps files attached again meanwhile', async () => {
    const { group, owner } = await setup();
    const gone = await upload(group.id, owner.id, Buffer.from('gone'));
    const back = await upload(group.id, owner.id, Buffer.from('back'));
    await attachFiles(db, group.id, [gone.id, back.id], owner.id);
    await db.transaction((tx) => detachFiles(tx, [gone.id, back.id]));
    // Re-attached by the uploader between the owner's commit and its cleanup.
    await attachFiles(db, group.id, [back.id], owner.id);
    await deleteDetachedFiles(deps, [gone.id, back.id]);
    expect(await getFile(db, gone.id)).toBeNull();
    expect(await storage.exists(`files/${group.id}/${gone.id}`)).toBe(false);
    expect((await getFile(db, back.id))?.attachedAt).not.toBeNull();
    expect(await storage.exists(`files/${group.id}/${back.id}`)).toBe(true);
    await deleteDetachedFiles(deps, []);
  });
});

describe('detachFiles', () => {
  it('makes attached files unattached again', async () => {
    const { group, owner } = await setup();
    const a = await upload(group.id, owner.id, Buffer.from('a'));
    await attachFiles(db, group.id, [a.id], owner.id);
    await db.transaction((tx) => detachFiles(tx, [a.id]));
    expect((await getFile(db, a.id))?.attachedAt).toBeNull();
    await db.transaction((tx) => detachFiles(tx, []));
  });
});

describe('deleteUnattachedFiles', () => {
  it('deletes only unattached files older than the cutoff', async () => {
    const { group, owner } = await setup();
    const oldUnattached = await upload(group.id, owner.id, Buffer.from('1'));
    const oldAttached = await upload(group.id, owner.id, Buffer.from('2'));
    const fresh = await upload(group.id, owner.id, Buffer.from('3'));
    await attachFiles(db, group.id, [oldAttached.id], owner.id);
    const dayAgo = new Date(Date.now() - 25 * 3600 * 1000);
    for (const id of [oldUnattached.id, oldAttached.id]) {
      await db.update(files).set({ createdAt: dayAgo }).where(eq(files.id, id));
    }

    const count = await deleteUnattachedFiles(deps, new Date(Date.now() - 24 * 3600 * 1000));

    expect(count).toBeGreaterThanOrEqual(1); // the shared DB may hold other tests' old files
    expect(await getFile(db, oldUnattached.id)).toBeNull();
    expect(await storage.exists(`files/${group.id}/${oldUnattached.id}`)).toBe(false);
    expect(await getFile(db, oldAttached.id)).not.toBeNull();
    expect(await getFile(db, fresh.id)).not.toBeNull();
  });
});

describe('copyFile', () => {
  it('a missing source object is an invalid attachment, and leaves no row', async () => {
    const { group, owner } = await setup();
    const original = await upload(group.id, owner.id, PNG, 'image/png', 'gone.png');
    await storage.delete((await getFile(db, original.id))!.storageKey);
    // Count this group's rows only: other test files add files to the shared database meanwhile.
    const groupRows = async () =>
      (await db.select().from(files).where(eq(files.groupId, group.id))).length;
    const before = await groupRows();
    await expect(
      copyFile(deps, { fileId: original.id, groupId: group.id, userId: owner.id }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    expect(await groupRows()).toBe(before);
  });

  it('makes an unattached copy owned by the copier, with its own storage', async () => {
    const { group, owner } = await setup();
    const other = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    const original = await upload(group.id, owner.id, PNG, 'image/png', 'plan.png');
    await setFilePreview(deps, (await getFile(db, original.id))!, {
      body: Buffer.from('webp'),
      width: 3,
      height: 4,
    });
    await attachFiles(db, group.id, [original.id], owner.id);
    const originalRow = (await getFile(db, original.id))!;

    const copy = await copyFile(deps, { fileId: original.id, groupId: group.id, userId: other.id });
    const row = (await getFile(db, copy.id))!;
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      name: 'plan.png',
      mime: 'image/png',
      size: 11,
      width: 3,
      height: 4,
      hasPreview: true,
    });
    expect(row).toMatchObject({
      groupId: group.id,
      uploadedBy: other.id,
      attachedAt: null,
      name: 'plan.png',
    });
    expect(row.storageKey).toBe(`files/${group.id}/${copy.id}`);
    expect(row.previewKey).toMatch(new RegExp(`^files/${group.id}/${copy.id}-preview-`));
    expect(row.storageKey).not.toBe(originalRow.storageKey);
    expect(row.previewKey).not.toBe(originalRow.previewKey);
    expect((await readAll((await storage.get(row.storageKey)).stream)).equals(PNG)).toBe(true);
    expect((await readAll((await storage.get(row.previewKey!)).stream)).toString()).toBe('webp');

    await deleteFiles(deps, [copy.id]);
    expect(await storage.exists(originalRow.storageKey)).toBe(true);
    expect(await storage.exists(originalRow.previewKey!)).toBe(true);
    expect(await storage.exists(row.storageKey)).toBe(false);
  });

  it('throws InvalidAttachmentError for a file of another group, copying nothing', async () => {
    const { group, owner } = await setup();
    const { group: foreign, owner: foreignOwner } = await setup();
    const theirs = await upload(foreign.id, foreignOwner.id, Buffer.from('secret'));
    await expect(
      copyFile(deps, { fileId: theirs.id, groupId: group.id, userId: owner.id }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    expect(await rowsOf(group.id)).toHaveLength(0);
    expect(await storedNames(group.id)).toEqual([]);
    expect(await rowsOf(foreign.id)).toHaveLength(1);
  });

  it('throws InvalidAttachmentError for an unknown file', async () => {
    const { group, owner } = await setup();
    await expect(
      copyFile(deps, { fileId: randomUUID(), groupId: group.id, userId: owner.id }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
  });

  it('removes the copied objects when the insert fails, leaving no row', async () => {
    const { group, owner } = await setup();
    const original = await upload(group.id, owner.id, Buffer.from('hello'));
    const before = await storedNames(group.id);
    // A user that does not exist violates the uploaded_by foreign key.
    await expect(
      copyFile(deps, { fileId: original.id, groupId: group.id, userId: randomUUID() }),
    ).rejects.toThrow();
    expect(await rowsOf(group.id)).toHaveLength(1);
    expect(await storedNames(group.id)).toEqual(before);
  });
});
