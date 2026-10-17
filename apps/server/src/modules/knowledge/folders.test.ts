import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  KNOWLEDGE_FOLDER_LIMITS,
  type KnowledgeDraft,
  type KnowledgeFolderDto,
  type SessionUser,
} from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/disk-storage.js';
import type { Storage } from '../../infra/storage/index.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { files } from '../files/schema.js';
import { createFile } from '../files/service.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { addMember, createGroup } from '../groups/service.js';
import { reminderRecipients, reminderSets } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import {
  FolderLimitError,
  InvalidFolderError,
  InvalidVisibilityError,
  KnowledgeFolderNotFoundError,
} from './errors.js';
import { createFolder, deleteFolder, listFolders, updateFolder } from './folders.js';
import { knowledgeFolders, knowledgeItems } from './schema.js';
import { createItem, getItem, listGroupItems } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
let dir: string;
let storage: Storage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spolu-folders-'));
  storage = createDiskStorage(dir, 'test-secret');
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });

async function newAdmin(name = 'Ada'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  return { id: admin.id, email, name, role: 'admin', finance: false };
}

async function newClient(groupId: string, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client', finance: false };
}

const note = (folderId: string | null, over: Partial<KnowledgeDraft> = {}): KnowledgeDraft =>
  ({
    type: 'note',
    title: 'A note',
    body: '',
    visibility: 'public',
    fileIds: [],
    folderId,
    ...over,
  }) as KnowledgeDraft;

const folder = (
  actor: SessionUser,
  groupId: string,
  name: string,
  parentId: string | null = null,
  visibility: 'public' | 'admins' = 'public',
) => createFolder(db, actor, groupId, { name, parentId, visibility });

const names = (folders: KnowledgeFolderDto[]) => folders.map((f) => f.name);

const rowOf = async (id: string) =>
  (await db.select().from(knowledgeFolders).where(eq(knowledgeFolders.id, id)))[0]!;

const itemRow = async (id: string) =>
  (await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)))[0]!;

