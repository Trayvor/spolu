import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mentionToken, type FileInfo } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { mcpAuditLog } from './schema.js';

/** The tools' behaviour (spec §5): each reads and writes through the routes, as the user. */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Obj = Record<string, unknown>;

describe('MCP tools', () => {
  let test: TestApp;
  let groupId: string;
  let admin: { id: string; token: string; cookie: string };
  let other: { id: string; token: string };
  let client: { id: string; name: string };
  let adminEmail: string;
  const admins: string[] = [];

  const tool = async (name: string, args: Obj = {}, token = admin.token) => {
    const res = await callTool(test.app, token, name, args);
    return res;
  };
  const ok = async (name: string, args: Obj = {}, token = admin.token) => {
    const res = await tool(name, args, token);
    expect({ name, isError: res.isError, json: res.isError ? res.json : null }).toEqual({
      name,
      isError: false,
      json: null,
    });
    return res.json as Obj;
  };

  beforeAll(async () => {
    test = await buildTestApp();
    const db = test.deps.db;
    const email = `${randomUUID()}@example.com`;
    adminEmail = email;
    const a = await addAdmin(db, { email, name: 'Ada Admin' });
    const b = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Bob Admin' });
    admins.push(a.id, b.id);
    admin = { id: a.id, token: await mcpToken(db, a.id), cookie: await loginAs(test.app, email) };
    other = { id: b.id, token: await mcpToken(db, b.id) };
    const g = await createGroup(db, {
      name: 'Firma MCP',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    groupId = g.id;
    const c = await createUnverifiedClient(db, `${randomUUID()}@example.com`, 'Cyril Klient');
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db, c.id, groupId, 'client');
    client = { id: c.id, name: 'Cyril Klient' };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('reads people and groups', async () => {
    expect(await ok('whoami')).toMatchObject({ id: admin.id, role: 'admin', scope: 'write' });
    const groups = (await ok('list_groups', { q: 'firma mcp' })) as {
      groups: Array<{ id: string }>;
    };
    expect(groups.groups.map((g) => g.id)).toContain(groupId);
    const first = (await ok('list_groups')) as { groups: unknown[]; total: number };
    expect(first.groups.length).toBe(Math.min(first.total, 200));
    expect(await ok('get_group', { groupId })).toMatchObject({ id: groupId, name: 'Firma MCP' });
    const people = (await ok('list_group_people', { groupId })) as unknown as Array<Obj>;
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([client.id, admin.id]));
    const members = (await ok('list_group_members', { groupId })) as unknown as Array<Obj>;
    expect(JSON.stringify(members)).toContain(client.id);
    await ok('list_group_members', { groupId, which: 'requesters' });
    // Filtered by the admin's own (unique) email: the shared test database holds many admins.
    const mine = (await ok('list_admins', { q: adminEmail.toUpperCase() })) as {
      admins: Obj[];
      total: number;
    };
    expect(mine).toMatchObject({ total: 1, nextOffset: null });
    expect(mine.admins).toEqual([
      { id: admin.id, name: 'Ada Admin', email: adminEmail, role: 'admin', substitution: null },
    ]);
    const allAdmins = (await ok('list_admins')) as { admins: unknown[]; total: number };
    expect(allAdmins.admins.length).toBe(Math.min(allAdmins.total, 200));
  });

  it('an unknown or malformed id answers like the app (404, 400)', async () => {
    const missing = await tool('get_task', { taskId: randomUUID() });
    expect(missing.json).toEqual({ status: 404, error: 'not_found' });
    const bad = await tool('get_group', { groupId: 'a b' });
    expect(bad.json).toMatchObject({ status: 400, error: 'validation_failed' });
  });

  it('creates, edits and completes a task, audited without content', async () => {
    const created = await ok('create_task', {
      groupId,
      task: { title: 'Napísať správu', description: 'Tajný obsah', assigneeIds: [client.id] },
    });
    const taskId = created.id as string;
    expect(created).toMatchObject({ title: 'Napísať správu', groupId });
    expect(created).not.toHaveProperty('askTime');

    const edited = await ok('update_task', {
      taskId,
      changes: { title: 'Napísať záverečnú správu', dueDate: '2026-12-01', urgent: true },
    });
    expect(edited).toMatchObject({ title: 'Napísať záverečnú správu', dueDate: '2026-12-01' });
    const stale = await tool('update_task', {
      taskId,
      changes: { title: 'x', updatedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(stale.json).toMatchObject({ status: 409, error: 'task_changed' });
    // The route's own rule: an admin assigns any active admin, even one who manages nothing here,
    // but never someone outside the group.
    const anyAdmin = await ok('update_task', { taskId, changes: { assigneeIds: [other.id] } });
    expect(anyAdmin.assignees).toEqual([{ id: other.id, name: 'Bob Admin' }]);
    const notPickable = await tool('update_task', {
      taskId,
      changes: { assigneeIds: [randomUUID()] },
    });
    expect(notPickable.json).toMatchObject({ status: 400, error: 'invalid_assignee' });

    const board = (await ok('get_board', { groupId })) as {
      buckets: Array<{ id: string; kind: string }>;
      tasks: Array<{ id: string }>;
    };
    expect(board.tasks.map((t) => t.id)).toContain(taskId);
    const done = board.buckets.find((b) => b.kind === 'done')!;
    const moved = await ok('move_task', { taskId, bucketId: done.id, afterTaskId: null });
    expect(moved.completedAt).not.toBeNull();
    const detail = await ok('get_task', { taskId });
    expect(detail).toMatchObject({ description: 'Tajný obsah', bucketId: done.id });
    expect(
      ((await ok('search_tasks', { groupId, q: 'záverečnú' })) as { items: Obj[] }).items.map(
        (t) => t.id,
      ),
    ).toContain(taskId);
    await ok('list_all_tasks', { clients: 'all' });
    await ok('list_my_tasks');
    await ok('list_unseen_tasks', { groupId });

    const audit = await test.deps.db
      .select()
      .from(mcpAuditLog)
      .where(eq(mcpAuditLog.userId, admin.id));
    expect(audit.map((r) => [r.tool, r.targetId, r.ok])).toEqual(
      expect.arrayContaining([
        ['create_task', taskId, true],
        ['update_task', taskId, true],
        ['update_task', taskId, false],
        ['move_task', taskId, true],
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain('Tajný');
  });

  it('sends chat messages and thread replies as the user', async () => {
    const channel = await ok('get_chat_channel', { groupId });
    const channelId = channel.id as string;
    const sent = await ok('send_message', {
      channelId,
      body: `Ahoj <@${client.id}>, **pozri** úlohu`,
    });
    expect(sent).toMatchObject({ body: expect.stringContaining('Ahoj'), author: { id: admin.id } });
    expect(sent.mentions).toEqual([client.id]);
    const reply = await ok('send_message', { channelId, body: 'V threade', parentId: sent.id });
    expect(reply.parentId).toBe(sent.id);
    const page = (await ok('list_messages', { channelId, limit: 10 })) as { messages: Obj[] };
    expect(JSON.stringify(page)).toContain(sent.id as string);
    const thread = await ok('get_thread', { messageId: sent.id });
    expect(JSON.stringify(thread)).toContain('V threade');
    await ok('list_unread_chats');
    const empty = await tool('send_message', { channelId, body: '   ' });
    expect(empty.json).toMatchObject({ status: 400, error: 'validation_failed' });
    const foreign = await tool('get_chat_channel', { groupId: randomUUID() });
    expect(foreign.json).toMatchObject({ status: 404 });
  });

  it("search_messages pages through a user's messages", async () => {
    const channel = await ok('get_chat_channel', { groupId });
    const w = `zq${randomUUID().replaceAll('-', '').replace(/[0-9]/g, 'x').slice(0, 10)}`;
    const sent: string[] = [];
    for (const text of ['prvá', 'druhá', 'tretia']) {
      sent.push(
        (await ok('send_message', { channelId: channel.id, body: `${w} ${text}` })).id as string,
      );
    }
    const first = (await ok('search_messages', { q: w, limit: 2 })) as {
      hits: { id: string; snippet: string }[];
      nextCursor: string | null;
    };
    expect(first.hits).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (await ok('search_messages', {
      q: w,
      limit: 2,
      cursor: first.nextCursor,
      groupId,
    })) as { hits: { id: string }[]; nextCursor: string | null };
    expect(second.nextCursor).toBeNull();
    expect([...first.hits, ...second.hits].map((h) => h.id).sort()).toEqual([...sent].sort());
    // Newest first: the last sent is the first hit.
    expect(first.hits[0]).toMatchObject({ id: sent[2], snippet: `${w} tretia` });
  });

  it('creates, changes, assigns and answers a ticket', async () => {
    const created = await ok('create_ticket', {
      ticket: {
        groupId,
        subject: 'Nefunguje export',
        body: 'Pri exporte padá chyba.',
        requesterEmail: `${randomUUID()}@example.com`,
        requesterName: 'Žiadateľ Test',
      },
    });
    const ticketId = created.id as string;
    expect(await ok('get_ticket', { ticketId })).toMatchObject({ subject: 'Nefunguje export' });
    const changed = await ok('update_ticket', { ticketId, changes: { status: 'in_progress' } });
    expect(changed).toMatchObject({ status: 'in_progress' });
    expect(changed).not.toHaveProperty('askTime');
    const candidates = (await ok('list_ticket_assignee_candidates', {
      ticketId,
    })) as unknown as Array<{ id: string }>;
    expect(JSON.stringify(candidates)).toContain(admin.id);
    await ok('set_ticket_assignee', { ticketId, userId: admin.id, assigned: true });
    const assigned = await ok('get_ticket', { ticketId });
    expect(JSON.stringify(assigned.assignees)).toContain(admin.id);
    await ok('set_ticket_assignee', { ticketId, userId: admin.id, assigned: false });
    const answer = await ok('reply_to_ticket', { ticketId, body: 'Pozrieme sa na to.' });
    expect(answer).toMatchObject({ body: 'Pozrieme sa na to.' });
    const chat = await ok('get_chat_channel', { ticketId });
    const messages = await ok('list_messages', { channelId: chat.id });
    expect(JSON.stringify(messages)).toContain('Pozrieme sa na to.');
    const list = (await ok('list_tickets', { groupId })) as { items: Obj[] };
    expect(list.items.map((t) => t.id)).toContain(ticketId);
    await ok('list_tickets', { scope: 'all', status: 'all' });
  });

  it('writes and reads knowledge, admins-only items included', async () => {
    const note = await ok('create_knowledge_item', {
      groupId,
      item: { type: 'note', title: 'Postup', body: 'Krok 1', visibility: 'admins' },
    });
    const itemId = note.id as string;
    const edited = await ok('update_knowledge_item', { itemId, changes: { body: 'Krok 1, 2' } });
    expect(edited).toMatchObject({ body: 'Krok 1, 2', visibility: 'admins' });
    expect(await ok('get_knowledge_item', { itemId })).toMatchObject({ title: 'Postup' });
    // Another admin reads an admins-only item (every admin does, in the app too).
    expect(await ok('get_knowledge_item', { itemId }, other.token)).toMatchObject({ id: itemId });
    const list = (await ok('list_knowledge', { groupId })) as { items: Obj[] };
    expect(list.items.map((i) => i.id)).toContain(itemId);
    await ok('list_knowledge', { scope: 'all', q: 'Postup' });
    // 2026-10-22: the ticket and task files are listable by type.
    await ok('list_knowledge', { groupId, type: 'ticket_file,task_file' });
    await ok('list_knowledge_folders', { groupId });
    await ok('list_meetings');
    // Only its author or an admin edits it: the client is neither, but the tools are admins' anyway.
    const link = await tool('create_knowledge_item', {
      groupId,
      item: { type: 'link', title: 'x', url: 'not a url' },
    });
    expect(link.json).toMatchObject({ status: 400 });
  });

  it('writes and reads projects and events', async () => {
    const project = await ok('create_project', { groupId, project: { name: 'IROP 2026' } });
    const projectId = project.id as string;
    expect(
      await ok('update_project', { projectId, changes: { description: 'Výzva' } }),
    ).toMatchObject({ description: 'Výzva' });
    const event = await ok('create_project_event', {
      projectId,
      event: { name: 'Podanie', occursOn: '2026-11-30' },
    });
    const eventId = event.id as string;
    expect(
      await ok('update_project_event', { eventId, changes: { name: 'Podanie žiadosti' } }),
    ).toMatchObject({ name: 'Podanie žiadosti' });
    expect(await ok('get_project', { projectId })).toMatchObject({ name: 'IROP 2026' });
    expect(await ok('get_project_event', { eventId })).toMatchObject({ projectId });
    const list = (await ok('list_projects', { groupId })) as { items: Obj[] };
    expect(list.items.map((p) => p.id)).toContain(projectId);
    const taken = await tool('create_project', { groupId, project: { name: 'IROP 2026' } });
    expect(taken.json).toMatchObject({ status: 409 });
  });

  it('reads the home cards and bulk email', async () => {
    await ok('get_home_counts');
    await ok('list_mentions');
    await ok('list_upcoming_reminders');
    // The notification centre (UX review F2): the route's page, as the user.
    expect(await ok('list_notifications')).toMatchObject({ items: expect.any(Array) });
    expect((await tool('list_notifications', { cursor: 'nonsense' })).json).toMatchObject({
      status: 400,
    });
    await ok('list_bulk_campaigns');
    const missing = await tool('get_bulk_campaign', { campaignId: randomUUID() });
    expect(missing.json).toMatchObject({ status: 404 });
  });

  it('list_mentions includes a mention in a description, linked to its subject', async () => {
    await addManager(test.deps.db, groupId, admin.id);
    const project = await ok(
      'create_project',
      { groupId, project: { name: `Mentioned ${randomUUID().slice(0, 6)}` } },
      other.token,
    );
    await ok(
      'update_project',
      { projectId: project.id, changes: { description: `Pozri ${mentionToken(admin.id)}` } },
      other.token,
    );
    const mentions = (await ok('list_mentions')) as { items: Obj[] };
    expect(mentions.items).toContainEqual(
      expect.objectContaining({
        source: 'description',
        subjectKind: 'project',
        subjectId: project.id,
        title: project.name,
        groupId,
        authorName: 'Bob Admin',
      }),
    );
  });

  it('reads a file as text or image, and refuses a large one', async () => {
    const upload = async (name: string, type: string, payload: Buffer) => {
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${groupId}/files`,
        headers: { cookie: admin.cookie, 'content-type': type, 'x-file-name': name },
        payload,
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json<FileInfo>().id;
    };
    const text = await upload('notes.txt', 'text/plain', Buffer.from('Obsah súboru'));
    const res = await tool('read_file', { fileId: text });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ fileId: text, name: 'notes.txt', mime: 'text/plain' });
    expect(res.content[1]).toEqual({ type: 'text', text: 'Obsah súboru' });

    // The smallest PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const image = await tool('read_file', { fileId: await upload('a.png', 'image/png', png) });
    expect(image.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });

    const big = await upload('big.txt', 'text/plain', Buffer.alloc(2 * 1024 * 1024 + 10, 97));
    const refused = await tool('read_file', { fileId: big });
    expect(refused.json).toMatchObject({ status: 413, error: 'file_too_large' });
    expect(refused.raw.length).toBeLessThan(1000);
  });
});
