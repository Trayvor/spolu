import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  MessagePageSchema,
  type GroupChannel,
  type KnowledgeItemDto,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { createFile } from '../files/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { knowledgeFolders } from '../knowledge/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { selectMessages, toMessageDtos } from './dto.js';
import { messageKnowledgeItems, messages } from './schema.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `k${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('knowledge items in chat messages (Phase 28)', () => {
  let test: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
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
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Člen') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
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
    draft: {
      title: string;
      visibility?: 'public' | 'admins';
      folderId?: string;
      fileIds?: string[];
    },
  ) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      body: 'Text',
      ...draft,
    });
    expect(res.statusCode).toBe(201);
    return res.json<KnowledgeItemDto>();
  }
  async function folder(groupId: string, cookie: string, name: string, parentId?: string) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge/folders`, cookie, {
      name,
      ...(parentId ? { parentId } : {}),
    });
    return res.json<{ id: string }>().id;
  }
  const knowledgeOf = async (channelId: string, cookie: string) =>
    MessagePageSchema.parse(
      (await call('GET', `/api/channels/${channelId}/messages`, cookie)).json(),
    ).messages.map((m) => m.knowledge);

  it('a message carries public items as cards with type, title and folder path', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client', 'Klient');
    const top = await folder(g.id, a.cookie, 'Projekty');
    const sub = await folder(g.id, a.cookie, 'Výzva 2026', top);
    const note = await item(g.id, a.cookie, { title: 'Postup', folderId: sub });
    const loose = await item(g.id, client.cookie, { title: 'Kontakty' });
    const channelId = await groupChat(g.id, a.cookie);

    // Items only: no text and no files is a valid message.
    const res = await send(channelId, client.cookie, { knowledgeIds: [note.id, loose.id] });
    expect(res.statusCode).toBe(201);
    const expected = [
      {
        id: note.id,
        available: true,
        type: 'note',
        title: 'Postup',
        folderPath: ['Projekty', 'Výzva 2026'],
      },
      { id: loose.id, available: true, type: 'note', title: 'Kontakty', folderPath: [] },
    ];
    expect(res.json<MessageDto>().knowledge).toEqual(expected);
    expect(await knowledgeOf(channelId, a.cookie)).toEqual([expected]);
  });

  it('refuses admins-only items, items in an admins-only folder, other groups’ and missing ones', async () => {
    const g = await group();
    const other = await group();
    const a = await admin();
    const channelId = await groupChat(g.id, a.cookie);
    const hidden = await item(g.id, a.cookie, { title: 'Interné', visibility: 'admins' });
    const foreign = await item(other.id, a.cookie, { title: 'Cudzie' });
    const box = await folder(g.id, a.cookie, 'Krabica');
    const boxed = await item(g.id, a.cookie, { title: 'V krabici', folderId: box });
    // The service keeps items of an admins-only folder admins-only; the chat checks the folders too.
    await db()
      .update(knowledgeFolders)
      .set({ visibility: 'admins' })
      .where(eq(knowledgeFolders.id, box));

    for (const id of [hidden.id, foreign.id, boxed.id, randomUUID()]) {
      const res = await send(channelId, a.cookie, { body: 'Pozri', knowledgeIds: [id] });
      expect(res.statusCode, id).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_knowledge_item' });
    }
    expect(await knowledgeOf(channelId, a.cookie)).toEqual([]);
  });

  it('an item later made admins-only or deleted shows as unavailable', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client');
    const later = await item(g.id, a.cookie, { title: 'Neskôr skryté' });
    const gone = await item(g.id, a.cookie, { title: 'Zmazané' });
    const channelId = await groupChat(g.id, a.cookie);
    await send(channelId, a.cookie, { knowledgeIds: [later.id, gone.id] });

    const patched = await call('PATCH', `/api/knowledge/${later.id}`, a.cookie, {
      visibility: 'admins',
      updatedAt: later.updatedAt,
    });
    expect(patched.statusCode).toBe(200);
    expect((await call('DELETE', `/api/knowledge/${gone.id}`, a.cookie)).statusCode).toBe(204);
    // Unavailable for everyone, admins too: the chat shows what everyone in it may read.
    for (const cookie of [a.cookie, client.cookie]) {
      expect(await knowledgeOf(channelId, cookie)).toEqual([
        [
          { id: later.id, available: false },
          { id: gone.id, available: false },
        ],
      ]);
    }
  });

  it('editing keeps the items; deleting the message drops them', async () => {
    const g = await group();
    const a = await admin();
    const note = await item(g.id, a.cookie, { title: 'Postup' });
    const channelId = await groupChat(g.id, a.cookie);
    const sent = (
      await send(channelId, a.cookie, { body: 'Pozri', knowledgeIds: [note.id] })
    ).json<MessageDto>();
    const edited = await call('PATCH', `/api/messages/${sent.id}`, a.cookie, { body: 'Pozri si' });
    expect(edited.json<MessageDto>().knowledge).toHaveLength(1);
    // Text can go: the item keeps the message alive, like a file.
    expect(
      (await call('PATCH', `/api/messages/${sent.id}`, a.cookie, { body: '' })).statusCode,
    ).toBe(200);
    expect((await call('DELETE', `/api/messages/${sent.id}`, a.cookie)).statusCode).toBe(204);
    expect(await knowledgeOf(channelId, a.cookie)).toEqual([[]]);
    const rows = await db()
      .select()
      .from(messageKnowledgeItems)
      .where(eq(messageKnowledgeItems.messageId, sent.id));
    expect(rows).toEqual([]);
  });

  it('a ziadatel gets no picker (403) but opens an attached item read-only, and its files', async () => {
    const g = await group();
    const a = await admin();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const file = await createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId: g.id,
        uploadedBy: a.id,
        name: 'navod.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('návod')]),
      },
    );
    const note = await item(g.id, a.cookie, { title: 'Návod', fileIds: [file.id] });
    const other = await item(g.id, a.cookie, { title: 'Iné' });
    const own = await ticket(g, z.email);
    const channelId = await ticketChat(own, a.cookie);

    // Before it is attached the ziadatel reads neither the item nor its file.
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(404);

    const forbidden = await send(channelId, z.cookie, { body: 'Hm', knowledgeIds: [note.id] });
    expect(forbidden.statusCode).toBe(403);
    const sent = (
      await send(channelId, a.cookie, { body: 'Tu je návod', knowledgeIds: [note.id] })
    ).json<MessageDto>();
    expect(await knowledgeOf(channelId, z.cookie)).toEqual([
      [{ id: note.id, available: true, type: 'note', title: 'Návod', folderPath: [] }],
    ]);

    const view = await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, z.cookie);
    expect(view.statusCode).toBe(200);
    const dto = KnowledgeItemDtoSchema.parse(view.json());
    expect(dto).toMatchObject({
      id: note.id,
      title: 'Návod',
      body: 'Text',
      canEdit: false,
      reminder: null,
      chat: null,
    });
    expect(dto.files.map((f) => f.id)).toEqual([file.id]);
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(200);
    // A ziadatel reacts in their ticket chat like everyone else.
    expect(
      (
        await call('PUT', `/api/messages/${sent.id}/reactions`, z.cookie, {
          emoji: '🙏',
          on: true,
        })
      ).statusCode,
    ).toBe(200);

    // Only that item, only through its message, and never the knowledge base itself.
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${other.id}`, z.cookie)).statusCode,
    ).toBe(404);
    expect((await call('GET', `/api/knowledge/${note.id}`, z.cookie)).statusCode).toBe(404);
    expect((await call('GET', `/api/groups/${g.id}/knowledge`, z.cookie)).statusCode).toBe(404);

    // Made admins-only: gone for the ziadatel, the file too.
    const latest = (
      await call('GET', `/api/knowledge/${note.id}`, a.cookie)
    ).json<KnowledgeItemDto>();
    await call('PATCH', `/api/knowledge/${note.id}`, a.cookie, {
      visibility: 'admins',
      updatedAt: latest.updatedAt,
    });
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, z.cookie)).statusCode,
    ).toBe(404);
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(404);
  });

  it('the read-through route needs a readable live message', async () => {
    const g = await group();
    const a = await admin();
    const outsider = await member((await group()).id, 'client');
    const note = await item(g.id, a.cookie, { title: 'Postup' });
    const channelId = await groupChat(g.id, a.cookie);
    const sent = (await send(channelId, a.cookie, { knowledgeIds: [note.id] })).json<MessageDto>();
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, a.cookie)).statusCode,
    ).toBe(200);
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, outsider.cookie))
        .statusCode,
    ).toBe(404);
    await call('DELETE', `/api/messages/${sent.id}`, a.cookie);
    expect(
      (await call('GET', `/api/messages/${sent.id}/knowledge/${note.id}`, a.cookie)).statusCode,
    ).toBe(404);
  });

  it('?shareable=1 lists only the items that may be attached', async () => {
    const g = await group();
    const a = await admin();
    await item(g.id, a.cookie, { title: 'Verejné' });
    await item(g.id, a.cookie, { title: 'Interné', visibility: 'admins' });
    const res = await call('GET', `/api/groups/${g.id}/knowledge?shareable=1`, a.cookie);
    expect(res.statusCode).toBe(200);
    expect(KnowledgePageSchema.parse(res.json()).items.map((i) => i.title)).toEqual(['Verejné']);
  });

  it('cards of a page load in a fixed number of queries', async () => {
    const g = await group();
    const a = await admin();
    const top = await folder(g.id, a.cookie, 'A');
    const channelId = await groupChat(g.id, a.cookie);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sub = await folder(g.id, a.cookie, `B${i}`, top);
      const one = await item(g.id, a.cookie, { title: `I${i}`, folderId: sub });
      const two = await item(g.id, a.cookie, { title: `J${i}` });
      ids.push(
        (await send(channelId, a.cookie, { knowledgeIds: [one.id, two.id] })).json<MessageDto>().id,
      );
    }
    const counting = createCountingDb();
    try {
      const count = async (n: number) => {
        const rows = await selectMessages(counting.db, inArray(messages.id, ids.slice(0, n)), []);
        counting.reset();
        await toMessageDtos(counting.db, g.id, rows);
        return counting.count();
      };
      // New pool connections first read the types: warm every one up before counting.
      await count(5);
      expect(await count(5)).toBe(await count(1));
    } finally {
      await counting.close();
    }
  });
});
