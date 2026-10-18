import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardDto, KnowledgeFolderDto, KnowledgeItemDto, TaskDetailDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { getGlobalBoard } from '../home/global-board.js';
import { getBoard } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** The board cards' `knowledgeCount`: the linked items the task's readers may open. */
describe('knowledge count on task cards', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function setup() {
    const h = `k${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const group = await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` });
    const email = `${randomUUID()}@example.com`;
    const admin = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(admin.id);
    return { group, admin, cookie: await loginAs(test.app, email) };
  }
  async function item(groupId: string, cookie: string, over: object = {}) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      title: 'Postup',
      body: 'Text',
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeItemDto>();
  }
  async function task(groupId: string, cookie: string, knowledgeIds: string[]) {
    const res = await call('POST', `/api/groups/${groupId}/tasks`, cookie, {
      title: 'Úloha',
      knowledgeIds,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<TaskDetailDto>();
  }
  const countsOnBoard = async (groupId: string, cookie: string) => {
    const res = await call('GET', `/api/groups/${groupId}/board`, cookie);
    return new Map(res.json<BoardDto>().tasks.map((t) => [t.id, t.knowledgeCount]));
  };

  it('counts the shareable linked items, on the group board and the global board', async () => {
    const { group, admin, cookie } = await setup();
    const a = await item(group.id, cookie);
    const b = await item(group.id, cookie, { title: 'Kontakty' });
    const two = await task(group.id, cookie, [a.id, b.id]);
    const none = await task(group.id, cookie, []);
    expect(two.knowledgeCount).toBe(2);

    const counts = await countsOnBoard(group.id, cookie);
    expect(counts.get(two.id)).toBe(2);
    expect(counts.get(none.id)).toBe(0);

    const global = await getGlobalBoard(db(), {
      clientIds: [group.id],
      viewerId: admin.id,
      assignee: 'anyone',
      urgent: false,
      mine: false,
      completed: false,
      today: '2026-10-20',
    });
    const cards = global.columns.flatMap((c) => c.items);
    expect(cards.find((t) => t.id === two.id)?.knowledgeCount).toBe(2);
    expect(cards.find((t) => t.id === none.id)?.knowledgeCount).toBe(0);
  });

  it('leaves out items that became admins-only or sit in an admins-only folder', async () => {
    const { group, cookie } = await setup();
    const keep = await item(group.id, cookie);
    const hidden = await item(group.id, cookie, { title: 'Skryté' });
    const inFolder = await item(group.id, cookie, { title: 'V priečinku' });
    const t = await task(group.id, cookie, [keep.id, hidden.id, inFolder.id]);
    expect((await countsOnBoard(group.id, cookie)).get(t.id)).toBe(3);

    const latest = (
      await call('GET', `/api/knowledge/${hidden.id}`, cookie)
    ).json<KnowledgeItemDto>();
    const patched = await call('PATCH', `/api/knowledge/${hidden.id}`, cookie, {
      visibility: 'admins',
      updatedAt: latest.updatedAt,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((await countsOnBoard(group.id, cookie)).get(t.id)).toBe(2);

    const folder = (
      await call('POST', `/api/groups/${group.id}/knowledge/folders`, cookie, {
        name: 'Interné',
        visibility: 'admins',
      })
    ).json<KnowledgeFolderDto>();
    const moved = await call('PATCH', `/api/knowledge/${inFolder.id}`, cookie, {
      folderId: folder.id,
      updatedAt: inFolder.updatedAt,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((await countsOnBoard(group.id, cookie)).get(t.id)).toBe(1);
  });

  it('adds no queries per task to the group board', async () => {
    const counting = createCountingDb();
    try {
      const plain = await setup();
      await task(plain.group.id, plain.cookie, []);
      const linked = await setup();
      const n = await item(linked.group.id, linked.cookie);
      for (let i = 0; i < 4; i++) await task(linked.group.id, linked.cookie, [n.id]);
      await getBoard(counting.db, plain.group.id);
      await getBoard(counting.db, linked.group.id);
      counting.reset();
      await getBoard(counting.db, plain.group.id);
      const without = counting.count();
      counting.reset();
      await getBoard(counting.db, linked.group.id);
      expect(counting.count()).toBe(without);
    } finally {
      await counting.close();
    }
  });
});
