import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  KnowledgeItemDtoSchema,
  type KnowledgeItemDto,
  type LinkedKnowledge,
  type TaskDetailDto,
  type TicketDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFile } from '../files/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { linkedItemCards } from './links.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `l${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('knowledge attached to descriptions (Phase 33 part P5)', () => {
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
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function item(
    groupId: string,
    cookie: string,
    draft: { title: string; visibility?: 'public' | 'admins'; fileIds?: string[] } & object,
  ) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      body: 'Text',
      ...draft,
    });
    expect(res.statusCode).toBe(201);
    return res.json<KnowledgeItemDto>();
  }
  const card = (k: KnowledgeItemDto) => ({
    id: k.id,
    available: true,
    type: 'note',
    title: k.title,
    folderPath: [],
  });
  async function task(groupId: string, cookie: string, body: object) {
    return call('POST', `/api/groups/${groupId}/tasks`, cookie, { title: 'Úloha', ...body });
  }

  it('a task links shareable items: cards for every reader, re-checked on display', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client');
    const note = await item(g.id, a.cookie, { title: 'Postup' });
    const other = await item(g.id, client.cookie, { title: 'Kontakty' });

    const created = await task(g.id, a.cookie, {
      description: 'Pozri **postup**',
      knowledgeIds: [note.id, other.id],
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json<TaskDetailDto>();
    expect(dto.linkedKnowledge).toEqual([card(note), card(other)]);
    const seen = (await call('GET', `/api/tasks/${dto.id}`, client.cookie)).json<TaskDetailDto>();
    expect(seen.linkedKnowledge).toEqual([card(note), card(other)]);

    // The note goes admins-only: it shows as unavailable, and a re-save may keep it.
    const latest = (
      await call('GET', `/api/knowledge/${note.id}`, a.cookie)
    ).json<KnowledgeItemDto>();
    expect(
      (
        await call('PATCH', `/api/knowledge/${note.id}`, a.cookie, {
          visibility: 'admins',
          updatedAt: latest.updatedAt,
        })
      ).statusCode,
    ).toBe(200);
    const after = (await call('GET', `/api/tasks/${dto.id}`, client.cookie)).json<TaskDetailDto>();
    expect(after.linkedKnowledge).toEqual([{ id: note.id, available: false }, card(other)]);
    const kept = await call('PATCH', `/api/tasks/${dto.id}`, client.cookie, {
      knowledgeIds: [other.id, note.id],
      updatedAt: after.updatedAt,
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json<TaskDetailDto>().linkedKnowledge).toEqual([
      card(other),
      { id: note.id, available: false },
    ]);

    // `[]` removes them all.
    const cleared = await call('PATCH', `/api/tasks/${dto.id}`, a.cookie, {
      knowledgeIds: [],
      updatedAt: kept.json<TaskDetailDto>().updatedAt,
    });
    expect(cleared.json<TaskDetailDto>().linkedKnowledge).toEqual([]);
  });

  it('refuses admins-only items, another client’s items, unknown ids and more than 10', async () => {
    const g = await group();
    const other = await group();
    const a = await admin();
    const secret = await item(g.id, a.cookie, { title: 'Interné', visibility: 'admins' });
    const foreign = await item(other.id, a.cookie, { title: 'Cudzie' });
    for (const ids of [[secret.id], [foreign.id], ['missing-item']]) {
      const res = await task(g.id, a.cookie, { knowledgeIds: ids });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_knowledge_item' });
    }
    const many = await Promise.all(
      Array.from({ length: 11 }, (_, i) => item(g.id, a.cookie, { title: `N${i}` })),
    );
    expect((await task(g.id, a.cookie, { knowledgeIds: many.map((m) => m.id) })).statusCode).toBe(
      400,
    );
    expect(
      (await task(g.id, a.cookie, { knowledgeIds: many.slice(0, 10).map((m) => m.id) })).statusCode,
    ).toBe(201);
  });

  it('a žiadateľ reads the items linked to their ticket’s text, and their files', async () => {
    const g = await group();
    const a = await admin();
    const z = await member(g.id, 'ziadatel');
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
    const unlinked = await item(g.id, a.cookie, { title: 'Iné' });
    const intake = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Chyba', email: z.email, instance_url: `https://${g.host}.egrant.sk` },
    });
    const ticketId = intake.json<{ id: string }>().id;
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(404);
    expect(
      (await call('GET', `/api/tickets/${ticketId}/knowledge/${note.id}`, z.cookie)).statusCode,
    ).toBe(404);

    const patched = await call('PATCH', `/api/tickets/${ticketId}`, a.cookie, {
      knowledgeIds: [note.id],
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<TicketDto>().linkedKnowledge).toEqual([card(note)]);
    const seen = (await call('GET', `/api/tickets/${ticketId}`, z.cookie)).json<TicketDto>();
    expect(seen.linkedKnowledge).toEqual([card(note)]);

    const view = await call('GET', `/api/tickets/${ticketId}/knowledge/${note.id}`, z.cookie);
    expect(view.statusCode).toBe(200);
    const detail = KnowledgeItemDtoSchema.parse(view.json());
    expect(detail).toMatchObject({ id: note.id, canEdit: false, reminder: null });
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(200);
    expect(
      (await call('GET', `/api/tickets/${ticketId}/knowledge/${unlinked.id}`, z.cookie)).statusCode,
    ).toBe(404);

    // Admins-only now: the card is unavailable, the read-through and the file are closed.
    const latest = (
      await call('GET', `/api/knowledge/${note.id}`, a.cookie)
    ).json<KnowledgeItemDto>();
    await call('PATCH', `/api/knowledge/${note.id}`, a.cookie, {
      visibility: 'admins',
      updatedAt: latest.updatedAt,
    });
    expect(
      (await call('GET', `/api/tickets/${ticketId}`, z.cookie)).json<TicketDto>().linkedKnowledge,
    ).toEqual([{ id: note.id, available: false }]);
    expect(
      (await call('GET', `/api/tickets/${ticketId}/knowledge/${note.id}`, z.cookie)).statusCode,
    ).toBe(404);
    expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(404);
  });

  it('a ticket moved to another client shows its links as unavailable', async () => {
    const g = await group();
    const next = await group();
    const a = await admin();
    const client = await member(g.id, 'client');
    const note = await item(g.id, a.cookie, { title: 'Postup' });
    const created = await call('POST', '/api/tickets', client.cookie, {
      groupId: g.id,
      subject: 'Otázka',
      body: 'Text',
      knowledgeIds: [note.id],
    });
    expect(created.statusCode).toBe(201);
    const ticket = created.json<TicketDto>();
    expect(ticket.linkedKnowledge).toEqual([card(note)]);
    expect(
      (await call('PUT', `/api/tickets/${ticket.id}/group`, a.cookie, { groupId: next.id }))
        .statusCode,
    ).toBe(200);
    const moved = (await call('GET', `/api/tickets/${ticket.id}`, a.cookie)).json<TicketDto>();
    expect(moved.linkedKnowledge).toEqual([{ id: note.id, available: false }]);
  });

  it('projects, events and knowledge items link items too', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client');
    const note = await item(g.id, a.cookie, { title: 'Výzva' });

    const project = await call('POST', `/api/groups/${g.id}/projects`, client.cookie, {
      name: 'Kultúra 2026',
      description: 'Opis',
      knowledgeIds: [note.id],
    });
    expect(project.statusCode).toBe(201);
    const p = project.json<{ id: string; updatedAt: string; linkedKnowledge: LinkedKnowledge }>();
    expect(p.linkedKnowledge).toEqual([card(note)]);
    const edited = await call('PATCH', `/api/projects/${p.id}`, a.cookie, {
      knowledgeIds: [],
      updatedAt: p.updatedAt,
    });
    expect(edited.json<{ linkedKnowledge: LinkedKnowledge }>().linkedKnowledge).toEqual([]);

    const event = await call('POST', `/api/projects/${p.id}/events`, client.cookie, {
      name: 'Hodnotenie',
      occursOn: '2026-11-04',
      knowledgeIds: [note.id],
    });
    expect(event.statusCode).toBe(201);
    const e = event.json<{ id: string }>();
    expect(
      (await call('GET', `/api/project-events/${e.id}`, client.cookie)).json<{
        linkedKnowledge: LinkedKnowledge;
      }>().linkedKnowledge,
    ).toEqual([card(note)]);

    const linking = await item(g.id, client.cookie, { title: 'Prehľad', knowledgeIds: [note.id] });
    expect(linking.linkedKnowledge).toEqual([card(note)]);
    // An item never links itself.
    expect(
      (
        await call('PATCH', `/api/knowledge/${linking.id}`, client.cookie, {
          knowledgeIds: [linking.id],
          updatedAt: linking.updatedAt,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('loads the cards of many subjects in one batch', async () => {
    const g = await group();
    const a = await admin();
    const note = await item(g.id, a.cookie, { title: 'Spoločné' });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await task(g.id, a.cookie, { knowledgeIds: [note.id] })).json<TaskDetailDto>().id);
    }
    const cards = await linkedItemCards(
      db(),
      'task',
      ids.map((id) => ({ id, groupId: g.id })),
    );
    expect([...cards.keys()].sort()).toEqual([...ids].sort());
    // Without a group (a ticket without a client) every link is unavailable.
    const none = await linkedItemCards(db(), 'task', [{ id: ids[0]!, groupId: null }]);
    expect(none.get(ids[0]!)).toEqual([{ id: note.id, available: false }]);
  });
});
