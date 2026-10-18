import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Group, GroupSummary } from '@spolu/shared';
import { loginAs } from '../../../test/login.js';
import { buildTestApp } from '../../../test/test-app.js';
import { ensureGroupChannel } from '../chat/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { recordNotifications } from '../notifications/service.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, getUserById } from '../users/service.js';
import { addMembership } from './memberships.js';
import { addMember, createGroup, getGroup, regenerateInvite } from './service.js';

const KEY = 'test-deactivation-intake-key-01';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newHost = () => `d${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('deactivated client groups', () => {
  let test: TestApp;
  const admins: string[] = [];
  let admin: { id: string; cookie: string };

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    const email = newEmail();
    const a = await addAdmin(test.deps.db, { email, name: 'Deactivating Admin' });
    admins.push(a.id);
    admin = { id: a.id, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie?: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  const hook = (url: string, payload: object) =>
    test.app.inject({
      method: url.endsWith('intake') ? 'POST' : 'PUT',
      url,
      remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      headers: { authorization: `Bearer ${KEY}` },
      payload,
    });

  async function setup() {
    const host = newHost();
    const group = await createGroup(db(), { name: `Mesto ${host}`, egrantUrl: `https://${host}` });
    const clientEmail = newEmail();
    const clientId = randomUUID();
    await db().insert(user).values({
      id: clientId,
      email: clientEmail,
      name: 'Klientka',
      role: 'client',
      emailVerified: true,
    });
    await addMember(db(), group.id, clientId);
    const client = {
      id: clientId,
      email: clientEmail,
      cookie: await loginAs(test.app, clientEmail),
    };
    const channel = await ensureGroupChannel(db(), group.id);
    return { host, group, client, channelId: channel.id };
  }
  const deactivate = (id: string, cookie = admin.cookie) =>
    call('POST', `/api/groups/${id}/deactivate`, cookie);
  const reactivate = (id: string, cookie = admin.cookie) =>
    call('POST', `/api/groups/${id}/reactivate`, cookie);
  const message = (channelId: string, cookie: string) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body: 'Hello',
      clientId: randomUUID(),
    });
  const listIds = async (query = '') =>
    (await call('GET', `/api/groups${query}`, admin.cookie))
      .json<GroupSummary[]>()
      .map((g) => g.id);

  describe('the admin routes', () => {
    it('deactivate and reactivate answer the group; a repeat changes nothing', async () => {
      const { group } = await setup();
      const off = await deactivate(group.id);
      expect(off.statusCode).toBe(200);
      const at = off.json<Group>().deactivatedAt;
      expect(at).toEqual(expect.any(String));
      const again = await deactivate(group.id);
      expect(again.json<Group>().deactivatedAt).toBe(at);
      const on = await reactivate(group.id);
      expect(on.json<Group>().deactivatedAt).toBeNull();
      expect((await reactivate(group.id)).json<Group>().deactivatedAt).toBeNull();
    });

    it('a client is 403, an unknown id 404, the admin group 409 admin_group', async () => {
      const { group, client } = await setup();
      expect((await deactivate(group.id, client.cookie)).statusCode).toBe(403);
      expect((await deactivate(randomUUID())).statusCode).toBe(404);
      const [adminGroup] = (await call('GET', '/api/groups', admin.cookie))
        .json<GroupSummary[]>()
        .filter((g) => g.kind === 'admin');
      const res = await deactivate(adminGroup!.id);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'admin_group' });
    });
  });

  describe('the access matrix', () => {
    it('clients lose the group (404), keep their account; admins read it, write nothing new', async () => {
      const { group, client, channelId } = await setup();
      expect((await message(channelId, client.cookie)).statusCode).toBe(201);
      await deactivate(group.id);

      // The client: not found everywhere, gone from their groups, account untouched.
      expect((await call('GET', `/api/groups/${group.id}`, client.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/groups/${group.id}/board`, client.cookie)).statusCode).toBe(
        404,
      );
      expect(
        (await call('GET', `/api/channels/${channelId}/messages`, client.cookie)).statusCode,
      ).toBe(404);
      expect((await message(channelId, client.cookie)).statusCode).toBe(404);
      const me = (await call('GET', '/api/me', client.cookie)).json<{
        groups: { groupId: string }[];
      }>();
      expect(me.groups.map((g) => g.groupId)).not.toContain(group.id);
      expect((await getUserById(db(), client.id))?.disabledAt ?? null).toBeNull();

      // The admin: reads it and its history, but nothing new is written there.
      const read = await call('GET', `/api/groups/${group.id}`, admin.cookie);
      expect(read.statusCode).toBe(200);
      expect(read.json<Group>().deactivatedAt).toEqual(expect.any(String));
      expect(
        (await call('GET', `/api/channels/${channelId}/messages`, admin.cookie)).statusCode,
      ).toBe(200);
      const refused = [
        await message(channelId, admin.cookie),
        await call('POST', `/api/groups/${group.id}/tasks`, admin.cookie, { title: 'New task' }),
        await call('POST', '/api/tickets', admin.cookie, { groupId: group.id, subject: 'New' }),
        await call('POST', `/api/groups/${group.id}/invite`, admin.cookie),
        await call('POST', `/api/groups/${group.id}/members`, admin.cookie, { email: newEmail() }),
      ];
      for (const res of refused) {
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'group_inactive' });
      }
      // The invite link opens nothing.
      const token = (await getGroup(db(), group.id))!.inviteToken;
      expect((await call('GET', `/api/join/${token}`)).statusCode).toBe(404);
    });

    it('a requester loses their tickets of the group (404)', async () => {
      const { group } = await setup();
      const email = newEmail();
      const created = await call('POST', '/api/tickets', admin.cookie, {
        groupId: group.id,
        subject: 'Help',
        requesterEmail: email,
      });
      expect(created.statusCode).toBe(201);
      const ticketId = created.json<{ id: string }>().id;
      const cookie = await loginAs(test.app, email);
      expect((await call('GET', `/api/tickets/${ticketId}`, cookie)).statusCode).toBe(200);
      await deactivate(group.id);
      expect((await call('GET', `/api/tickets/${ticketId}`, cookie)).statusCode).toBe(404);
      await reactivate(group.id);
      expect((await call('GET', `/api/tickets/${ticketId}`, cookie)).statusCode).toBe(200);
    });

    it('reactivating brings everything back as it was', async () => {
      const { group, client, channelId } = await setup();
      await deactivate(group.id);
      await reactivate(group.id);
      expect((await call('GET', `/api/groups/${group.id}`, client.cookie)).statusCode).toBe(200);
      expect((await message(channelId, client.cookie)).statusCode).toBe(201);
      const task = await call('POST', `/api/groups/${group.id}/tasks`, admin.cookie, {
        title: 'After',
      });
      expect(task.statusCode).toBe(201);
      expect(await listIds()).toContain(group.id);
    });
  });

  describe('lists', () => {
    it('leaves the groups list, the pickers and the sidebar; ?deactivated=true lists it', async () => {
      const { group } = await setup();
      await deactivate(group.id);
      expect(await listIds()).not.toContain(group.id);
      expect(await listIds('?deactivated=true')).toContain(group.id);
      const sidebar = (await call('GET', '/api/me/home/sidebar', admin.cookie)).json<unknown>();
      expect(JSON.stringify(sidebar)).not.toContain(group.id);
      await reactivate(group.id);
      expect(await listIds('?deactivated=true')).not.toContain(group.id);
    });
  });

  describe('integrations', () => {
    it('the ticket intake answers 409 group_inactive and stores nothing', async () => {
      const { host, group } = await setup();
      await deactivate(group.id);
      const requestId = randomUUID();
      const res = await hook('/api/tickets/intake', {
        request_id: requestId,
        instance_url: `https://${host}`,
        email: newEmail(),
        subject: 'Help',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'group_inactive' });
      expect(await db().select().from(tickets).where(eq(tickets.requestId, requestId))).toEqual([]);
    });

    it('the managers webhook answers 409 group_inactive', async () => {
      const { host, group } = await setup();
      await deactivate(group.id);
      const res = await hook('/api/egrant/managers', {
        instance_url: host,
        email: newEmail(),
        active: true,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'group_inactive' });
    });
  });

  describe('notifications', () => {
    it('stops the pending ones and records no new ones while deactivated', async () => {
      const { group, client } = await setup();
      const [pending] = await recordNotifications(db(), {
        kind: 'chat.message',
        groupId: group.id,
        recipients: [client.id],
        payload: { messageId: 'before' },
      });
      await deactivate(group.id);
      const [row] = await db()
        .select()
        .from(notificationEvents)
        .where(eq(notificationEvents.id, pending!));
      expect(row!.deliveredAt).not.toBeNull();
      expect(row!.emailDueAt === null || row!.emailedAt !== null).toBe(true);
      const ids = await recordNotifications(db(), {
        kind: 'chat.message',
        groupId: group.id,
        recipients: [client.id, admin.id],
        payload: { messageId: 'during' },
      });
      expect(ids).toEqual([]);
      await reactivate(group.id);
      const after = await recordNotifications(db(), {
        kind: 'chat.message',
        groupId: group.id,
        recipients: [client.id],
        payload: { messageId: 'after' },
      });
      expect(after).toHaveLength(1);
    });
  });

  it('keeps the memberships: a removed or re-added member is not needed after reactivation', async () => {
    const { group } = await setup();
    const other = randomUUID();
    await db().insert(user).values({
      id: other,
      email: newEmail(),
      name: 'Second',
      role: 'client',
      emailVerified: true,
    });
    await addMembership(db(), other, group.id, 'client');
    await regenerateInvite(db(), group.id);
    await deactivate(group.id);
    await reactivate(group.id);
    const members = (await call('GET', `/api/groups/${group.id}/members`, admin.cookie)).json<
      { id: string }[]
    >();
    expect(members.map((m) => m.id)).toContain(other);
  });
});
