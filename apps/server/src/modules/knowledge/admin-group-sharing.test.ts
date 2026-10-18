import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  MessagePageSchema,
  type GroupChannel,
  type KnowledgeItemDto,
  type LinkedKnowledge,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureGroupChannel } from '../chat/service.js';
import { createFile } from '../files/service.js';
import { files } from '../files/schema.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { knowledgeItems } from './schema.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `s${randomUUID().replaceAll('-', '').slice(0, 20)}`;

/**
 * Phase 34 part P34-C (spec §2, decisions 10 to 12): knowledge of the admin group "eGrant tím"
 * reaches a client only when an admin marks it "Shareable with clients" and attaches it in that
 * client's place, read-only there; never an "Only eGrant" item, never one in an "Only eGrant"
 * folder, never a file of the team's chat, never another client's item. Into the admin group
 * goes anything.
 */
describe('knowledge of the admin group in client places', () => {
  let test: TestApp;
  let adminGroup: string;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    adminGroup = await ensureAdminGroup(test.deps.db);
    await ensureGroupChannel(test.deps.db, adminGroup);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const send = (channelId: string, cookie: string, body: object) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body: '',
      clientId: randomUUID(),
      ...body,
    });

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
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
  async function ticket(g: { host: string }, email: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Chyba', email, instance_url: `https://${g.host}.egrant.sk` },
    });
    return res.json<{ id: string }>().id;
  }
  const groupChat = async (groupId: string, cookie: string) =>
    (await call('GET', `/api/groups/${groupId}/chat`, cookie)).json<GroupChannel>().id;
  const ticketChat = async (ticketId: string, cookie: string) =>
    (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>().id;
  async function item(
    groupId: string,
    cookie: string,
    draft: { title: string; visibility?: 'public' | 'admins'; folderId?: string; fileIds?: string[] },
  ) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      body: 'Text',
      ...draft,
    });
    expect(res.statusCode).toBe(201);
    return res.json<KnowledgeItemDto>();
  }
  async function folder(groupId: string, cookie: string, visibility: 'public' | 'admins') {
    const res = await call('POST', `/api/groups/${groupId}/knowledge/folders`, cookie, {
      name: `Priečinok ${randomUUID().slice(0, 6)}`,
      visibility,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }
  async function file(groupId: string, uploadedBy: string) {
    return createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId,
        uploadedBy,
        name: 'interne.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('interné')]),
      },
    );
  }
  const knowledgeOf = async (channelId: string, cookie: string) =>
    MessagePageSchema.parse(
      (await call('GET', `/api/channels/${channelId}/messages`, cookie)).json(),
    ).messages.map((m) => m.knowledge);
  async function setVisibility(id: string, cookie: string, visibility: 'public' | 'admins') {
    const latest = (await call('GET', `/api/knowledge/${id}`, cookie)).json<KnowledgeItemDto>();
    const res = await call('PATCH', `/api/knowledge/${id}`, cookie, {
      visibility,
      updatedAt: latest.updatedAt,
    });
    expect(res.statusCode).toBe(200);
  }
  const shared = (k: KnowledgeItemDto) => ({
    id: k.id,
    available: true,
    type: 'note',
    title: k.title,
    folderPath: [],
    source: 'admin_group',
  });

  it('an item of the admin group is "Only eGrant" unless marked shareable', async () => {
    const a = await admin();
    const g = await group();
    expect((await item(adminGroup, a.cookie, { title: 'Interné' })).visibility).toBe('admins');
    expect(
      (await item(adminGroup, a.cookie, { title: 'Pre klientov', visibility: 'public' }))
        .visibility,
    ).toBe('public');
    // A client group keeps its default.
    expect((await item(g.id, a.cookie, { title: 'Klient' })).visibility).toBe('public');
  });

  it('only a shareable item is attached in a client chat, and only that client opens it', async () => {
    const a = await admin();
    const x = await group();
    const y = await group();
    const cx = await member(x.id, 'client');
    const cy = await member(y.id, 'client');
    const hiddenFolder = await folder(adminGroup, a.cookie, 'admins');
    const internal = await item(adminGroup, a.cookie, { title: 'Interné' });
    const inHidden = await item(adminGroup, a.cookie, {
      title: 'V internom priečinku',
      visibility: 'public',
      folderId: hiddenFolder,
    });
    const attachment = await file(adminGroup, a.id);
    const note = await item(adminGroup, a.cookie, {
      title: 'Návod pre klientov',
      visibility: 'public',
      folderId: await folder(adminGroup, a.cookie, 'public'),
      fileIds: [attachment.id],
    });
    const otherClients = await item(y.id, a.cookie, { title: 'Iný klient' });
    const channelId = await groupChat(x.id, a.cookie);

    for (const refused of [internal, inHidden, otherClients]) {
      const res = await send(channelId, a.cookie, { knowledgeIds: [refused.id] });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_knowledge_item' });
    }
    // A client cannot attach an internal item by its id either.
    expect((await send(channelId, cx.cookie, { knowledgeIds: [internal.id] })).statusCode).toBe(
      400,
    );
    // Before it is attached the client reads neither the item nor its file.
    expect((await call('GET', `/api/knowledge/${note.id}`, cx.cookie)).statusCode).toBe(404);
    expect((await call('GET', `/api/files/${attachment.id}`, cx.cookie)).statusCode).toBe(404);

    const sent = await send(channelId, a.cookie, { body: 'Pozrite', knowledgeIds: [note.id] });
    expect(sent.statusCode).toBe(201);
    const messageId = sent.json<MessageDto>().id;
    // The card has the badge and no internal folder names, for the admin and the client.
    expect(await knowledgeOf(channelId, cx.cookie)).toEqual([[shared(note)]]);
    expect(await knowledgeOf(channelId, a.cookie)).toEqual([[shared(note)]]);

    const view = await call('GET', `/api/messages/${messageId}/knowledge/${note.id}`, cx.cookie);
    expect(view.statusCode).toBe(200);
    const dto = KnowledgeItemDtoSchema.parse(view.json());
    expect(dto).toMatchObject({
      id: note.id,
      canEdit: false,
      reminder: null,
      folderId: null,
      folderPath: [],
      source: 'admin_group',
    });
    expect(dto.files.map((f) => f.id)).toEqual([attachment.id]);
    expect((await call('GET', `/api/files/${attachment.id}`, cx.cookie)).statusCode).toBe(200);
    // Never the admin group itself: no browsing, no direct read.
    expect((await call('GET', `/api/knowledge/${note.id}`, cx.cookie)).statusCode).toBe(404);
    expect(
      (await call('GET', `/api/groups/${adminGroup}/knowledge`, cx.cookie)).statusCode,
    ).toBe(404);
    // Another client reads neither the message nor the file.
    expect(
      (await call('GET', `/api/messages/${messageId}/knowledge/${note.id}`, cy.cookie))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', `/api/files/${attachment.id}`, cy.cookie)).statusCode).toBe(404);

    // Switched back to "Only eGrant": unavailable everywhere, the file closed again.
    await setVisibility(note.id, a.cookie, 'admins');
    expect(await knowledgeOf(channelId, cx.cookie)).toEqual([[{ id: note.id, available: false }]]);
    expect(
      (await call('GET', `/api/messages/${messageId}/knowledge/${note.id}`, cx.cookie))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', `/api/files/${attachment.id}`, cx.cookie)).statusCode).toBe(404);
  }, 60_000);

  it('moving a shared item into an "Only eGrant" folder makes every card unavailable', async () => {
    const a = await admin();
    const x = await group();
    const cx = await member(x.id, 'client');
    const note = await item(adminGroup, a.cookie, { title: 'Zdieľané', visibility: 'public' });
    const channelId = await groupChat(x.id, a.cookie);
    expect((await send(channelId, a.cookie, { knowledgeIds: [note.id] })).statusCode).toBe(201);
    const hidden = await folder(adminGroup, a.cookie, 'admins');
    const latest = (await call('GET', `/api/knowledge/${note.id}`, a.cookie)).json<KnowledgeItemDto>();
    const moved = await call('PATCH', `/api/knowledge/${note.id}`, a.cookie, {
      folderId: hidden,
      updatedAt: latest.updatedAt,
    });
    expect(moved.statusCode).toBe(200);
    expect(await knowledgeOf(channelId, cx.cookie)).toEqual([[{ id: note.id, available: false }]]);
  });

  it('a žiadateľ opens a shared item attached in their ticket chat and in its text', async () => {
    const a = await admin();
    const x = await group();
    const z = await member(x.id, 'ziadatel');
    const note = await item(adminGroup, a.cookie, { title: 'Postup', visibility: 'public' });
    const internal = await item(adminGroup, a.cookie, { title: 'Interné' });
    const ticketId = await ticket(x, z.email);
    const channelId = await ticketChat(ticketId, a.cookie);
    const sent = (await send(channelId, a.cookie, { knowledgeIds: [note.id] })).json<MessageDto>();
    expect(await knowledgeOf(channelId, z.cookie)).toEqual([[shared(note)]]);
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, z.cookie)).statusCode,
    ).toBe(200);

    expect(
      (await call('PATCH', `/api/tickets/${ticketId}`, a.cookie, { knowledgeIds: [internal.id] }))
        .statusCode,
    ).toBe(400);
    const patched = await call('PATCH', `/api/tickets/${ticketId}`, a.cookie, {
      knowledgeIds: [note.id],
    });
    expect(patched.statusCode).toBe(200);
    expect(
      (await call('GET', `/api/tickets/${ticketId}/knowledge/${note.id}`, z.cookie)).statusCode,
    ).toBe(200);
  });

  it('descriptions of tasks, projects, events and items link shared items, read through them', async () => {
    const a = await admin();
    const x = await group();
    const y = await group();
    const cx = await member(x.id, 'client');
    const cy = await member(y.id, 'client');
    const attachment = await file(adminGroup, a.id);
    const note = await item(adminGroup, a.cookie, {
      title: 'Metodika',
      visibility: 'public',
      fileIds: [attachment.id],
    });
    const internal = await item(adminGroup, a.cookie, { title: 'Interné' });
    const unlinked = await item(adminGroup, a.cookie, { title: 'Iné', visibility: 'public' });

    expect(
      (
        await call('POST', `/api/groups/${x.id}/tasks`, a.cookie, {
          title: 'Úloha',
          knowledgeIds: [internal.id],
        })
      ).statusCode,
    ).toBe(400);
    const task = await call('POST', `/api/groups/${x.id}/tasks`, a.cookie, {
      title: 'Úloha',
      knowledgeIds: [note.id],
    });
    expect(task.statusCode).toBe(201);
    const taskId = task.json<{ id: string }>().id;
    const seen = (await call('GET', `/api/tasks/${taskId}`, cx.cookie)).json<{
      linkedKnowledge: LinkedKnowledge;
    }>();
    expect(seen.linkedKnowledge).toEqual([shared(note)]);

    const project = await call('POST', `/api/groups/${x.id}/projects`, a.cookie, {
      name: 'Projekt',
      knowledgeIds: [note.id],
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json<{ id: string }>().id;
    const event = await call('POST', `/api/projects/${projectId}/events`, a.cookie, {
      name: 'Termín',
      occursOn: '2026-11-04',
      knowledgeIds: [note.id],
    });
    expect(event.statusCode).toBe(201);
    const eventId = event.json<{ id: string }>().id;
    const linking = await item(x.id, a.cookie, { title: 'Prehľad' });
    const linked = await call('PATCH', `/api/knowledge/${linking.id}`, a.cookie, {
      knowledgeIds: [note.id],
      updatedAt: linking.updatedAt,
    });
    expect(linked.statusCode).toBe(200);

    const through = (kind: string, id: string, itemId: string, cookie: string) =>
      call('GET', `/api/knowledge-links/${kind}/${id}/${itemId}`, cookie);
    for (const [kind, id] of [
      ['task', taskId],
      ['project', projectId],
      ['event', eventId],
      ['knowledge', linking.id],
    ] as const) {
      const view = await through(kind, id, note.id, cx.cookie);
      expect(view.statusCode).toBe(200);
      expect(KnowledgeItemDtoSchema.parse(view.json())).toMatchObject({
        id: note.id,
        canEdit: false,
        source: 'admin_group',
      });
      // Not a reader of the subject, an item not linked there, an unknown kind: 404.
      expect((await through(kind, id, note.id, cy.cookie)).statusCode).toBe(404);
      expect((await through(kind, id, unlinked.id, cx.cookie)).statusCode).toBe(404);
    }
    expect((await through('ticket', taskId, note.id, cx.cookie)).statusCode).toBe(404);
    expect((await through('bogus', taskId, note.id, cx.cookie)).statusCode).toBe(404);
    // The file through the description; another client never.
    expect((await call('GET', `/api/files/${attachment.id}`, cx.cookie)).statusCode).toBe(200);
    expect((await call('GET', `/api/files/${attachment.id}`, cy.cookie)).statusCode).toBe(404);

    await setVisibility(note.id, a.cookie, 'admins');
    expect((await through('task', taskId, note.id, cx.cookie)).statusCode).toBe(404);
    expect((await call('GET', `/api/files/${attachment.id}`, cx.cookie)).statusCode).toBe(404);
    const after = (await call('GET', `/api/tasks/${taskId}`, cx.cookie)).json<{
      linkedKnowledge: LinkedKnowledge;
    }>();
    expect(after.linkedKnowledge).toEqual([{ id: note.id, available: false }]);
    // Many requests (four subjects, three checks each): slow on a loaded runner.
  }, 60_000);

  it('into the admin group goes any item of any client, also an admins-only one', async () => {
    const a = await admin();
    const x = await group();
    const y = await group();
    const internalOfX = await item(x.id, a.cookie, { title: 'Len admini', visibility: 'admins' });
    const ofY = await item(y.id, a.cookie, { title: 'Klient Y' });
    const channelId = await groupChat(adminGroup, a.cookie);
    const sent = await send(channelId, a.cookie, { knowledgeIds: [internalOfX.id, ofY.id] });
    expect(sent.statusCode).toBe(201);
    const cards = sent.json<MessageDto>().knowledge;
    expect(cards.map((c) => c.available)).toEqual([true, true]);
    expect(cards.every((c) => !('source' in c))).toBe(true);
  });

  it('a file sent in the team chat is an "Only eGrant" item, never shareable', async () => {
    const a = await admin();
    const x = await group();
    const upload = await file(adminGroup, a.id);
    const channelId = await groupChat(adminGroup, a.cookie);
    expect((await send(channelId, a.cookie, { fileIds: [upload.id] })).statusCode).toBe(201);
    const [chatItem] = await db()
      .select({ id: knowledgeItems.id, visibility: knowledgeItems.visibility })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.chatFileId, upload.id));
    expect(chatItem!.visibility).toBe('admins');
    const into = await send(await groupChat(x.id, a.cookie), a.cookie, {
      knowledgeIds: [chatItem!.id],
    });
    expect(into.statusCode).toBe(400);
  });

  it('the picker lists the shareable admin-group items for admins only', async () => {
    const a = await admin();
    const x = await group();
    const cx = await member(x.id, 'client');
    const tag = randomUUID().slice(0, 8);
    const open = await item(adminGroup, a.cookie, { title: `Zdieľané ${tag}`, visibility: 'public' });
    await item(adminGroup, a.cookie, { title: `Interné ${tag}` });
    await item(adminGroup, a.cookie, {
      title: `Skryté ${tag}`,
      visibility: 'public',
      folderId: await folder(adminGroup, a.cookie, 'admins'),
    });
    const url = `/api/groups/${x.id}/knowledge?shareable=1&source=admin_group&q=${tag}`;
    const page = KnowledgePageSchema.parse((await call('GET', url, a.cookie)).json());
    expect(page.items.map((i) => i.id)).toEqual([open.id]);
    expect(page.items[0]!.source).toBe('admin_group');
    expect((await call('GET', url, cx.cookie)).statusCode).toBe(404);
    // The client's own picker never lists them.
    const own = KnowledgePageSchema.parse(
      (await call('GET', `/api/groups/${x.id}/knowledge?shareable=1&q=${tag}`, cx.cookie)).json(),
    );
    expect(own.items).toEqual([]);
    // The global list marks them too.
    const global = KnowledgePageSchema.parse(
      (await call('GET', `/api/knowledge?clients=${adminGroup}&q=${tag}`, a.cookie)).json(),
    );
    expect(global.items.length).toBe(3);
    expect(global.items.every((i) => i.source === 'admin_group')).toBe(true);
  });

  it('migration 0042 turns earlier public admin-group items "Only eGrant", nothing else', async () => {
    const a = await admin();
    const x = await group();
    const upload = await file(adminGroup, a.id);
    const old = await item(adminGroup, a.cookie, {
      title: 'Staré',
      visibility: 'public',
      fileIds: [upload.id],
    });
    const client = await item(x.id, a.cookie, { title: 'Klient' });
    const migration = readFileSync(
      new URL(
        '../../infra/db/migrations/0042_admin_group_knowledge_only_egrant.sql',
        import.meta.url,
      ),
      'utf8',
    );
    // In a transaction rolled back at the end: the test database is shared by parallel files.
    const rollback = new Error('rollback');
    let checked = false;
    await db()
      .transaction(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          await tx.execute(sql.raw(statement));
        }
        const rows = await tx
          .select({ id: knowledgeItems.id, visibility: knowledgeItems.visibility })
          .from(knowledgeItems)
          .where(sql`${knowledgeItems.id} in (${old.id}, ${client.id})`);
        expect(Object.fromEntries(rows.map((r) => [r.id, r.visibility]))).toEqual({
          [old.id]: 'admins',
          [client.id]: 'public',
        });
        const [stored] = await tx
          .select({ adminsOnly: files.adminsOnly })
          .from(files)
          .where(eq(files.id, upload.id));
        expect(stored!.adminsOnly).toBe(true);
        checked = true;
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    expect(checked).toBe(true);
  });
});
