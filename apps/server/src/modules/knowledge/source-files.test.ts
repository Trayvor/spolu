import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  KnowledgeEvents,
  SocketEvents,
  type GroupChannel,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgePage,
  type KnowledgeSummary,
  type TaskDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFile } from '../files/service.js';
import { files } from '../files/schema.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { knowledgeItems } from './schema.js';

const KEY = 'test-tickets-key-ktf-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; email: string; cookie: string };
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `k${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const PDF = Buffer.from('%PDF-1.4 content');

describe('knowledge: files from tickets and tasks (2026-10-22)', () => {
  let test: TestApp;
  let baseUrl = '';
  const sockets: Socket[] = [];
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function group() {
    const h = host();
    const g = await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` });
    return { ...g, host: h };
  }
  async function admin(): Promise<Person> {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { id: a.id, email, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel' = 'client'): Promise<Person> {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name: 'Klient' }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { id: c.id, email: c.email, cookie: await loginAs(test.app, c.email) };
  }
  const upload = async (groupId: string, uploadedBy: string, name: string) =>
    (
      await createFile(
        { db: db(), storage: test.deps.storage },
        {
          groupId,
          uploadedBy,
          name,
          declaredType: 'application/pdf',
          body: Readable.from([PDF]),
        },
      )
    ).id;
  /** A task with these files attached on its card, through the API. */
  async function task(groupId: string, p: Person, names: string[], title = 'Rozpočet') {
    const fileIds: string[] = [];
    for (const name of names) fileIds.push(await upload(groupId, p.id, name));
    const res = await call('POST', `/api/groups/${groupId}/tasks`, p.cookie, { title, fileIds });
    expect(res.statusCode, res.body).toBe(201);
    return { ...res.json<TaskDto>(), fileIds };
  }
  /** A ticket made by hand with these files. */
  async function manualTicket(groupId: string, p: Person, names: string[]) {
    const fileIds: string[] = [];
    for (const name of names) fileIds.push(await upload(groupId, p.id, name));
    const res = await call('POST', '/api/tickets', p.cookie, {
      groupId,
      subject: 'Chyba vo formulári',
      fileIds,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string; number: number }>();
  }
  /** A ticket from the eGrant intake with files; `instance` null leaves it without a client. */
  async function intakeTicket(instance: string | null, email: string | undefined, names: string[]) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Z eGrantu',
        email,
        instance_url: instance ?? `https://${host()}.unknown.sk`,
        files: names.map((name) => ({ name, content_base64: PDF.toString('base64') })),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  }
  const list = async (cookie: string, groupId: string, query = '') => {
    const res = await call('GET', `/api/groups/${groupId}/knowledge${query}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<KnowledgePage>().items;
  };
  const titles = (items: KnowledgeSummary[]) => items.map((i) => i.title).sort();
  const ofType = (items: KnowledgeSummary[], type: string) => items.filter((i) => i.type === type);

  async function socketOf(cookie: string): Promise<Socket> {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    return socket;
  }
  function record(socket: Socket) {
    const events: { name: string; payload: unknown }[] = [];
    socket.onAny((name: string, payload: unknown) => {
      if (name.startsWith('knowledge:')) events.push({ name, payload });
    });
    return events;
  }
  const until = async (check: () => boolean, ms = 25_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const settle = () =>
    Promise.all(
      sockets.filter((s) => s.connected).map((s) => s.timeout(25_000).emitWithAck('system:ping')),
    );

  describe('task files', () => {
    it('a file attached to a task card becomes a "From task" item of the group', async () => {
      const g = await group();
      const client = await member(g.id);
      const t = await task(g.id, client, ['Plán.pdf', 'b.pdf'], 'Rozpočet 2026');

      const items = await list(client.cookie, g.id, '?type=task_file');
      expect(titles(items)).toEqual(['Plán.pdf', 'b.pdf']);
      const item = items.find((i) => i.title === 'Plán.pdf')!;
      expect(item).toMatchObject({
        groupId: g.id,
        type: 'task_file',
        visibility: 'public',
        folderId: null,
        createdBy: { id: client.id },
        file: { name: 'Plán.pdf' },
        chat: null,
        origin: { kind: 'task', id: t.id, title: 'Rozpočet 2026', number: null },
      });
      expect(t.fileIds).toContain(item.file!.id);
      // Search by file name finds it; the folder view never lists it.
      expect(ofType(await list(client.cookie, g.id, '?q=plan'), 'task_file')).toHaveLength(1);
      expect(ofType(await list(client.cookie, g.id, '?folder=root'), 'task_file')).toEqual([]);
      // The detail holds the file, is read-only, and its author may save it as a file.
      const detail = (
        await call('GET', `/api/knowledge/${item.id}`, client.cookie)
      ).json<KnowledgeItemDto>();
      expect(detail).toMatchObject({ canEdit: false, canConvert: true, type: 'task_file' });
      expect(detail.files.map((f) => f.id)).toEqual([item.file!.id]);
    });

    it('nobody edits or deletes one by hand', async () => {
      const g = await group();
      const a = await admin();
      await task(g.id, a, ['x.pdf']);
      const [item] = await list(a.cookie, g.id, '?type=task_file');
      const patch = await call('PATCH', `/api/knowledge/${item!.id}`, a.cookie, {
        title: 'Renamed',
        updatedAt: item!.updatedAt,
      });
      expect(patch.statusCode).toBe(403);
      expect((await call('DELETE', `/api/knowledge/${item!.id}`, a.cookie)).statusCode).toBe(403);
      const created = await call('POST', `/api/groups/${g.id}/knowledge`, a.cookie, {
        type: 'task_file',
        title: 'x.pdf',
        fileIds: [item!.file!.id],
      });
      expect(created.statusCode).toBe(400);
    });

    it('follows the card: an added file appears, a removed one and a deleted task go', async () => {
      const g = await group();
      const a = await admin();
      const t = await task(g.id, a, ['one.pdf']);
      const second = await upload(g.id, a.id, 'two.pdf');
      const added = await call('PATCH', `/api/tasks/${t.id}`, a.cookie, {
        fileIds: [...t.fileIds, second],
        updatedAt: t.updatedAt,
      });
      expect(added.statusCode, added.body).toBe(200);
      expect(titles(await list(a.cookie, g.id, '?type=task_file'))).toEqual(['one.pdf', 'two.pdf']);

      const removed = await call('PATCH', `/api/tasks/${t.id}`, a.cookie, {
        fileIds: [second],
        updatedAt: added.json<TaskDto>().updatedAt,
      });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(titles(await list(a.cookie, g.id, '?type=task_file'))).toEqual(['two.pdf']);

      expect((await call('DELETE', `/api/tasks/${t.id}`, a.cookie)).statusCode).toBe(204);
      expect(await list(a.cookie, g.id, '?type=task_file')).toEqual([]);
    });

    it('a new task file is pushed live to the group, never to another client', async () => {
      const g = await group();
      const other = await group();
      const client = await member(g.id);
      const outsider = await member(other.id);
      const socket = await socketOf(client.cookie);
      await socket.emitWithAck(SocketEvents.groupJoin, { groupId: g.id });
      const events = record(socket);
      const outsiderEvents = record(await socketOf(outsider.cookie));

      await task(g.id, client, ['live.pdf']);
      await until(() => events.some((e) => e.name === KnowledgeEvents.item));
      const pushed = (
        events.find((e) => e.name === KnowledgeEvents.item)!.payload as KnowledgeItemEvent
      ).item;
      expect(pushed).toMatchObject({ type: 'task_file', title: 'live.pdf', groupId: g.id });
      await settle();
      expect(outsiderEvents).toEqual([]);
    });

    it('the admin group\'s task files are "Only eGrant"', async () => {
      const adminGroup = await ensureAdminGroup(db());
      const a = await admin();
      await task(adminGroup, a, ['interne.pdf']);
      const [item] = ofType(await list(a.cookie, adminGroup, '?q=interne'), 'task_file');
      expect(item).toMatchObject({ visibility: 'admins', title: 'interne.pdf' });
    });

    it('an admins-only file stays admins-only', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id);
      const fileId = await upload(g.id, a.id, 'tajne.pdf');
      await db().update(files).set({ adminsOnly: true }).where(eq(files.id, fileId));
      const res = await call('POST', `/api/groups/${g.id}/tasks`, a.cookie, {
        title: 'Interná',
        fileIds: [fileId],
      });
      expect(res.statusCode, res.body).toBe(201);
      const [item] = await list(a.cookie, g.id, '?type=task_file');
      expect(item).toMatchObject({ visibility: 'admins' });
      expect(await list(client.cookie, g.id, '?type=task_file')).toEqual([]);
      expect((await call('GET', `/api/knowledge/${item!.id}`, client.cookie)).statusCode).toBe(404);
    });
  });

  describe('ticket files', () => {
    it('a file uploaded with a ticket becomes a "From ticket" item of its client', async () => {
      const g = await group();
      const client = await member(g.id);
      const ticket = await manualTicket(g.id, client, ['Snímka.pdf']);
      const [item] = await list(client.cookie, g.id, '?type=ticket_file');
      expect(item).toMatchObject({
        type: 'ticket_file',
        visibility: 'public',
        title: 'Snímka.pdf',
        createdBy: { id: client.id },
        chat: null,
        origin: {
          kind: 'ticket',
          id: ticket.id,
          number: ticket.number,
          title: 'Chyba vo formulári',
        },
      });
      expect(ofType(await list(client.cookie, g.id, '?folder=root'), 'ticket_file')).toEqual([]);
    });

    it('intake files: none without a client; they appear when it gets one and move with it', async () => {
      const g = await group();
      const target = await group();
      const a = await admin();
      const client = await member(g.id);
      const targetClient = await member(target.id);
      const ticketId = await intakeTicket(null, newEmail(), ['priloha.pdf']);
      const [count] = await db().execute<{ n: number }>(
        sql`select count(*)::int as n from knowledge_items where source_ticket_id = ${ticketId}`,
      );
      expect(count!.n).toBe(0);

      const assigned = await call('PUT', `/api/tickets/${ticketId}/group`, a.cookie, {
        groupId: g.id,
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      const [item] = await list(client.cookie, g.id, '?type=ticket_file');
      expect(item).toMatchObject({ title: 'priloha.pdf', origin: { id: ticketId } });

      const moved = await call('PUT', `/api/tickets/${ticketId}/group`, a.cookie, {
        groupId: target.id,
      });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(await list(client.cookie, g.id, '?type=ticket_file')).toEqual([]);
      expect((await call('GET', `/api/knowledge/${item!.id}`, client.cookie)).statusCode).toBe(404);
      const now = await list(targetClient.cookie, target.id, '?type=ticket_file');
      expect(now.map((i) => i.id)).toEqual([item!.id]);
    });

    it('an intake file is authored by the initiator', async () => {
      const g = await group();
      const a = await admin();
      const email = newEmail();
      await intakeTicket(`https://${g.host}.egrant.sk`, email, ['ziadost.pdf']);
      const [item] = await list(a.cookie, g.id, '?type=ticket_file');
      const [initiator] = await db()
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      expect(item).toMatchObject({ title: 'ziadost.pdf', createdBy: { id: initiator!.id } });
    });

    it('the ticket chat files stay "From chat": no duplicates', async () => {
      const g = await group();
      const client = await member(g.id);
      const ticket = await manualTicket(g.id, client, ['own.pdf']);
      const chat = (
        await call('GET', `/api/tickets/${ticket.id}/chat`, client.cookie)
      ).json<GroupChannel>();
      const fileId = await upload(g.id, client.id, 'in-chat.pdf');
      const sent = await call('POST', `/api/channels/${chat.id}/messages`, client.cookie, {
        clientId: randomUUID(),
        body: '',
        fileIds: [fileId],
      });
      expect(sent.statusCode, sent.body).toBe(201);
      expect(titles(await list(client.cookie, g.id, '?type=ticket_file'))).toEqual(['own.pdf']);
      expect(titles(await list(client.cookie, g.id, '?type=chat_file&chats=all'))).toEqual([
        'in-chat.pdf',
      ]);
    });

    it('a client of another group, a ziadatel and its own initiator never reach them', async () => {
      const g = await group();
      const other = await group();
      const outsider = await member(other.id);
      const z = await member(g.id, 'ziadatel');
      const a = await admin();
      await intakeTicket(`https://${g.host}.egrant.sk`, z.email, ['ziadost.pdf']);
      const t = await task(g.id, a, ['uloha.pdf']);
      expect(t.id).toBeTruthy();
      const items = await list(a.cookie, g.id, '?type=ticket_file,task_file');
      expect(titles(items)).toEqual(['uloha.pdf', 'ziadost.pdf']);

      for (const p of [outsider, z]) {
        for (const url of [
          `/api/groups/${g.id}/knowledge?type=ticket_file,task_file`,
          `/api/groups/${g.id}/knowledge?q=pdf`,
          ...items.map((i) => `/api/knowledge/${i.id}`),
          `/api/knowledge?type=ticket_file,task_file&scope=all`,
        ]) {
          const res = await call('GET', url, p.cookie);
          expect([403, 404], `${url} ${res.statusCode}`).toContain(res.statusCode);
        }
      }
      expect(await list(outsider.cookie, other.id, '?type=ticket_file,task_file')).toEqual([]);
      // The global search never lists them (as chat files).
      const search = await call('GET', '/api/search?q=ziadost', a.cookie);
      expect(search.statusCode, search.body).toBe(200);
      expect(search.body).not.toContain(items.find((i) => i.title === 'ziadost.pdf')!.id);
    });

    it('the global list offers them to admins by type', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id);
      await manualTicket(g.id, client, ['t.pdf']);
      await task(g.id, client, ['u.pdf']);
      const res = await call(
        'GET',
        `/api/knowledge?type=ticket_file,task_file&clients=${g.id}`,
        a.cookie,
      );
      expect(res.statusCode).toBe(200);
      expect(titles(res.json<KnowledgePage>().items)).toEqual(['t.pdf', 'u.pdf']);
    });
  });

  describe('saving one as a file', () => {
    const toFile = (id: string, cookie: string, payload: object) =>
      call('POST', `/api/knowledge/${id}/to-file`, cookie, payload);

    it('a task file becomes a normal file item that outlives the card', async () => {
      const g = await group();
      const client = await member(g.id);
      const t = await task(g.id, client, ['Zmluva.pdf']);
      const [item] = await list(client.cookie, g.id, '?type=task_file');
      const res = await toFile(item!.id, client.cookie, {
        title: 'Zmluva o dielo',
        updatedAt: item!.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const saved = res.json<KnowledgeItemDto>();
      expect(saved).toMatchObject({
        id: item!.id,
        type: 'file',
        title: 'Zmluva o dielo',
        folderId: null,
        origin: null,
        canEdit: true,
        canConvert: false,
      });
      const copy = saved.files[0]!;
      expect(copy.id).not.toBe(item!.file!.id);
      // It left "From task" and is in the top level of the folder view now.
      expect(await list(client.cookie, g.id, '?type=task_file')).toEqual([]);
      expect((await list(client.cookie, g.id, '?folder=root')).map((i) => i.id)).toEqual([
        item!.id,
      ]);
      // Deleting the task no longer touches it or its file.
      expect((await call('DELETE', `/api/tasks/${t.id}`, client.cookie)).statusCode).toBe(204);
      const after = await call('GET', `/api/knowledge/${item!.id}`, client.cookie);
      expect(after.statusCode).toBe(200);
      const download = await call('GET', `/api/files/${copy.id}`, client.cookie);
      expect(download.statusCode).toBe(200);
      expect(download.body).toBe(PDF.toString());
    });

    it('a ticket file: its author and admins only, once', async () => {
      const g = await group();
      const other = await group();
      const author = await member(g.id);
      const colleague = await member(g.id);
      const outsider = await member(other.id);
      const z = await member(g.id, 'ziadatel');
      await manualTicket(g.id, author, ['a.pdf']);
      const [item] = await list(author.cookie, g.id, '?type=ticket_file');
      const body = { title: 'A', updatedAt: item!.updatedAt };
      expect((await toFile(item!.id, colleague.cookie, body)).statusCode).toBe(403);
      expect((await toFile(item!.id, outsider.cookie, body)).statusCode).toBe(404);
      expect((await toFile(item!.id, z.cookie, body)).statusCode).toBe(404);
      const colleagueDetail = (
        await call('GET', `/api/knowledge/${item!.id}`, colleague.cookie)
      ).json<KnowledgeItemDto>();
      expect(colleagueDetail.canConvert).toBe(false);

      const a = await admin();
      const ok = await toFile(item!.id, a.cookie, body);
      expect(ok.statusCode, ok.body).toBe(200);
      const again = await toFile(item!.id, a.cookie, {
        title: 'A',
        updatedAt: ok.json<KnowledgeItemDto>().updatedAt,
      });
      expect(again.statusCode).toBe(400);
    });
  });

  it('the migration backfills files already on tickets and tasks', async () => {
    const g = await group();
    const a = await admin();
    const t = await task(g.id, a, ['Úloha Č.1.pdf'], 'Stará úloha');
    const ticket = await manualTicket(g.id, a, ['Tiket.pdf']);
    const unassigned = await intakeTicket(null, undefined, ['nikto.pdf']);
    // As before the migration: the entries are missing.
    await db().execute(
      sql`delete from knowledge_items where source_task_id = ${t.id} or source_ticket_id = ${ticket.id}`,
    );
    const dir = new URL('../../infra/db/migrations/', import.meta.url);
    const name = (await readdir(dir)).find((f) => f.endsWith('_knowledge_ticket_task_files.sql'));
    const migration = await readFile(new URL(name!, dir), 'utf8');
    const backfill = migration.slice(migration.indexOf('-- Backfill'));
    for (const statement of backfill.split('--> statement-breakpoint')) {
      if (statement.trim()) await db().execute(sql.raw(statement));
    }
    const items = await list(a.cookie, g.id, '?type=ticket_file,task_file');
    expect(titles(items)).toEqual(['Tiket.pdf', 'Úloha Č.1.pdf']);
    expect(items.find((i) => i.type === 'task_file')).toMatchObject({
      createdBy: { id: a.id },
      origin: { kind: 'task', id: t.id },
    });
    const [row] = await db()
      .select({ searchText: knowledgeItems.searchText })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.sourceTaskId, t.id));
    expect(row!.searchText).toBe('uloha c.1.pdf');
    // A ticket without a client still has none.
    const [count] = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from knowledge_items where source_ticket_id = ${unassigned}`,
    );
    expect(count!.n).toBe(0);
  });
});
