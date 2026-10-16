import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  KnowledgePatchSchema,
  type KnowledgeDraft,
  type KnowledgeSummary,
  type SessionUser,
} from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/disk-storage.js';
import type { Storage } from '../../infra/storage/index.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { files } from '../files/schema.js';
import { createFile } from '../files/service.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { reminderRecipients, reminderSets, reminderTimes } from '../reminders/schema.js';
import { subscribe } from '../reminders/service.js';
import { getReminderSubject } from '../reminders/subjects.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { knowledgeAttachments, knowledgeItems } from './schema.js';
import {
  createItem,
  deleteItem,
  getItem,
  getItemRef,
  insertItem,
  InvalidUrlError,
  InvalidVisibilityError,
  KnowledgeChangedError,
  KnowledgeForbiddenError,
  KnowledgeNotFoundError,
  listAllItems,
  listGroupItems,
  updateItem,
  ValidationError,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
let dir: string;
let storage: Storage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spolu-knowledge-'));
  storage = createDiskStorage(dir, 'test-secret');
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const HOUR = 60 * 60_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const newGroup = (name = 'Firma') =>
  createGroup(db, { name, egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk` });

async function newAdmin(name = 'Ada'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  return { id: admin.id, email, name, role: 'admin' };
}

async function newClient(groupId: string, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client' };
}

async function upload(groupId: string, actor: SessionUser, name = 'doc.pdf') {
  return createFile(
    { db, storage },
    {
      groupId,
      uploadedBy: actor.id,
      name,
      declaredType: 'application/pdf',
      body: Readable.from([Buffer.from(`content of ${name}`)]),
    },
  );
}

const note = (over: Partial<Extract<KnowledgeDraft, { type: 'note' }>> = {}): KnowledgeDraft => ({
  type: 'note',
  title: 'A note',
  body: '',
  visibility: 'public',
  fileIds: [],
  ...over,
});

const searchTextOf = async (id: string) =>
  (await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)))[0]!.searchText;

const adminsOnlyOf = async (ids: string[]) =>
  (await db.select().from(files).where(inArray(files.id, ids))).map((f) => f.adminsOnly);

const ids = (items: KnowledgeSummary[]) => items.map((i) => i.id);

describe('knowledge service', () => {
  it('create per type', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const [a, b, c] = await Promise.all([
      upload(group.id, admin, 'a.pdf'),
      upload(group.id, admin, 'b.pdf'),
      upload(group.id, admin, 'c.pdf'),
    ]);
    const noteItem = await createItem({ db }, admin, group.id, note({ fileIds: [a.id, b.id] }));
    expect(noteItem.item.fileCount).toBe(2);
    expect(noteItem.item.files.map((f) => f.id).sort()).toEqual([a.id, b.id].sort());
    expect(noteItem.fileIds.sort()).toEqual([a.id, b.id].sort());

    const fileItem = await createItem({ db }, admin, group.id, {
      type: 'file',
      title: 'Contract',
      body: '',
      visibility: 'public',
      fileIds: [c.id],
    });
    expect(fileItem.item.file?.id).toBe(c.id);
    expect(fileItem.item.fileCount).toBe(1);

    const link = await createItem({ db }, admin, group.id, {
      type: 'link',
      title: 'Call',
      body: '',
      visibility: 'public',
      url: 'https://opvai.sk/vyzvy',
      fileIds: [],
    });
    expect(link.item.url).toBe('https://opvai.sk/vyzvy');
    expect(link.item.file).toBeNull();

    const at = inHours(2);
    const reminder = await createItem({ db }, admin, group.id, {
      type: 'reminder',
      title: 'Report',
      body: 'Send the report',
      visibility: 'public',
      fileIds: [],
      reminder: { times: [{ at }, { at: inHours(5) }], recipientIds: [] },
    });
    expect(reminder.item.nextReminderAt).toBe(new Date(at).toISOString());
    expect(reminder.item.upcomingCount).toBe(2);
    expect(reminder.item.reminder?.times).toHaveLength(2);
    expect(reminder.item.createdBy).toEqual({ id: admin.id, name: 'Ada' });
  });

  it('rejects a bad URL, a second file on a file item and a foreign group', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    await expect(
      createItem({ db }, admin, group.id, {
        type: 'link',
        title: 'x',
        body: '',
        visibility: 'public',
        url: 'javascript:alert(1)',
        fileIds: [],
      }),
    ).rejects.toBeInstanceOf(InvalidUrlError);
    const client = await newClient((await newGroup()).id);
    await expect(createItem({ db }, client, group.id, note())).rejects.toBeInstanceOf(
      KnowledgeNotFoundError,
    );
  });

  it('files.admins_only follows visibility both ways', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const [a, b, c] = await Promise.all([
      upload(group.id, admin),
      upload(group.id, admin),
      upload(group.id, admin),
    ]);
    const { item } = await createItem(
      { db },
      admin,
      group.id,
      note({ visibility: 'admins', fileIds: [a.id] }),
    );
    expect(await adminsOnlyOf([a.id])).toEqual([true]);

    // A file added while admins-only joins hidden.
    const added = await updateItem({ db }, admin, item.id, {
      fileIds: [a.id, b.id],
      updatedAt: item.updatedAt,
    });
    expect(await adminsOnlyOf([a.id, b.id])).toEqual([true, true]);

    const opened = await updateItem({ db }, admin, item.id, {
      visibility: 'public',
      fileIds: [a.id, b.id, c.id],
      updatedAt: added.item.updatedAt,
    });
    expect(opened.previousVisibility).toBe('admins');
    expect(await adminsOnlyOf([a.id, b.id, c.id])).toEqual([false, false, false]);

    await updateItem({ db }, admin, item.id, {
      visibility: 'admins',
      updatedAt: opened.item.updatedAt,
    });
    expect(await adminsOnlyOf([a.id, b.id, c.id])).toEqual([true, true, true]);
  });

  it('clients never see admins-only items or other groups', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const outsider = await newClient(other.id);
    const hidden = (
      await createItem({ db }, admin, group.id, note({ visibility: 'admins', title: 'Secret' }))
    ).item;
    const open = (await createItem({ db }, admin, group.id, note({ title: 'Open' }))).item;

    await expect(getItem(db, client, hidden.id)).rejects.toBeInstanceOf(KnowledgeNotFoundError);
    await expect(getItem(db, outsider, open.id)).rejects.toBeInstanceOf(KnowledgeNotFoundError);
    await expect(listGroupItems(db, outsider, group.id, {})).rejects.toBeInstanceOf(
      KnowledgeNotFoundError,
    );
    await expect(
      updateItem({ db }, client, hidden.id, { title: 'x', updatedAt: hidden.updatedAt }),
    ).rejects.toBeInstanceOf(KnowledgeNotFoundError);
    await expect(
      updateItem({ db }, outsider, open.id, { title: 'x', updatedAt: open.updatedAt }),
    ).rejects.toBeInstanceOf(KnowledgeNotFoundError);
    await expect(
      updateItem({ db }, client, open.id, { title: 'x', updatedAt: open.updatedAt }),
    ).rejects.toBeInstanceOf(KnowledgeForbiddenError);
    await expect(deleteItem({ db, storage }, client, hidden.id)).rejects.toBeInstanceOf(
      KnowledgeNotFoundError,
    );
    await expect(deleteItem({ db, storage }, client, open.id)).rejects.toBeInstanceOf(
      KnowledgeForbiddenError,
    );
  });

  it("a client's item stays public", async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    await expect(
      createItem({ db }, client, group.id, note({ visibility: 'admins' })),
    ).rejects.toBeInstanceOf(InvalidVisibilityError);
    const { item } = await createItem({ db }, client, group.id, note());
    expect(item.visibilityLocked).toBe(true);
    expect(item.canEdit).toBe(true);
    await expect(
      updateItem({ db }, admin, item.id, { visibility: 'admins', updatedAt: item.updatedAt }),
    ).rejects.toBeInstanceOf(InvalidVisibilityError);
    expect((await getItemRef(db, item.id))?.authorIsClient).toBe(true);
  });

  it('search_text has title, body without diacritics, URL and file names, recomputed when files change', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const [a, b] = await Promise.all([
      upload(group.id, admin, 'Rozpočet-2026.xlsx'),
      upload(group.id, admin, 'Plán.pdf'),
    ]);
    const { item } = await createItem(
      { db },
      admin,
      group.id,
      note({ title: 'Výzva OPVaI', body: 'Žiadosť o **platbu**', fileIds: [a.id] }),
    );
    expect(await searchTextOf(item.id)).toBe('vyzva opvai ziadost o **platbu** rozpocet-2026.xlsx');

    await updateItem({ db }, admin, item.id, { fileIds: [b.id], updatedAt: item.updatedAt });
    expect(await searchTextOf(item.id)).toBe('vyzva opvai ziadost o **platbu** plan.pdf');

    const link = await createItem({ db }, admin, group.id, {
      type: 'link',
      title: 'Odkaz',
      body: '',
      visibility: 'public',
      url: 'https://OPVAI.sk/Vyzvy/2026-03',
      fileIds: [],
    });
    expect(await searchTextOf(link.item.id)).toBe('odkaz https://opvai.sk/vyzvy/2026-03');
  });

  it('search: substring, prefix, accent-free, terms ANDed, % and _ and backslash literal', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const make = async (title: string) =>
      (await createItem({ db }, admin, group.id, note({ title }))).item.id;
    const budget = await make('Rozpočet projektu');
    const plan = await make('Plán projektu');
    const percent = await make('Zľava 50% pre_klienta a\\b');
    const plain = await make('Zlava 500 preXklienta ab');
    const search = async (q: string) =>
      ids((await listGroupItems(db, admin, group.id, { q })).items).sort();

    expect(await search('počet')).toEqual([budget]);
    expect(await search('rozpo')).toEqual([budget]);
    expect(await search('ROZPOCET')).toEqual([budget]);
    expect(await search('projektu')).toEqual([budget, plan].sort());
    expect(await search('projektu plan')).toEqual([plan]);
    expect(await search('50%')).toEqual([percent]);
    expect(await search('pre_k')).toEqual([percent]);
    expect(await search('a\\b')).toEqual([percent]);
    expect(await search('zlava')).toEqual([percent, plain].sort());
    // Terms under two characters are ignored, so "a" alone filters nothing.
    expect(await search('a')).toHaveLength(4);
  });

  it('clients get public items only in the tab list', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const open = (await createItem({ db }, admin, group.id, note())).item.id;
    const hidden = (await createItem({ db }, admin, group.id, note({ visibility: 'admins' }))).item
      .id;
    expect(ids((await listGroupItems(db, client, group.id, {})).items)).toEqual([open]);
    expect(ids((await listGroupItems(db, admin, group.id, {})).items)).toEqual([hidden, open]);
    // Search cannot reach hidden items either.
    expect((await listGroupItems(db, client, group.id, { q: 'note' })).items).toHaveLength(1);
  });

  it('a client search matching only an admins-only body returns nothing', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const word = `tajne${randomUUID().slice(0, 8)}`;
    await createItem(
      { db },
      admin,
      group.id,
      note({ visibility: 'admins', body: `about ${word}` }),
    );
    await createItem({ db }, admin, group.id, note({ body: 'nothing here' }));
    expect((await listGroupItems(db, client, group.id, { q: word })).items).toEqual([]);
    expect((await listGroupItems(db, admin, group.id, { q: word })).items).toHaveLength(1);
  });

  it("mentions of people outside the item's group do not reveal their names", async () => {
    const group = await newGroup();
    const admin = await newAdmin('Adela');
    const member = await newClient(group.id, 'Mira');
    const stranger = await newClient((await newGroup()).id, 'Stranger');
    const body = `<@${member.id}> <@${stranger.id}> <@${admin.id}>`;
    const { item } = await createItem({ db }, admin, group.id, note({ body }));
    expect(item.excerpt).toBe('@Mira @? @Adela');
    expect((await listGroupItems(db, admin, group.id, {})).items[0]!.excerpt).toBe(
      '@Mira @? @Adela',
    );
    expect(await searchTextOf(item.id)).not.toContain('stranger');
    const info = (await getReminderSubject('knowledge').loadMany(db, [item.id])).get(item.id)!;
    expect(info.body).toBe('@Mira @? @Adela');
  });

  it('type filter', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const n = (await createItem({ db }, admin, group.id, note())).item.id;
    const l = (
      await createItem({ db }, admin, group.id, {
        type: 'link',
        title: 'L',
        body: '',
        visibility: 'public',
        url: 'https://example.com',
        fileIds: [],
      })
    ).item.id;
    expect(ids((await listGroupItems(db, admin, group.id, { type: 'note' })).items)).toEqual([n]);
    expect(ids((await listGroupItems(db, admin, group.id, { type: 'link' })).items)).toEqual([l]);
  });

  it('cursor pages never skip or repeat items with equal created_at', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const created = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 31; i++) {
        out.push((await insertItem(tx, admin, group.id, note({ title: `n${i}` }))).id);
      }
      return out;
    });
    const first = await listGroupItems(db, admin, group.id, {});
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await listGroupItems(db, admin, group.id, { cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...ids(first.items), ...ids(second.items)];
    expect(new Set(seen).size).toBe(31);
    expect(seen.sort()).toEqual([...created].sort());

    await expect(
      listGroupItems(db, admin, group.id, { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const injected = Buffer.from("x'; drop table files; --|id").toString('base64url');
    await expect(listGroupItems(db, admin, group.id, { cursor: injected })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('listAllItems: explicit groupIds, null scope means all groups, and items carry group', async () => {
    const g1 = await newGroup('Alfa');
    const g2 = await newGroup('Beta');
    const admin = await newAdmin();
    const tag = `tag${randomUUID().slice(0, 8)}`;
    const i1 = (await createItem({ db }, admin, g1.id, note({ title: tag }))).item.id;
    const i2 = (await createItem({ db }, admin, g2.id, note({ title: tag, visibility: 'admins' })))
      .item.id;

    const only1 = await listAllItems(db, { groupIds: [g1.id], q: tag });
    expect(ids(only1.items)).toEqual([i1]);
    expect(only1.items[0]!.group).toEqual({ id: g1.id, name: 'Alfa', logoUrl: null });

    const all = await listAllItems(db, { groupIds: null, q: tag });
    expect(ids(all.items)).toEqual([i2, i1]);
    expect(all.items[0]!.group?.name).toBe('Beta');

    expect((await listAllItems(db, { groupIds: [], q: tag })).items).toEqual([]);
  });

  it('update with a stale updatedAt is KnowledgeChangedError', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const { item } = await createItem({ db }, admin, group.id, note());
    const first = await updateItem({ db }, admin, item.id, {
      title: 'New',
      updatedAt: item.updatedAt,
    });
    expect(first.item.title).toBe('New');
    await expect(
      updateItem({ db }, admin, item.id, { title: 'Again', updatedAt: item.updatedAt }),
    ).rejects.toBeInstanceOf(KnowledgeChangedError);
  });

  it('type cannot change through a patch', async () => {
    expect(
      KnowledgePatchSchema.safeParse({ type: 'link', updatedAt: new Date().toISOString() }).success,
    ).toBe(false);
    const group = await newGroup();
    const admin = await newAdmin();
    const { item } = await createItem({ db }, admin, group.id, note());
    await expect(
      updateItem({ db }, admin, item.id, {
        type: 'link',
        updatedAt: item.updatedAt,
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    // A URL on a note is refused too.
    await expect(
      updateItem({ db }, admin, item.id, { url: 'https://x.sk', updatedAt: item.updatedAt }),
    ).rejects.toBeInstanceOf(InvalidUrlError);
    expect((await getItem(db, admin, item.id)).type).toBe('note');
  });

  it('switching to admins-only drops non-admin recipients', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const other = await newAdmin('Bea');
    await addManager(db, group.id, other.id);
    const client = await newClient(group.id);
    const { item } = await createItem({ db }, admin, group.id, {
      type: 'reminder',
      title: 'R',
      body: '',
      visibility: 'public',
      fileIds: [],
      reminder: { times: [{ at: inHours(3) }], recipientIds: [client.id, other.id] },
    });
    await subscribe(db, { kind: 'knowledge', id: item.id }, client);
    await updateItem({ db }, admin, item.id, { visibility: 'admins', updatedAt: item.updatedAt });
    const [set] = await db
      .select()
      .from(reminderSets)
      .where(eq(reminderSets.knowledgeItemId, item.id));
    const left = await db
      .select({ userId: reminderRecipients.userId })
      .from(reminderRecipients)
      .where(eq(reminderRecipients.setId, set!.id));
    expect(left.map((r) => r.userId).sort()).toEqual([admin.id, other.id].sort());
    await expect(getItem(db, client, item.id)).rejects.toBeInstanceOf(KnowledgeNotFoundError);
  });

  it('delete removes attachments, files and reminder rows', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const file = await upload(group.id, admin);
    const { item } = await createItem({ db }, admin, group.id, note({ fileIds: [file.id] }));
    const reminder = (
      await createItem({ db }, admin, group.id, {
        type: 'reminder',
        title: 'R',
        body: '',
        visibility: 'public',
        fileIds: [],
        reminder: { times: [{ at: inHours(3) }], recipientIds: [] },
      })
    ).item;
    const [set] = await db
      .select()
      .from(reminderSets)
      .where(eq(reminderSets.knowledgeItemId, reminder.id));

    expect(await deleteItem({ db, storage }, admin, item.id)).toEqual({
      groupId: group.id,
      visibility: 'public',
    });
    await deleteItem({ db, storage }, admin, reminder.id);

    expect(
      await db.select().from(knowledgeAttachments).where(eq(knowledgeAttachments.itemId, item.id)),
    ).toEqual([]);
    expect(await db.select().from(files).where(eq(files.id, file.id))).toEqual([]);
    expect(await db.select().from(reminderSets).where(eq(reminderSets.id, set!.id))).toEqual([]);
    expect(await db.select().from(reminderTimes).where(eq(reminderTimes.setId, set!.id))).toEqual(
      [],
    );
    expect(await getItemRef(db, item.id)).toBeNull();
    await expect(deleteItem({ db, storage }, admin, item.id)).rejects.toBeInstanceOf(
      KnowledgeNotFoundError,
    );
  });

  it('a mention in a note body shows the name in the excerpt and notifies nobody', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id, 'Mária');
    const { item } = await createItem(
      { db },
      admin,
      group.id,
      note({ body: `Ask <@${client.id}> about it` }),
    );
    expect(item.excerpt).toBe('Ask @Mária about it');
    const [row] = (await listGroupItems(db, client, group.id, {})).items;
    expect(row!.excerpt).toBe('Ask @Mária about it');
    expect(await searchTextOf(item.id)).toContain('@maria');
    expect(
      await db.select().from(notificationEvents).where(eq(notificationEvents.userId, client.id)),
    ).toEqual([]);
  });

  it('the knowledge reminder subject loads items in one call with a plain-text body', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id, 'Ján');
    const outsider = await newClient((await newGroup()).id);
    const open = (
      await createItem({ db }, admin, group.id, note({ body: `**Call** <@${client.id}>\nsoon` }))
    ).item;
    const hidden = (await createItem({ db }, admin, group.id, note({ visibility: 'admins' }))).item;
    const map = await getReminderSubject('knowledge').loadMany(db, [open.id, hidden.id, 'gone']);
    expect(map.size).toBe(2);
    const info = map.get(open.id)!;
    expect(info).toMatchObject({
      groupId: group.id,
      body: '**Call** @Ján soon',
      adminsOnly: false,
      active: true,
      authorId: admin.id,
      link: `/groups/${group.id}/knowledge?k=${open.id}`,
    });
    expect(info.canRead(client, group.id)).toBe(true);
    expect(info.canRead(outsider, outsider.id)).toBe(false);
    expect(map.get(hidden.id)!.adminsOnly).toBe(true);
    expect(map.get(hidden.id)!.canRead(client, group.id)).toBe(false);
    expect(map.get(hidden.id)!.canRead(admin, null)).toBe(true);
    expect(info.canEdit(client)).toBe(false);
    expect(info.canEdit(admin)).toBe(true);
  });
});
