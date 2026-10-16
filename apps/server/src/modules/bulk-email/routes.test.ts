import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  BulkEvents,
  type BulkAudienceCount,
  type BulkAudiencePage,
  type BulkCampaignDto,
  type BulkCampaignPage,
  type BulkEventPayload,
  type BulkPerson,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bulkCampaigns } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('bulk email API', () => {
  let test: TestApp;
  let baseUrl: string;
  let admin: Person;
  let client: Person;
  const sockets: Socket[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function newAdmin(name = 'Bulk Admin'): Promise<Person> {
    const email = newEmail();
    const created = await addAdmin(test.deps.db, { email, name });
    return { id: created.id, cookie: await loginAs(test.app, email) };
  }

  async function newClient(groupId?: string, name = 'Bulk Client'): Promise<Person> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    if (groupId) await addMembership(test.deps.db, id, groupId, 'client');
    return { id, cookie: await loginAs(test.app, email) };
  }

  const create = async (name = 'Campaign') => {
    const res = await call('POST', '/api/bulk-email/campaigns', admin.cookie, { name });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<BulkCampaignDto>();
  };

  const draftOf = (c: BulkCampaignDto, over: Record<string, unknown> = {}) => ({
    name: c.name,
    subject: c.subject,
    preheader: c.preheader,
    blocks: c.blocks,
    audience: c.audience,
    version: c.version,
    ...over,
  });

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
    const events: BulkEventPayload[] = [];
    socket.on(BulkEvents.updated, (payload: BulkEventPayload) => events.push(payload));
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

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
    admin = await newAdmin();
    client = await newClient();
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  const routes = (id: string): ['GET' | 'POST' | 'PUT' | 'DELETE', string][] => [
    ['GET', '/api/bulk-email/campaigns'],
    ['POST', '/api/bulk-email/campaigns'],
    ['GET', `/api/bulk-email/campaigns/${id}`],
    ['PUT', `/api/bulk-email/campaigns/${id}`],
    ['DELETE', `/api/bulk-email/campaigns/${id}`],
    ['POST', `/api/bulk-email/campaigns/${id}/duplicate`],
    ['POST', '/api/bulk-email/audience/count'],
    ['POST', '/api/bulk-email/audience/people'],
    ['GET', '/api/bulk-email/people?q=ab'],
    ['POST', '/api/bulk-email/people/lookup'],
  ];

  it('client gets 403 on every route, anonymous 401', async () => {
    const c = await create();
    for (const [method, url] of routes(c.id)) {
      expect((await call(method, url, undefined, {})).statusCode, `${method} ${url}`).toBe(401);
      expect((await call(method, url, client.cookie, {})).statusCode, `${method} ${url}`).toBe(403);
    }
    // Nothing changed on the way.
    expect((await call('GET', `/api/bulk-email/campaigns/${c.id}`, admin.cookie)).json()).toEqual(
      c,
    );
  });

  it('creates, reads, saves and deletes a draft', async () => {
    const c = await create('  Spaced  ');
    expect(c).toMatchObject({ name: 'Spaced', status: 'draft', version: 1 });
    expect((await call('GET', `/api/bulk-email/campaigns/${c.id}`, admin.cookie)).json()).toEqual(
      c,
    );

    const blocks = [{ id: 'b1', type: 'text', text: 'Hi {{name}}', align: 'left' }];
    const saved = await call(
      'PUT',
      `/api/bulk-email/campaigns/${c.id}`,
      admin.cookie,
      draftOf(c, { subject: 'Hello', blocks }),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<BulkCampaignDto>()).toMatchObject({ subject: 'Hello', blocks, version: 2 });

    expect(
      (await call('DELETE', `/api/bulk-email/campaigns/${c.id}`, admin.cookie)).statusCode,
    ).toBe(204);
    expect((await call('GET', `/api/bulk-email/campaigns/${c.id}`, admin.cookie)).statusCode).toBe(
      404,
    );
  });

  it('400 for an invalid create or save body', async () => {
    expect(
      (await call('POST', '/api/bulk-email/campaigns', admin.cookie, { name: ' ' })).statusCode,
    ).toBe(400);
    const c = await create();
    const res = await call(
      'PUT',
      `/api/bulk-email/campaigns/${c.id}`,
      admin.cookie,
      draftOf(c, {
        blocks: [
          { id: 'b', type: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('a save body over 200 kB is refused', async () => {
    const c = await create();
    const res = await call(
      'PUT',
      `/api/bulk-email/campaigns/${c.id}`,
      admin.cookie,
      draftOf(c, { preheader: 'x'.repeat(210_000) }),
    );
    expect(res.statusCode).toBe(413);
  });

  it('save with an old version → 409 changed', async () => {
    const other = await newAdmin('Other');
    const c = await create();
    const first = await call('PUT', `/api/bulk-email/campaigns/${c.id}`, admin.cookie, draftOf(c));
    expect(first.statusCode).toBe(200);
    const second = await call('PUT', `/api/bulk-email/campaigns/${c.id}`, other.cookie, draftOf(c));
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'changed' });
  });

  it('save of a sending campaign → 409 not_draft; unknown → 404', async () => {
    const c = await create();
    await test.deps.db
      .update(bulkCampaigns)
      .set({ status: 'sending' })
      .where(eq(bulkCampaigns.id, c.id));
    const res = await call('PUT', `/api/bulk-email/campaigns/${c.id}`, admin.cookie, draftOf(c));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_draft' });
    const unknown = await call(
      'PUT',
      `/api/bulk-email/campaigns/${randomUUID()}`,
      admin.cookie,
      draftOf(c),
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('delete of a sent campaign → 409 not_draft', async () => {
    const c = await create();
    await test.deps.db
      .update(bulkCampaigns)
      .set({ status: 'sent' })
      .where(eq(bulkCampaigns.id, c.id));
    const res = await call('DELETE', `/api/bulk-email/campaigns/${c.id}`, admin.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_draft' });
  });

  it('duplicate of a sent campaign is a draft with the same blocks and audience, version 1', async () => {
    const c = await create('Sent one');
    const blocks = [{ id: 'b1', type: 'divider' }];
    const audience = {
      groupIds: ['g'],
      managerIds: [],
      roles: ['client'],
      includeUserIds: [],
      excludeUserIds: [],
    };
    await call(
      'PUT',
      `/api/bulk-email/campaigns/${c.id}`,
      admin.cookie,
      draftOf(c, { blocks, audience }),
    );
    await test.deps.db
      .update(bulkCampaigns)
      .set({ status: 'sent' })
      .where(eq(bulkCampaigns.id, c.id));
    const res = await call('POST', `/api/bulk-email/campaigns/${c.id}/duplicate`, admin.cookie);
    expect(res.statusCode).toBe(201);
    expect(res.json<BulkCampaignDto>()).toMatchObject({
      name: 'Sent one (kópia)',
      status: 'draft',
      version: 1,
      blocks,
      audience,
    });
    expect(
      (await call('POST', `/api/bulk-email/campaigns/${randomUUID()}/duplicate`, admin.cookie))
        .statusCode,
    ).toBe(404);
  });

  it('list is newest first, 50 per page with a cursor; a bad cursor is 400', async () => {
    const a = await create('Older');
    const b = await create('Newer');
    const page = (
      await call('GET', '/api/bulk-email/campaigns', admin.cookie)
    ).json<BulkCampaignPage>();
    expect(page.items.length).toBeLessThanOrEqual(50);
    const ids = page.items.map((i) => i.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(
      (await call('GET', '/api/bulk-email/campaigns?cursor=bad', admin.cookie)).statusCode,
    ).toBe(400);
  });

  it('counts, lists, searches and looks up the audience', async () => {
    const group = await createGroup(test.deps.db, { name: 'Audience', egrantUrl: newUrl() });
    const tag = randomUUID().slice(0, 8);
    const one = await newClient(group.id, `Aud ${tag} One`);
    const two = await newClient(group.id, `Aud ${tag} Two`);
    const audience = { groupIds: [group.id], roles: ['client'] };

    const count = await call('POST', '/api/bulk-email/audience/count', admin.cookie, audience);
    expect(count.json<BulkAudienceCount>()).toEqual({
      count: 2,
      leftOut: { unsubscribed: 0, disabled: 0 },
    });

    const people = await call('POST', '/api/bulk-email/audience/people', admin.cookie, audience);
    expect(people.json<BulkAudiencePage>()).toEqual({
      items: [
        expect.objectContaining({ id: one.id, role: 'client', groups: ['Audience'] }),
        expect.objectContaining({ id: two.id }),
      ],
      nextCursor: null,
    });
    expect(
      (await call('POST', '/api/bulk-email/audience/people?cursor=bad', admin.cookie, audience))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/bulk-email/audience/count', admin.cookie, { roles: ['boss'] }))
        .statusCode,
    ).toBe(400);
    const tooMany = { groupIds: Array.from({ length: 501 }, (_, i) => `g${i}`) };
    expect(
      (await call('POST', '/api/bulk-email/audience/count', admin.cookie, tooMany)).statusCode,
    ).toBe(400);

    const found = await call('GET', `/api/bulk-email/people?q=${tag}`, admin.cookie);
    expect(found.json<BulkPerson[]>().map((p) => p.id)).toEqual([one.id, two.id]);
    expect((await call('GET', '/api/bulk-email/people?q=a', admin.cookie)).statusCode).toBe(400);

    const lookup = await call('POST', '/api/bulk-email/people/lookup', admin.cookie, {
      ids: [two.id],
    });
    expect(lookup.json<BulkPerson[]>().map((p) => p.id)).toEqual([two.id]);
  });

  it('bulk:updated reaches an admin socket and not a client socket', async () => {
    const adminEvents = record(await socketOf(admin.cookie));
    const clientEvents = record(await socketOf(client.cookie));
    const c = await create('Evented');
    await until(() => adminEvents.some((e) => e.campaignId === c.id));
    await call('PUT', `/api/bulk-email/campaigns/${c.id}`, admin.cookie, draftOf(c));
    await until(() => adminEvents.filter((e) => e.campaignId === c.id).length === 2);
    await call('DELETE', `/api/bulk-email/campaigns/${c.id}`, admin.cookie);
    await until(() => adminEvents.filter((e) => e.campaignId === c.id).length === 3);
    await settle();
    expect(clientEvents).toEqual([]);
  });
});