describe('knowledge folders', () => {
  it('lists the folders by name; a client never sees admins-only ones', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    await folder(admin, group.id, 'čaj');
    await folder(admin, group.id, 'cesta');
    await folder(admin, group.id, 'Alfa');
    const secret = await folder(admin, group.id, 'beta', null, 'admins');
    await folder(admin, group.id, 'Inner', secret.id);

    expect(names(await listFolders(db, admin, group.id))).toEqual([
      'Alfa',
      'beta',
      'cesta',
      'čaj',
      'Inner',
    ]);
    expect(names(await listFolders(db, client, group.id))).toEqual(['Alfa', 'cesta', 'čaj']);
  });

  it('a client of another group or a ziadatel cannot open the folders', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const stranger = await newClient(other.id);
    await expect(listFolders(db, stranger, group.id)).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    // A ziadatel membership never opens the group's knowledge.
    const ziadatel = await newClient(other.id, 'Zia');
    await addMembership(db, ziadatel.id, group.id, 'ziadatel');
    await expect(listFolders(db, ziadatel, group.id)).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    await expect(folder(stranger, group.id, 'X')).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
  });

  it('create: inside an admins-only folder it is admins-only; a client cannot ask for it', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    const inner = await folder(admin, group.id, 'Inner', secret.id, 'public');
    expect(inner.visibility).toBe('admins');
    expect(inner.parentId).toBe(secret.id);

    await expect(folder(client, group.id, 'Mine', null, 'admins')).rejects.toBeInstanceOf(
      InvalidVisibilityError,
    );
    await expect(folder(client, group.id, 'Mine', secret.id)).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    const mine = await folder(client, group.id, 'Mine');
    expect(mine.visibility).toBe('public');
  });

  it('create: a parent of another group is not found', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const admin = await newAdmin();
    const foreign = await folder(admin, other.id, 'Foreign');
    await expect(folder(admin, group.id, 'X', foreign.id)).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
  });

  it('a client cannot rename, move into or delete a hidden folder', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    const open = await folder(client, group.id, 'Open');
    await expect(updateFolder(db, client, secret.id, { name: 'X' })).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    await expect(updateFolder(db, client, open.id, { parentId: secret.id })).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    await expect(deleteFolder(db, client, secret.id)).rejects.toBeInstanceOf(
      KnowledgeFolderNotFoundError,
    );
    await expect(
      updateFolder(db, client, open.id, { visibility: 'admins' }),
    ).rejects.toBeInstanceOf(InvalidVisibilityError);
    expect((await rowOf(secret.id)).name).toBe('Secret');
  });

  it('a client renames and moves public folders', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const a = await folder(client, group.id, 'A');
    const b = await folder(client, group.id, 'B');
    const { folder: moved } = await updateFolder(db, client, b.id, { name: 'Bee', parentId: a.id });
    expect(moved).toMatchObject({ name: 'Bee', parentId: a.id, visibility: 'public' });
    const { folder: back } = await updateFolder(db, client, b.id, { parentId: null });
    expect(back.parentId).toBeNull();
  });

  it('refuses moving a folder into itself or below itself', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const a = await folder(admin, group.id, 'A');
    const b = await folder(admin, group.id, 'B', a.id);
    const c = await folder(admin, group.id, 'C', b.id);
    await expect(updateFolder(db, admin, a.id, { parentId: a.id })).rejects.toBeInstanceOf(
      InvalidFolderError,
    );
    await expect(updateFolder(db, admin, a.id, { parentId: c.id })).rejects.toBeInstanceOf(
      InvalidFolderError,
    );
    expect((await rowOf(a.id)).parentId).toBeNull();
  });

  it('making a folder admins-only hides everything inside it, files and recipients too', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const other = await newAdmin('Bea');
    await addManager(db, group.id, other.id);
    const client = await newClient(group.id);
    const a = await folder(admin, group.id, 'A');
    const b = await folder(client, group.id, 'B', a.id);
    const file = await createFile(
      { db, storage },
      {
        groupId: group.id,
        uploadedBy: admin.id,
        name: 'doc.pdf',
        declaredType: 'application/pdf',
        body: Readable.from([Buffer.from('x')]),
      },
    );
    const withFile = await createItem({ db }, admin, group.id, note(b.id, { fileIds: [file.id] }));
    const reminder = await createItem({ db }, admin, group.id, {
      type: 'reminder',
      title: 'R',
      body: '',
      visibility: 'public',
      fileIds: [],
      folderId: a.id,
      reminder: { times: [{ at: inHours(3) }], recipientIds: [client.id, other.id] },
    });
    const outside = await createItem({ db }, admin, group.id, note(null));

    const result = await updateFolder(db, admin, a.id, { visibility: 'admins' });
    expect(result.previousVisibility).toBe('public');
    expect(result.folder.visibility).toBe('admins');
    expect(result.hiddenItemIds.sort()).toEqual([withFile.item.id, reminder.item.id].sort());

    expect((await rowOf(b.id)).visibility).toBe('admins');
    expect((await itemRow(withFile.item.id)).visibility).toBe('admins');
    expect((await itemRow(outside.item.id)).visibility).toBe('public');
    const [fileRow] = await db.select().from(files).where(eq(files.id, file.id));
    expect(fileRow!.adminsOnly).toBe(true);
    const [set] = await db
      .select()
      .from(reminderSets)
      .where(eq(reminderSets.knowledgeItemId, reminder.item.id));
    const left = await db
      .select({ userId: reminderRecipients.userId })
      .from(reminderRecipients)
      .where(eq(reminderRecipients.setId, set!.id));
    expect(left.map((r) => r.userId).sort()).toEqual([admin.id, other.id].sort());

    expect(names(await listFolders(db, client, group.id))).toEqual([]);
    const page = await listGroupItems(db, client, group.id, {});
    expect(page.items.map((i) => i.id)).toEqual([outside.item.id]);
  });

  it("a client's item anywhere inside blocks making the folder admins-only", async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const a = await folder(admin, group.id, 'A');
    const b = await folder(admin, group.id, 'B', a.id);
    const c = await folder(admin, group.id, 'C', b.id);
    const { item } = await createItem({ db }, client, group.id, note(c.id));
    await expect(updateFolder(db, admin, a.id, { visibility: 'admins' })).rejects.toBeInstanceOf(
      InvalidVisibilityError,
    );
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    await expect(updateFolder(db, admin, a.id, { parentId: secret.id })).rejects.toBeInstanceOf(
      InvalidVisibilityError,
    );
    expect((await rowOf(a.id)).visibility).toBe('public');
    expect((await rowOf(a.id)).parentId).toBeNull();
    expect((await rowOf(c.id)).visibility).toBe('public');
    expect((await itemRow(item.id)).visibility).toBe('public');
  });

  it('moving a folder into an admins-only folder makes it admins-only with its contents', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const a = await folder(admin, group.id, 'A');
    const { item } = await createItem({ db }, admin, group.id, note(a.id));
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    const result = await updateFolder(db, admin, a.id, { parentId: secret.id });
    expect(result.folder.visibility).toBe('admins');
    expect(result.hiddenItemIds).toEqual([item.id]);
    expect((await itemRow(item.id)).visibility).toBe('admins');
  });

  it('inside an admins-only folder nothing becomes public', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    const inner = await folder(admin, group.id, 'Inner', secret.id);
    await expect(
      updateFolder(db, admin, inner.id, { visibility: 'public' }),
    ).rejects.toBeInstanceOf(InvalidVisibilityError);
  });

  it('making a folder public again changes only the folder', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const secret = await folder(admin, group.id, 'Secret', null, 'admins');
    const inner = await folder(admin, group.id, 'Inner', secret.id);
    const { item } = await createItem({ db }, admin, group.id, note(secret.id));
    expect(item.visibility).toBe('admins');
    const result = await updateFolder(db, admin, secret.id, { visibility: 'public' });
    expect(result.folder.visibility).toBe('public');
    expect(result.hiddenItemIds).toEqual([]);
    expect((await rowOf(inner.id)).visibility).toBe('admins');
    expect((await itemRow(item.id)).visibility).toBe('admins');
  });

  it('delete moves the folders and items inside one level up', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const a = await folder(admin, group.id, 'A');
    const b = await folder(admin, group.id, 'B', a.id);
    const c = await folder(admin, group.id, 'C', b.id);
    const { item } = await createItem({ db }, admin, group.id, note(b.id));
    const deleted = await deleteFolder(db, admin, b.id);
    expect(deleted).toEqual({ groupId: group.id, id: b.id, visibility: 'public' });
    expect((await rowOf(c.id)).parentId).toBe(a.id);
    expect((await itemRow(item.id)).folderId).toBe(a.id);
    expect(await db.select().from(knowledgeFolders).where(eq(knowledgeFolders.id, b.id))).toEqual(
      [],
    );
  });

  it("a client's delete moves hidden contents up without showing them", async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const open = await folder(client, group.id, 'Open');
    const hidden = await folder(admin, group.id, 'Hidden', open.id, 'admins');
    const { item } = await createItem(
      { db },
      admin,
      group.id,
      note(open.id, { visibility: 'admins' }),
    );
    await deleteFolder(db, client, open.id);
    expect(names(await listFolders(db, client, group.id))).toEqual([]);
    expect((await listGroupItems(db, client, group.id, { folder: null })).items).toEqual([]);
    expect((await rowOf(hidden.id)).parentId).toBeNull();
    expect((await getItem(db, admin, item.id)).folderId).toBeNull();
  });

  it(`a group has at most ${KNOWLEDGE_FOLDER_LIMITS.perGroup} folders`, async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    await db.insert(knowledgeFolders).values(
      Array.from({ length: KNOWLEDGE_FOLDER_LIMITS.perGroup }, (_, n) => ({
        id: randomUUID(),
        groupId: group.id,
        name: `F${n}`,
        createdBy: admin.id,
      })),
    );
    await expect(folder(admin, group.id, 'One more')).rejects.toBeInstanceOf(FolderLimitError);
    const ids = (
      await db
        .select({ id: knowledgeFolders.id })
        .from(knowledgeFolders)
        .where(eq(knowledgeFolders.groupId, group.id))
    ).map((r) => r.id);
    expect(ids).toHaveLength(KNOWLEDGE_FOLDER_LIMITS.perGroup);
    await db.delete(knowledgeFolders).where(inArray(knowledgeFolders.id, ids));
  });
});
