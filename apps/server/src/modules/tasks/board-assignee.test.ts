import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardDonePage, BoardDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://t${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

/** 2026-10-19 (owner request): the group board's Assignee filter (`assignee=me|none|<id>`). */
describe('board assignee filter', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const get = (url: string, cookie: string) =>
    test.app.inject({ method: 'GET', url, headers: { cookie } });

  async function setup() {
    const g = await createGroup(db(), {
      name: `Firma ${randomUUID().slice(0, 6)}`,
      egrantUrl: newUrl(),
    });
    const adminEmail = newEmail();
    const a = await addAdmin(db(), { email: adminEmail, name: 'Ad Min' });
    const c = await createUnverifiedClient(db(), newEmail(), 'Klient');
    await addMembership(db(), c.id, g.id, 'client');
    const admin = { ...a, cookie: await loginAs(test.app, adminEmail) };
    const client = { ...c, cookie: await loginAs(test.app, c.email) };
    const mk = (title: string, assignees: string[], done = false) =>
      insertTask(db(), { groupId: g.id, createdBy: a.id, title, assignees, done });
    await mk('admin', [a.id]);
    await mk('client', [c.id]);
    await mk('both', [a.id, c.id]);
    await mk('nobody', []);
    await mk('done admin', [a.id], true);
    await mk('done nobody', [], true);
    return { g, admin, client };
  }
  const titles = (board: BoardDto) => board.tasks.map((t) => t.title).sort();

  it('an id, me and none filter the board and the Completed count', async () => {
    const { g, admin, client } = await setup();
    const board = async (q: string, cookie = client.cookie) => {
      const res = await get(`/api/groups/${g.id}/board?${q}`, cookie);
      expect(res.statusCode).toBe(200);
      return res.json<BoardDto>();
    };
    expect(titles(await board(''))).toHaveLength(6);
    const ofAdmin = await board(`assignee=${admin.id}`);
    expect(titles(ofAdmin)).toEqual(['admin', 'both', 'done admin']);
    expect(ofAdmin.done.total).toBe(1);
    // `me` is the viewer: the client here, the admin there.
    expect(titles(await board('assignee=me'))).toEqual(['both', 'client']);
    expect(titles(await board('assignee=me', admin.cookie))).toEqual([
      'admin',
      'both',
      'done admin',
    ]);
    const none = await board('assignee=none');
    expect(titles(none)).toEqual(['done nobody', 'nobody']);
    expect(none.done.total).toBe(1);
  });

  it('combines with the project filter and keeps to the Completed column’s next page', async () => {
    const { g, admin, client } = await setup();
    expect(
      titles(
        (await get(`/api/groups/${g.id}/board?project=none&assignee=none`, client.cookie)).json(),
      ),
    ).toEqual(['done nobody', 'nobody']);
    for (let i = 0; i < 16; i++) {
      await insertTask(db(), {
        groupId: g.id,
        createdBy: admin.id,
        title: `d${i}`,
        done: true,
        assignees: [admin.id],
      });
    }
    const first = (
      await get(`/api/groups/${g.id}/board?assignee=${admin.id}`, client.cookie)
    ).json<BoardDto>();
    expect(first.done.total).toBe(17);
    const more = await get(
      `/api/groups/${g.id}/board/done?after=${encodeURIComponent(first.done.next!)}&assignee=${admin.id}`,
      client.cookie,
    );
    expect(more.statusCode).toBe(200);
    const page = more.json<BoardDonePage>();
    expect(page.tasks).toHaveLength(2);
    expect(page.tasks.every((t) => t.assignees.some((p) => p.id === admin.id))).toBe(true);
  });

  it('an over-long assignee is 400', async () => {
    const { g, client } = await setup();
    const res = await get(`/api/groups/${g.id}/board?assignee=${'x'.repeat(101)}`, client.cookie);
    expect(res.statusCode).toBe(400);
  });
});
