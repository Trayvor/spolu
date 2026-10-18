import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  MessagePageSchema,
  TaskSearchPageSchema,
  TicketListResponseSchema,
  type GroupChannel,
  type KnowledgeItemDto,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `x${randomUUID().replaceAll('-', '').slice(0, 20)}`;

/**
 * Phase 34 part D: the picker in the admin group attaches tasks, tickets and knowledge of every
 * client (decision 12); the same ids stay refused in a client group, and no client or žiadateľ
 * reaches the admin group or its cross-client searches.
 */
describe('cross-client attachments in the admin group (Phase 34 D)', () => {
  let test: TestApp;
  let adminGroup: string;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    adminGroup = await ensureAdminGroup(test.deps.db);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const send = (channelId: string, cookie: string, body: object) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body: '',
      clientId: randomUUID(),
      ...body,
    });

  async function group(name = 'Firma') {
    const h = host();
    return {
      ...(await createGroup(db(), { name, egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name: 'Člen' }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function ticket(instanceHost: string, email: string, subject = 'Chyba') {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject, email, instance_url: `https://${instanceHost}.egrant.sk` },
    });
    return res.json<{ id: string }>().id;
  }
  async function item(groupId: string, cookie: string, draft: object) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      body: 'Text',
      title: 'Poznámka',
      ...draft,
    });
    expect(res.statusCode).toBe(201);
    return res.json<KnowledgeItemDto>();
  }
  const groupChat = async (groupId: string, cookie: string) =>
    (await call('GET', `/api/groups/${groupId}/chat`, cookie)).json<GroupChannel>().id;
  const messagesOf = async (channelId: string, cookie: string) =>
    MessagePageSchema.parse(
      (await call('GET', `/api/channels/${channelId}/messages`, cookie)).json(),
    ).messages;

  it('an admin attaches any client’s task, ticket and knowledge in the admin group', async () => {
    const x = await group('Klient X');
    const y = await group('Klient Y');
    const a = await admin();
    const b = await admin();
    const taskX = await insertTask(db(), { groupId: x.id, createdBy: a.id, title: 'Rozpočet X' });
    const ticketY = await ticket(y.host, newEmail(), 'Chyba Y');
    // An intake from an unknown instance is a ticket without a client.
    const orphan = await ticket(host(), newEmail(), 'Bez klienta');
    const folder = (
      await call('POST', `/api/groups/${y.id}/knowledge/folders`, a.cookie, {
        name: 'Interné',
        visibility: 'admins',
      })
    ).json<{ id: string }>().id;
    // Admins-only and in an admins-only folder: still attachable among admins (decision 12).
    const note = await item(y.id, a.cookie, { visibility: 'admins', folderId: folder });

    const channelId = await groupChat(adminGroup, a.cookie);
    const res = await send(channelId, a.cookie, {
      taskIds: [taskX],
      ticketIds: [ticketY, orphan],
      knowledgeIds: [note.id],
    });
    expect(res.statusCode).toBe(201);
    const sent = res.json<MessageDto>();
    expect(sent.attachedTasks).toMatchObject([{ id: taskX, available: true, groupId: x.id }]);
    expect(sent.attachedTickets).toMatchObject([
      { id: ticketY, available: true, groupId: y.id, subject: 'Chyba Y' },
      { id: orphan, available: true, groupId: null },
    ]);
    expect(sent.knowledge).toMatchObject([
      { id: note.id, available: true, title: 'Poznámka', folderPath: ['Interné'] },
    ]);

    // Another admin reads the same live cards.
    const [m] = await messagesOf(channelId, b.cookie);
    expect(m!.attachedTasks).toMatchObject([{ id: taskX, available: true }]);
    expect(m!.attachedTickets.map((t) => t.available)).toEqual([true, true]);
    expect(m!.knowledge).toMatchObject([{ id: note.id, available: true }]);
  });

  it('the same ids are refused in a client group', async () => {
    const x = await group('Klient X');
    const y = await group('Klient Y');
    const a = await admin();
    const taskX = await insertTask(db(), { groupId: x.id, createdBy: a.id });
    const ticketX = await ticket(x.host, newEmail());
    const orphan = await ticket(host(), newEmail());
    const noteX = await item(x.id, a.cookie, { visibility: 'public' });
    const channelId = await groupChat(y.id, a.cookie);
    for (const body of [{ taskIds: [taskX] }, { ticketIds: [ticketX] }, { ticketIds: [orphan] }]) {
      const res = await send(channelId, a.cookie, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    }
    const res = await send(channelId, a.cookie, { knowledgeIds: [noteX.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_knowledge_item' });
  });

  it('no client or žiadateľ reaches the admin group or the cross-client searches', async () => {
    const x = await group();
    const a = await admin();
    const client = await member(x.id, 'client');
    const ziadatel = await member(x.id, 'ziadatel');
    const taskX = await insertTask(db(), { groupId: x.id, createdBy: a.id });
    const channelId = await groupChat(adminGroup, a.cookie);
    for (const person of [client, ziadatel]) {
      const sent = await send(channelId, person.cookie, { taskIds: [taskX] });
      expect([403, 404]).toContain(sent.statusCode);
      expect(
        (await call('GET', `/api/channels/${channelId}/messages`, person.cookie)).statusCode,
      ).toBeGreaterThanOrEqual(403);
      expect((await call('GET', '/api/tasks/search', person.cookie)).statusCode).toBe(403);
      expect(
        (await call('GET', `/api/tasks/search?clients=${x.id}`, person.cookie)).statusCode,
      ).toBe(403);
      expect((await call('GET', '/api/tickets/global?q=chyba', person.cookie)).statusCode).toBe(
        403,
      );
      expect((await call('GET', '/api/knowledge?scope=all', person.cookie)).statusCode).toBe(403);
    }
  });

  it('GET /api/tasks/search lists every client’s tasks, filtered by clients and title', async () => {
    const x = await group('Klient X');
    const y = await group('Klient Y');
    const a = await admin();
    const tag = randomUUID().slice(0, 8);
    const openX = await insertTask(db(), { groupId: x.id, createdBy: a.id, title: `${tag} X` });
    const doneX = await insertTask(db(), {
      groupId: x.id,
      createdBy: a.id,
      title: `${tag} X hotová`,
      done: true,
    });
    const openY = await insertTask(db(), { groupId: y.id, createdBy: a.id, title: `${tag} Y` });
    // Through the API: the admin group's board is shared by every test file, and `insertTask`'s
    // positions are not ones the board's own inserts can follow.
    const created = await call('POST', `/api/groups/${adminGroup}/tasks`, a.cookie, {
      title: `${tag} interná`,
    });
    expect(created.statusCode).toBe(201);
    const inAdmin = created.json<{ id: string }>().id;

    const search = async (qs: string) => {
      const res = await call('GET', `/api/tasks/search?${qs}`, a.cookie);
      expect(res.statusCode).toBe(200);
      return TaskSearchPageSchema.parse(res.json());
    };
    // Every group, open ones first.
    const all = await search(`q=${tag}`);
    expect(
      all.items
        .map((t) => t.id)
        .slice(0, 3)
        .sort(),
    ).toEqual([openX, openY, inAdmin].sort());
    expect(all.items.at(-1)!.id).toBe(doneX);
    expect(all.items.find((t) => t.id === openY)!.groupId).toBe(y.id);
    // Only the chosen clients (the admin group is one of them when chosen).
    const onlyX = await search(`q=${tag}&clients=${x.id},${adminGroup}`);
    expect(onlyX.items.map((t) => t.id)).toEqual([inAdmin, openX, doneX]);
    // Keyset pages with the cursor; a cursor not made here is a 400.
    expect(onlyX.next).toBeNull();
    const bad = await call('GET', '/api/tasks/search?after=nope', a.cookie);
    expect(bad.statusCode).toBe(400);
    expect((await call('GET', '/api/tasks/search?q=a', a.cookie)).statusCode).toBe(400);
  });

  it('GET /api/tickets/global searches every client, a chosen one or those without', async () => {
    const x = await group('Klient X');
    const y = await group('Klient Y');
    await admin();
    const a = await admin();
    const tag = randomUUID().slice(0, 8);
    const tx = await ticket(x.host, newEmail(), `${tag} X`);
    const ty = await ticket(y.host, newEmail(), `${tag} Y`);
    const orphan = await ticket(host(), newEmail(), `${tag} nikto`);
    const list = async (qs: string) => {
      const res = await call('GET', `/api/tickets/global?${qs}`, a.cookie);
      expect(res.statusCode).toBe(200);
      return TicketListResponseSchema.parse(res.json())
        .items.map((t) => t.id)
        .sort();
    };
    expect(await list(`scope=all&q=${tag}`)).toEqual([tx, ty, orphan].sort());
    expect(await list(`clients=${x.id}&q=${tag}`)).toEqual([tx]);
    expect(await list(`scope=none&q=${tag}`)).toEqual([orphan]);
  });
});
