import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { messageAttachments, messages } from '../chat/schema.js';
import { ensureGroupChannel, ensureTaskChannel } from '../chat/service.js';
import { createFile } from '../files/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { knowledgeItems } from './schema.js';

const KEY = 'test-tickets-key-kcf-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; email: string; cookie: string };
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `k${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('knowledge: files from chats', () => {
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
  const upload = (groupId: string, uploadedBy: string, name = 'Rozpočet 2026.pdf') =>
    createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId,
        uploadedBy,
        name,
        declaredType: 'application/pdf',
        body: Readable.from([Buffer.from('%PDF-1.4 content')]),
      },
    );
  /** Sends a message with these files into the channel; returns the message. */
  async function sendFiles(
    channelId: string,
    groupId: string,
    p: Person,
    names: string[] = ['Rozpočet 2026.pdf'],
    extra: object = {},
  ): Promise<MessageDto> {
    const fileIds: string[] = [];
    for (const name of names) fileIds.push((await upload(groupId, p.id, name)).id);
    const res = await call('POST', `/api/channels/${channelId}/messages`, p.cookie, {
      clientId: randomUUID(),
      body: '',
      fileIds,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<MessageDto>();
  }
  async function ticket(g: { host: string }, email?: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Chyba', email, instance_url: `https://${g.host}.egrant.sk` },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json<{ id: string }>().id;
  }
  const ticketChat = async (ticketId: string, cookie: string) =>
    (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>();
  const list = async (cookie: string, groupId: string, query = '') => {
    const res = await call('GET', `/api/groups/${groupId}/knowledge${query}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<KnowledgePage>().items;
  };
  const chatItems = (items: KnowledgeSummary[]) => items.filter((i) => i.type === 'chat_file');

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
  const until = async (check: () => boolean, ms = 2000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('a file sent in the group chat becomes a "From chat" item of the group', async () => {
    const g = await group();
    const client = await member(g.id);
    const channel = await ensureGroupChannel(db(), g.id);
    const message = await sendFiles(channel.id, g.id, client, ['Rozpočet 2026.pdf', 'b.pdf']);

    const items = await list(client.cookie, g.id, '?type=chat_file');
    expect(items).toHaveLength(2);
    const item = items.find((i) => i.title === 'Rozpočet 2026.pdf')!;
    expect(item).toMatchObject({
      groupId: g.id,
      type: 'chat_file',
      visibility: 'public',
      folderId: null,
      folderPath: [],
      createdBy: { id: client.id },
      createdAt: message.createdAt,
      file: { id: message.attachments[0]!.id, name: 'Rozpočet 2026.pdf' },
      chat: {
        channelId: channel.id,
        messageId: message.id,
        parentId: null,
        kind: 'group',
        taskId: null,
        ticketId: null,
      },
    });
    // Search by file name, also without diacritics; the detail holds the file and is read-only.
    expect(chatItems(await list(client.cookie, g.id, '?q=rozpocet')).map((i) => i.id)).toEqual([
      item.id,
    ]);
    const detail = (
      await call('GET', `/api/knowledge/${item.id}`, client.cookie)
    ).json<KnowledgeItemDto>();
    expect(detail).toMatchObject({ canEdit: false, type: 'chat_file' });
    expect(detail.files.map((f) => f.id)).toEqual([message.attachments[0]!.id]);
  });

  it('nobody creates, edits, moves or deletes one by hand', async () => {
    const g = await group();
    const a = await admin();
    const channel = await ensureGroupChannel(db(), g.id);
    await sendFiles(channel.id, g.id, a);
    const [item] = await list(a.cookie, g.id, '?type=chat_file');
    const created = await call('POST', `/api/groups/${g.id}/knowledge`, a.cookie, {
      type: 'chat_file',
      title: 'x.pdf',
      fileIds: [item!.file!.id],
    });
    expect(created.statusCode).toBe(400);
    const patch = await call('PATCH', `/api/knowledge/${item!.id}`, a.cookie, {
      title: 'Renamed',
      updatedAt: item!.updatedAt,
    });
    expect(patch.statusCode).toBe(403);
    expect((await call('DELETE', `/api/knowledge/${item!.id}`, a.cookie)).statusCode).toBe(403);
  });

  it('a client of another group, a ziadatel and the ticket initiator never reach them', async () => {
    const g = await group();
    const other = await group();
    const outsider = await member(other.id);
    const z = await member(g.id, 'ziadatel');
    const a = await admin();
    const own = await ticket(g, z.email);
    const chat = await ticketChat(own, z.cookie);
    // The ziadatel attaches a file in their own ticket's chat; it is a group item now.
    await sendFiles(chat.id, g.id, z, ['ziadost.pdf']);
    const [item] = await list(a.cookie, g.id, '?type=chat_file&chats=all');
    expect(item).toMatchObject({ title: 'ziadost.pdf', chat: { kind: 'ticket', ticketId: own } });

    for (const p of [outsider, z]) {
      for (const url of [
        `/api/groups/${g.id}/knowledge?type=chat_file&chats=all`,
        `/api/groups/${g.id}/knowledge?q=ziadost&chats=all`,
        `/api/knowledge/${item!.id}`,
        `/api/knowledge?type=chat_file&chats=all&scope=all`,
      ]) {
        const res = await call('GET', url, p.cookie);
        expect([403, 404], `${url} ${res.statusCode}`).toContain(res.statusCode);
      }
    }
    // The other group's own list never shows it.
    expect(await list(outsider.cookie, other.id, '?type=chat_file&chats=all')).toEqual([]);
  });

  it('by default only the group chat; chats=all adds task and ticket chats', async () => {
    const g = await group();
    const client = await member(g.id);
    const groupChat = await ensureGroupChannel(db(), g.id);
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: client.id, title: 'Plán' });
    const taskChat = await ensureTaskChannel(db(), { id: taskId, groupId: g.id });
    const ticketId = await ticket(g);
    const tChat = await ticketChat(ticketId, client.cookie);
    await sendFiles(groupChat.id, g.id, client, ['group.pdf']);
    await sendFiles(taskChat.id, g.id, client, ['task.pdf']);
    await sendFiles(tChat.id, g.id, client, ['ticket.pdf']);

    const titles = (items: KnowledgeSummary[]) => items.map((i) => i.title).sort();
    expect(titles(await list(client.cookie, g.id, '?type=chat_file'))).toEqual(['group.pdf']);
    const all = await list(client.cookie, g.id, '?type=chat_file&chats=all');
    expect(titles(all)).toEqual(['group.pdf', 'task.pdf', 'ticket.pdf']);
    expect(all.find((i) => i.title === 'task.pdf')!.chat).toMatchObject({
      kind: 'task',
      taskId,
      taskTitle: 'Plán',
    });
    expect(all.find((i) => i.title === 'ticket.pdf')!.chat).toMatchObject({
      kind: 'ticket',
      ticketId,
    });
    expect(all.find((i) => i.title === 'ticket.pdf')!.chat!.ticketNumber).toEqual(
      expect.any(Number),
    );
    // A search in "All" finds the group chat's file only, unless chats=all.
    expect(titles(chatItems(await list(client.cookie, g.id, '?q=pdf')))).toEqual(['group.pdf']);
    expect(titles(chatItems(await list(client.cookie, g.id, '?q=pdf&chats=all')))).toHaveLength(3);

    // The global list follows the same rules.
    const a = await admin();
    const global = await call(
      'GET',
      `/api/knowledge?type=chat_file&clients=${g.id}&chats=all`,
      a.cookie,
    );
    expect(titles(global.json<KnowledgePage>().items)).toEqual([
      'group.pdf',
      'task.pdf',
      'ticket.pdf',
    ]);
    const defaults = await call('GET', `/api/knowledge?type=chat_file&clients=${g.id}`, a.cookie);
    expect(titles(defaults.json<KnowledgePage>().items)).toEqual(['group.pdf']);
  });

  it('the folder view never lists them, also at the top level', async () => {
    const g = await group();
    const a = await admin();
    const channel = await ensureGroupChannel(db(), g.id);
    await sendFiles(channel.id, g.id, a);
    expect(chatItems(await list(a.cookie, g.id, '?folder=root'))).toEqual([]);
    expect(chatItems(await list(a.cookie, g.id, '?folder=root&type=chat_file'))).toEqual([]);
    expect(chatItems(await list(a.cookie, g.id))).toHaveLength(1);
  });

  it('a reply carries its thread root', async () => {
    const g = await group();
    const client = await member(g.id);
    const channel = await ensureGroupChannel(db(), g.id);
    const root = await call('POST', `/api/channels/${channel.id}/messages`, client.cookie, {
      clientId: randomUUID(),
      body: 'Root',
    });
    const rootId = root.json<MessageDto>().id;
    const reply = await sendFiles(channel.id, g.id, client, ['reply.pdf'], { parentId: rootId });
    const [item] = await list(client.cookie, g.id, '?type=chat_file');
    expect(item!.chat).toMatchObject({ messageId: reply.id, parentId: rootId });
  });

  it('deleting the message removes them and tells the group live', async () => {
    const g = await group();
    const client = await member(g.id);
    const a = await admin();
    const channel = await ensureGroupChannel(db(), g.id);
    const socket = await socketOf(a.cookie);
    await socket.emitWithAck(SocketEvents.groupJoin, { groupId: g.id });
    const events = record(socket);

    const message = await sendFiles(channel.id, g.id, client, ['live.pdf']);
    await until(() => events.some((e) => e.name === KnowledgeEvents.item));
    const pushed = (
      events.find((e) => e.name === KnowledgeEvents.item)!.payload as KnowledgeItemEvent
    ).item;
    expect(pushed).toMatchObject({ type: 'chat_file', title: 'live.pdf', groupId: g.id });
    expect(pushed.chat).toMatchObject({ messageId: message.id });

    const del = await call('DELETE', `/api/messages/${message.id}`, client.cookie);
    expect(del.statusCode).toBe(204);
    await until(() => events.some((e) => e.name === KnowledgeEvents.itemDeleted));
    expect(events.find((e) => e.name === KnowledgeEvents.itemDeleted)!.payload).toEqual({
      groupId: g.id,
      id: pushed.id,
    });
    expect(await list(a.cookie, g.id, '?type=chat_file')).toEqual([]);
  });

  it('a client of another group hears nothing about the new file', async () => {
    const g = await group();
    const other = await group();
    const outsider = await member(other.id);
    const client = await member(g.id);
    const events = record(await socketOf(outsider.cookie));
    const channel = await ensureGroupChannel(db(), g.id);
    await sendFiles(channel.id, g.id, client);
    await settle();
    expect(events).toEqual([]);
  });

  it('a deleted task takes its chat files along', async () => {
    const g = await group();
    const a = await admin();
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const taskChat = await ensureTaskChannel(db(), { id: taskId, groupId: g.id });
    await sendFiles(taskChat.id, g.id, a, ['task.pdf']);
    expect(await list(a.cookie, g.id, '?type=chat_file&chats=all')).toHaveLength(1);
    expect((await call('DELETE', `/api/tasks/${taskId}`, a.cookie)).statusCode).toBe(204);
    expect(await list(a.cookie, g.id, '?type=chat_file&chats=all')).toEqual([]);
  });

  it('a ticket moved to another client moves its chat files', async () => {
    const g = await group();
    const target = await group();
    const oldClient = await member(g.id);
    const newClient = await member(target.id);
    const a = await admin();
    const ticketId = await ticket(g);
    const chat = await ticketChat(ticketId, a.cookie);
    await sendFiles(chat.id, g.id, a, ['moved.pdf']);
    const [item] = await list(a.cookie, g.id, '?type=chat_file&chats=all');

    const moved = await call('PUT', `/api/tickets/${ticketId}/group`, a.cookie, {
      groupId: target.id,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await list(oldClient.cookie, g.id, '?type=chat_file&chats=all')).toEqual([]);
    expect((await call('GET', `/api/knowledge/${item!.id}`, oldClient.cookie)).statusCode).toBe(
      404,
    );
    const now = await list(newClient.cookie, target.id, '?type=chat_file&chats=all');
    expect(now.map((i) => i.id)).toEqual([item!.id]);
  });

  it('the migration backfills files already in chats', async () => {
    const g = await group();
    const a = await admin();
    const channel = await ensureGroupChannel(db(), g.id);
    const message = await sendFiles(channel.id, g.id, a, ['Žiadosť Č.1.pdf']);
    // As before the migration: the entry is missing.
    await db().delete(knowledgeItems).where(eq(knowledgeItems.chatMessageId, message.id));
    const migration = await readFile(
      new URL('../../infra/db/migrations/0024_knowledge_chat_files.sql', import.meta.url),
      'utf8',
    );
    const backfill = migration.slice(migration.lastIndexOf('INSERT INTO'));
    await db().execute(sql.raw(backfill));
    const [item] = await list(a.cookie, g.id, '?type=chat_file');
    expect(item).toMatchObject({
      title: 'Žiadosť Č.1.pdf',
      createdAt: message.createdAt,
      chat: { messageId: message.id, kind: 'group' },
    });
    const [row] = await db()
      .select({ searchText: knowledgeItems.searchText })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, item!.id));
    expect(row!.searchText).toBe('ziadost c.1.pdf');
    // A deleted message's file is not backfilled (its attachment rows are gone).
    const live = await db()
      .select()
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(eq(messages.id, message.id));
    expect(live).toHaveLength(1);
  });

  describe('changing a chat file into a file item', () => {
    const toFile = (id: string, cookie: string, payload: object) =>
      call('POST', `/api/knowledge/${id}/to-file`, cookie, payload);

    it('the author makes it a normal file item with its own copy of the file', async () => {
      const g = await group();
      const client = await member(g.id);
      const channel = await ensureGroupChannel(db(), g.id);
      const message = await sendFiles(channel.id, g.id, client, ['Zmluva.pdf']);
      const [item] = await list(client.cookie, g.id, '?type=chat_file');
      const folder = await call('POST', `/api/groups/${g.id}/knowledge/folders`, client.cookie, {
        name: 'Zmluvy',
      });
      expect(folder.statusCode, folder.body).toBe(201);
      const folderId = folder.json<{ id: string }>().id;

      const res = await toFile(item!.id, client.cookie, {
        title: 'Zmluva o dielo',
        body: 'Podpísaná verzia',
        folderId,
        visibility: 'public',
        updatedAt: item!.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const saved = res.json<KnowledgeItemDto>();
      expect(saved).toMatchObject({
        id: item!.id,
        type: 'file',
        title: 'Zmluva o dielo',
        body: 'Podpísaná verzia',
        folderId,
        visibility: 'public',
        chat: null,
        canEdit: true,
        createdBy: { id: client.id },
        createdAt: item!.createdAt,
      });
      // Its own copy: the chat message keeps its file unchanged.
      expect(saved.files).toHaveLength(1);
      const copy = saved.files[0]!;
      expect(copy.id).not.toBe(message.attachments[0]!.id);
      expect(copy).toMatchObject({ name: 'Zmluva.pdf', size: message.attachments[0]!.size });
      expect(saved.file?.id).toBe(copy.id);

      // It left "From chat" and shows in its folder; the search finds its new title and body.
      expect(await list(client.cookie, g.id, '?type=chat_file')).toEqual([]);
      expect((await list(client.cookie, g.id, `?folder=${folderId}`)).map((i) => i.id)).toEqual([
        item!.id,
      ]);
      expect((await list(client.cookie, g.id, '?q=podpisana')).map((i) => i.id)).toEqual([
        item!.id,
      ]);
      // A normal file item now: its author edits it.
      const patch = await call('PATCH', `/api/knowledge/${item!.id}`, client.cookie, {
        title: 'Zmluva 2',
        updatedAt: saved.updatedAt,
      });
      expect(patch.statusCode, patch.body).toBe(200);

      // Deleting the message no longer touches the item or its file.
      const del = await call('DELETE', `/api/messages/${message.id}`, client.cookie);
      expect(del.statusCode).toBe(204);
      const after = await call('GET', `/api/knowledge/${item!.id}`, client.cookie);
      expect(after.statusCode).toBe(200);
      expect(after.json<KnowledgeItemDto>().files.map((f) => f.id)).toEqual([copy.id]);
      const download = await call('GET', `/api/files/${copy.id}`, client.cookie);
      expect(download.statusCode).toBe(200);
      expect(download.body).toBe('%PDF-1.4 content');
    });

    it('the chat message still shows its original attachment', async () => {
      const g = await group();
      const a = await admin();
      const channel = await ensureGroupChannel(db(), g.id);
      const message = await sendFiles(channel.id, g.id, a, ['Faktura.pdf']);
      const [item] = await list(a.cookie, g.id, '?type=chat_file');
      const res = await toFile(item!.id, a.cookie, {
        title: 'Faktúra',
        updatedAt: item!.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const rows = await db()
        .select({ fileId: messageAttachments.fileId })
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, message.id));
      expect(rows.map((r) => r.fileId)).toEqual([message.attachments[0]!.id]);
      // Defaults: the top level, public, no description.
      expect(res.json<KnowledgeItemDto>()).toMatchObject({
        folderId: null,
        visibility: 'public',
        body: '',
      });
      expect((await list(a.cookie, g.id, '?folder=root')).map((i) => i.id)).toEqual([item!.id]);
    });

    it('only the author and admins; others are refused, and it happens once', async () => {
      const g = await group();
      const other = await group();
      const author = await member(g.id);
      const colleague = await member(g.id);
      const outsider = await member(other.id);
      const z = await member(g.id, 'ziadatel');
      const channel = await ensureGroupChannel(db(), g.id);
      await sendFiles(channel.id, g.id, author, ['a.pdf']);
      const [item] = await list(author.cookie, g.id, '?type=chat_file');
      const body = { title: 'A', updatedAt: item!.updatedAt };

      expect((await toFile(item!.id, colleague.cookie, body)).statusCode).toBe(403);
      expect((await toFile(item!.id, outsider.cookie, body)).statusCode).toBe(404);
      expect((await toFile(item!.id, z.cookie, body)).statusCode).toBe(404);
      expect((await toFile(randomUUID(), author.cookie, body)).statusCode).toBe(404);
      // A stale version is 409; an empty title 400.
      const stale = await toFile(item!.id, author.cookie, {
        title: 'A',
        updatedAt: new Date(0).toISOString(),
      });
      expect(stale.statusCode).toBe(409);
      expect((await toFile(item!.id, author.cookie, { ...body, title: ' ' })).statusCode).toBe(400);
      // A client's item stays public.
      const hidden = await toFile(item!.id, author.cookie, { ...body, visibility: 'admins' });
      expect(hidden.statusCode).toBe(400);
      expect(hidden.json<{ error: string }>().error).toBe('invalid_visibility');

      const a = await admin();
      const ok = await toFile(item!.id, a.cookie, body);
      expect(ok.statusCode, ok.body).toBe(200);
      // One-way: a file item is no chat file any more.
      const again = await toFile(item!.id, a.cookie, {
        title: 'A',
        updatedAt: ok.json<KnowledgeItemDto>().updatedAt,
      });
      expect(again.statusCode).toBe(400);
      // No leftover copies: exactly one attachment row for the item.
      const [count] = await db().execute<{ n: number }>(
        sql`select count(*)::int as n from knowledge_attachments where item_id = ${item!.id}`,
      );
      expect(count!.n).toBe(1);
    });

    it('an admin may hide it from clients, and the group hears the change live', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id);
      const channel = await ensureGroupChannel(db(), g.id);
      await sendFiles(channel.id, g.id, a, ['Interné.pdf']);
      const [item] = await list(a.cookie, g.id, '?type=chat_file');

      const clientSocket = await socketOf(client.cookie);
      await clientSocket.emitWithAck(SocketEvents.groupJoin, { groupId: g.id });
      const clientEvents = record(clientSocket);
      const adminSocket = await socketOf(a.cookie);
      await adminSocket.emitWithAck(SocketEvents.groupJoin, { groupId: g.id });
      const adminEvents = record(adminSocket);

      const res = await toFile(item!.id, a.cookie, {
        title: 'Interné',
        visibility: 'admins',
        updatedAt: item!.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const fileId = res.json<KnowledgeItemDto>().files[0]!.id;

      await until(() => adminEvents.some((e) => e.name === KnowledgeEvents.item));
      const pushed = (
        adminEvents.find((e) => e.name === KnowledgeEvents.item)!.payload as KnowledgeItemEvent
      ).item;
      expect(pushed).toMatchObject({ id: item!.id, type: 'file', visibility: 'admins' });
      await until(() => clientEvents.some((e) => e.name === KnowledgeEvents.itemDeleted));
      expect(clientEvents.some((e) => e.name === KnowledgeEvents.item)).toBe(false);

      // The client no longer reads the item nor its file copy.
      expect((await call('GET', `/api/knowledge/${item!.id}`, client.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/files/${fileId}`, client.cookie)).statusCode).toBe(404);
      expect(await list(client.cookie, g.id)).toEqual([]);
    });
  });
});
