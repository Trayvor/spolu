import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { KnowledgeDraft, SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { draftKnowledge } from './draft-sources.js';
import { createFolder } from './folders.js';
import { knowledgeItems } from './schema.js';
import { createItem } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
let admin: SessionUser;
let adminGroup: string;

beforeAll(async () => {
  adminGroup = await ensureAdminGroup(db);
  const email = `${randomUUID()}@example.com`;
  const a = await addAdmin(db, { email, name: 'Ada' });
  admin = { id: a.id, email, name: 'Ada', role: 'admin', finance: false };
});
afterAll(async () => {
  await Promise.all([close(), counting.close()]);
});

/** A word no other test writes, so the admin group's shared items never interfere. */
const word = () =>
  `zq${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://d${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
const note = (over: Partial<KnowledgeDraft> = {}): KnowledgeDraft =>
  ({
    type: 'note',
    title: 'A note',
    body: '',
    visibility: 'public',
    fileIds: [],
    folderId: null,
    ...over,
  }) as KnowledgeDraft;
const add = async (groupId: string, over: Partial<KnowledgeDraft>) =>
  (await createItem({ db }, admin, groupId, note(over))).item.id;
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('draftKnowledge', () => {
  it("finds a public note of the ticket's group by a stemmed term", async () => {
    const group = await newGroup();
    const w = word();
    const id = await add(group.id, { title: `Zmena rozpočtu ${w}`, body: 'Postup **krok** 1' });
    const items = await draftKnowledge(db, { groupId: group.id, terms: [w], limit: 5 });
    expect(items).toEqual([
      {
        id,
        type: 'note',
        title: `Zmena rozpočtu ${w}`,
        text: 'Postup **krok** 1',
        fromAdminGroup: false,
      },
    ]);
    const stemmed = await draftKnowledge(db, { groupId: group.id, terms: ['rozpoc'], limit: 5 });
    expect(ids(stemmed)).toContain(id);
  });

  it("never returns another client's item", async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const w = word();
    await add(b.id, { title: `Zmena ${w}` });
    expect(await draftKnowledge(db, { groupId: a.id, terms: [w], limit: 5 })).toEqual([]);
  });

  it('skips admins-only items and items in an admins-only folder', async () => {
    const group = await newGroup();
    const w = word();
    await add(group.id, { title: `Interné ${w}`, visibility: 'admins' });
    const folder = await createFolder(db, admin, group.id, {
      name: 'Len eGrant',
      parentId: null,
      visibility: 'admins',
    });
    await add(group.id, { title: `V priečinku ${w}`, folderId: folder.id });
    const open = await createFolder(db, admin, group.id, {
      name: 'Verejné',
      parentId: null,
      visibility: 'public',
    });
    const shown = await add(group.id, { title: `Verejné ${w}`, folderId: open.id });
    expect(ids(await draftKnowledge(db, { groupId: group.id, terms: [w], limit: 5 }))).toEqual([
      shown,
    ]);
  });

  it('includes a shareable admin-group item with fromAdminGroup true, not one in an admins-only folder', async () => {
    const group = await newGroup();
    const w = word();
    const shared = await add(adminGroup, { title: `Spoločný postup ${w}` });
    const folder = await createFolder(db, admin, adminGroup, {
      name: `Interné ${w}`,
      parentId: null,
      visibility: 'admins',
    });
    await add(adminGroup, { title: `Interný postup ${w}`, folderId: folder.id });
    const items = await draftKnowledge(db, { groupId: group.id, terms: [w], limit: 5 });
    expect(items.map((i) => [i.id, i.fromAdminGroup])).toEqual([[shared, true]]);
  });

  it('a ticket without a client uses only admin-group items', async () => {
    const group = await newGroup();
    const w = word();
    await add(group.id, { title: `Klientsky ${w}` });
    const shared = await add(adminGroup, { title: `Spoločný ${w}` });
    expect(ids(await draftKnowledge(db, { groupId: null, terms: [w], limit: 5 }))).toEqual([
      shared,
    ]);
  });

  it('skips meetings and reminders, and adds a link URL', async () => {
    const group = await newGroup();
    const w = word();
    const link = await createItem({ db }, admin, group.id, {
      type: 'link',
      title: `Odkaz ${w}`,
      body: '',
      url: 'https://example.com/navod',
      visibility: 'public',
      fileIds: [],
      folderId: null,
    } as KnowledgeDraft);
    for (const type of ['reminder', 'meeting'] as const) {
      await db.insert(knowledgeItems).values({
        id: randomUUID(),
        groupId: group.id,
        type,
        title: `${type} ${w}`,
        createdBy: admin.id,
        searchText: `${type} ${w}`,
      });
    }
    const items = await draftKnowledge(db, { groupId: group.id, terms: [w], limit: 5 });
    expect(items).toEqual([
      {
        id: link.item.id,
        type: 'link',
        title: `Odkaz ${w}`,
        text: 'URL: https://example.com/navod',
        fromAdminGroup: false,
      },
    ]);
  });

  it('orders by the number of matching terms, then the newest update, and keeps the limit', async () => {
    const group = await newGroup();
    const [w1, w2] = [word(), word()];
    const made: string[] = [];
    for (let i = 0; i < 6; i++) made.push(await add(group.id, { title: `Položka ${i} ${w1}` }));
    const both = await add(group.id, { title: `Obe ${w1}`, body: w2 });
    // The oldest single match is touched last, so it is the newest of the one-term matches.
    await db
      .update(knowledgeItems)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(knowledgeItems.id, made[0]!));
    const items = await draftKnowledge(db, { groupId: group.id, terms: [w1, w2], limit: 5 });
    expect(items).toHaveLength(5);
    expect(items[0]!.id).toBe(both);
    expect(items[1]!.id).toBe(made[0]);
  });

  it('runs no query without terms', async () => {
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    expect(await draftKnowledge(counting.db, { groupId: 'x', terms: [], limit: 5 })).toEqual([]);
    expect(counting.count()).toBe(0);
  });
});
