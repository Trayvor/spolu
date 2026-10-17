import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { eq } from 'drizzle-orm';
import {
  SocketEvents,
  type Group,
  type GroupJoinAck,
  type GroupPerson,
  type GroupSummary,
  type Me,
  type NotificationModes,
  type SessionUser,
  type SidebarClient,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { groupRoom } from '../../infra/realtime/rooms.js';
import { resolveClientIds } from '../home/global-board.js';
import { managedGroupIdsOf } from '../knowledge/scope.js';
import { getEffectiveGroupMode, getEffectiveModes, setGroupMode } from '../notifications/modes.js';
import { user } from '../users/schema.js';
import { addAdmin, getNotificationProfiles } from '../users/service.js';
import { adminGroupId, ensureAdminGroup, isAdminGroup, withAdminGroup } from './admin-group.js';
import { addManager } from './managers.js';
import { groups } from './schema.js';
import {
  addMember,
  createGroup,
  findGroupByEgrantUrl,
  getGroup,
  getGroupPeopleRoles,
  isPickablePerson,
  listPickablePeople,
} from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

/**
 * Phase 34 P34-B: the admin group "eGrant tím". Admins only: a client or a ziadatel never reads it
 * or anything in it; it has no members, invites, managers or tickets; every admin is pickable
 * there; its default notification mode is All messages; it is first in the sidebar.
 */
describe('the admin group', () => {
  let test: TestApp;
  let baseUrl: string;
  let adminGroup: string;
  const sockets: Socket[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

  async function adminSession(name = 'Team Admin') {
    const email = newEmail();
    await addAdmin(test.deps.db, { email, name });
    const cookie = await loginAs(test.app, email);
    const me = (await call('GET', '/api/me', cookie)).json<Me>();
    return { id: me.id, email, cookie, actor: me as SessionUser };
  }

  /** A verified client in `groupId` (role client or ziadatel), logged in. */
  async function memberIn(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'A Client', role: 'client', emailVerified: true });
    if (role === 'client') await addMember(test.deps.db, groupId, id);
    else {
      const { addMembership } = await import('./memberships.js');
      await addMembership(test.deps.db, id, groupId, 'ziadatel');
    }
    return { id, email, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
    adminGroup = await ensureAdminGroup(test.deps.db);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  describe('data', () => {
    it('exists once, created by the migration; ensureAdminGroup is idempotent', async () => {
      expect(await ensureAdminGroup(test.deps.db)).toBe(adminGroup);
      expect(await adminGroupId(test.deps.db)).toBe(adminGroup);
      const rows = await test.deps.db.select().from(groups).where(eq(groups.kind, 'admin'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: expect.any(String), egrantUrl: null });
      expect(isAdminGroup(rows[0]!)).toBe(true);
    });

    it('a second admin group is refused by the database', async () => {
      await expect(
        test.deps.db.insert(groups).values({
          id: randomUUID(),
          name: 'Second',
          kind: 'admin',
          egrantUrl: null,
          inviteToken: randomUUID(),
        }),
      ).rejects.toThrow();
    });

    it('a client group still needs an eGrant URL', async () => {
      await expect(
        test.deps.db.insert(groups).values({
          id: randomUUID(),
          name: 'No URL',
          egrantUrl: null,
          inviteToken: randomUUID(),
        }),
      ).rejects.toThrow();
    });

    it('the intake never matches it (it has no eGrant link)', async () => {
      const match = await findGroupByEgrantUrl(test.deps.db, 'https://nothing.egrant.sk');
      expect(match?.kind ?? 'client').toBe('client');
      expect(await findGroupByEgrantUrl(test.deps.db, null)).toBeNull();
    });
  });

  describe('who reads it', () => {
    it('every admin reads it, with kind admin, a null eGrant URL and no invite URL', async () => {
      const { cookie } = await adminSession();
      const res = await call('GET', `/api/groups/${adminGroup}`, cookie);
      expect(res.statusCode).toBe(200);
      const body = res.json<Group>();
      expect(body).toMatchObject({ id: adminGroup, kind: 'admin', egrantUrl: null });
      expect(body.inviteUrl).toBeUndefined();
      const g = await newGroup();
      const list = (await call('GET', '/api/groups', cookie)).json<GroupSummary[]>();
      expect(list.find((x) => x.id === adminGroup)?.kind).toBe('admin');
      expect(list.find((x) => x.id === g.id)?.kind).toBe('client');
    });

    it('a client reads neither the group nor its chat, board, knowledge or people', async () => {
      const g = await newGroup();
      const client = await memberIn(g.id);
      for (const path of ['', '/chat', '/board', '/knowledge', '/people', '/members']) {
        const res = await call('GET', `/api/groups/${adminGroup}${path}`, client.cookie);
        expect([403, 404], path).toContain(res.statusCode);
      }
      // Their own group still works as before.
      expect((await call('GET', `/api/groups/${g.id}`, client.cookie)).statusCode).toBe(200);
      expect((await call('GET', '/api/groups', client.cookie)).statusCode).toBe(403);
    });

    it('a ziadatel reads nothing of it either', async () => {
      const g = await newGroup();
      const requester = await memberIn(g.id, 'ziadatel');
      for (const path of ['', '/chat', '/board', '/tickets']) {
        const res = await call('GET', `/api/groups/${adminGroup}${path}`, requester.cookie);
        expect([403, 404], path).toContain(res.statusCode);
      }
    });

    it("a client's socket cannot join its room; an admin's can", async () => {
      const g = await newGroup();
      const client = await memberIn(g.id);
      const admin = await adminSession();
      const open = async (cookie: string) => {
        const s = connect(baseUrl, {
          transports: ['websocket'],
          extraHeaders: { cookie },
          reconnection: false,
        });
        sockets.push(s);
        await new Promise((resolve) => s.once('connect', () => resolve(null)));
        return s;
      };
      const join = (s: Socket) =>
        new Promise<GroupJoinAck>((resolve) =>
          s.emit(SocketEvents.groupJoin, { groupId: adminGroup }, resolve),
        );
      const clientSocket = await open(client.cookie);
      expect(await join(clientSocket)).toEqual({ ok: false, error: 'not_found' });
      const adminSocket = await open(admin.cookie);
      expect(await join(adminSocket)).toEqual({ ok: true });
      const inRoom = await test.app.io.in(groupRoom(adminGroup)).fetchSockets();
      const ids = inRoom.map((s) => s.data.user.id);
      expect(ids).toContain(admin.id);
      expect(ids).not.toContain(client.id);
    });
  });

  describe('refusals', () => {
    it('no members, invites, requesters or managers: 409 admin_group (Members 404)', async () => {
      const admin = await adminSession();
      const other = await adminSession('Other Admin');
      const refused: [method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: object][] = [
        ['POST', '/invite'],
        ['POST', '/members', { email: newEmail() }],
        ['GET', '/members/invited'],
        ['GET', '/members/removed'],
        ['DELETE', `/members/invited/${other.id}`],
        ['DELETE', `/members/${other.id}`],
        ['POST', `/members/${other.id}/restore`],
        ['GET', '/requesters'],
        ['GET', '/requesters/removed'],
        ['PUT', '/managers/me'],
        ['DELETE', '/managers/me'],
        ['PUT', `/managers/${other.id}`],
        ['DELETE', `/managers/${other.id}`],
      ];
      for (const [method, path, body] of refused) {
        const res = await call(method, `/api/groups/${adminGroup}${path}`, admin.cookie, body);
        expect(res.statusCode, `${method} ${path}`).toBe(409);
        expect(res.json<{ error: string }>().error).toBe('admin_group');
      }
      expect(
        (await call('GET', `/api/groups/${adminGroup}/members`, admin.cookie)).statusCode,
      ).toBe(404);
    });

    it('its invite token opens nothing', async () => {
      const [row] = await test.deps.db.select().from(groups).where(eq(groups.id, adminGroup));
      const token = encodeURIComponent(row!.inviteToken);
      expect((await call('GET', `/api/join/${token}`)).statusCode).toBe(404);
      expect(
        (
          await test.app.inject({
            method: 'POST',
            url: `/api/join/${token}`,
            payload: { email: newEmail() },
          })
        ).statusCode,
      ).toBe(404);
    });

    it('an admin renames it (name only); a client group still needs its URL', async () => {
      const { cookie } = await adminSession();
      const before = await getGroup(test.deps.db, adminGroup);
      const res = await call('PATCH', `/api/groups/${adminGroup}`, cookie, {
        name: 'eGrant team',
        egrantUrl: newUrl(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Group>()).toMatchObject({ name: 'eGrant team', egrantUrl: null });
      expect(
        (await call('PATCH', `/api/groups/${adminGroup}`, cookie, { name: ' ' })).statusCode,
      ).toBe(400);
      await call('PATCH', `/api/groups/${adminGroup}`, cookie, { name: before!.name });
      const g = await newGroup();
      expect((await call('PATCH', `/api/groups/${g.id}`, cookie, { name: 'X' })).statusCode).toBe(
        400,
      );
    });

    it('client groups keep their member and manager routes', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      expect((await call('GET', `/api/groups/${g.id}/members`, cookie)).statusCode).toBe(200);
      expect((await call('GET', `/api/groups/${g.id}/requesters`, cookie)).statusCode).toBe(200);
      expect((await call('PUT', `/api/groups/${g.id}/managers/me`, cookie)).statusCode).toBe(200);
      expect((await call('POST', `/api/groups/${g.id}/invite`, cookie)).statusCode).toBe(200);
    });
  });

  describe('tickets', () => {
    const ticket = (groupId: string) => ({
      groupId,
      requesterEmail: null,
      requesterName: null,
      requesterPhone: null,
      subject: 'Help',
    });

    it('creating a ticket there is 400 invalid_group, for an admin and a client', async () => {
      const { cookie } = await adminSession();
      const res = await call('POST', '/api/tickets', cookie, ticket(adminGroup));
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_group');
      const g = await newGroup();
      const client = await memberIn(g.id);
      expect(
        (await call('POST', '/api/tickets', client.cookie, ticket(adminGroup))).statusCode,
      ).toBe(404);
    });

    it('moving a ticket into it is 400 invalid_group', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const created = await call('POST', '/api/tickets', cookie, ticket(g.id));
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;
      const res = await call('PUT', `/api/tickets/${id}/group`, cookie, { groupId: adminGroup });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_group');
    });

    it('its ticket list and ticket watch do not exist (404)', async () => {
      const { cookie } = await adminSession();
      expect((await call('GET', `/api/groups/${adminGroup}/tickets`, cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/groups/${adminGroup}/ticket-watch`, cookie)).statusCode).toBe(
        404,
      );
      expect(
        (await call('PUT', `/api/groups/${adminGroup}/ticket-watch`, cookie, { watching: true }))
          .statusCode,
      ).toBe(404);
      const g = await newGroup();
      expect((await call('GET', `/api/groups/${g.id}/tickets`, cookie)).statusCode).toBe(200);
    });
  });

  describe('pickable people', () => {
    it('in the admin group every active admin is pickable, no client', async () => {
      const a = await adminSession('Admin A');
      const b = await adminSession('Admin B');
      const people = await listPickablePeople(test.deps.db, adminGroup);
      const ids = people.map((p: GroupPerson) => p.id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(people.every((p) => p.isAdmin)).toBe(true);
      expect(await isPickablePerson(test.deps.db, adminGroup, a.id)).toBe(true);
      const roles = await getGroupPeopleRoles(test.deps.db, adminGroup, [a.id, b.id]);
      expect(roles.get(a.id)).toEqual({ isAdmin: true, isManager: true });
      // People: everyone pickable, in the API too.
      const res = await call('GET', `/api/groups/${adminGroup}/people`, a.cookie);
      expect(res.json<GroupPerson[]>().find((p) => p.id === b.id)?.isManager).toBe(true);
    });

    it('in a client group only its clients and managers stay pickable (unchanged)', async () => {
      const a = await adminSession('Admin A');
      const b = await adminSession('Admin B');
      const g = await newGroup();
      const client = await memberIn(g.id);
      await addManager(test.deps.db, g.id, a.id);
      expect(await isPickablePerson(test.deps.db, g.id, a.id)).toBe(true);
      expect(await isPickablePerson(test.deps.db, g.id, b.id)).toBe(false);
      expect(await isPickablePerson(test.deps.db, g.id, client.id)).toBe(true);
      expect(await isPickablePerson(test.deps.db, adminGroup, client.id)).toBe(false);
      const roles = await getGroupPeopleRoles(test.deps.db, g.id, [b.id]);
      expect(roles.get(b.id)).toEqual({ isAdmin: true, isManager: false });
    });

    it('a task in the admin group takes any admin as assignee, never a client', async () => {
      const a = await adminSession('Admin A');
      const b = await adminSession('Admin B');
      const g = await newGroup();
      const client = await memberIn(g.id);
      const board = await call('GET', `/api/groups/${adminGroup}/board`, a.cookie);
      expect(board.statusCode).toBe(200);
      const ok = await call('POST', `/api/groups/${adminGroup}/tasks`, a.cookie, {
        title: 'Internal',
        assigneeIds: [b.id],
      });
      expect(ok.statusCode).toBe(201);
      const bad = await call('POST', `/api/groups/${adminGroup}/tasks`, a.cookie, {
        title: 'Internal',
        assigneeIds: [client.id],
      });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('notifications', () => {
    it('the default mode there is All messages, before the user default; an override wins', async () => {
      const a = await adminSession();
      const g = await newGroup();
      expect(await getEffectiveGroupMode(test.deps.db, a.actor, adminGroup)).toBe('all');
      expect(await getEffectiveGroupMode(test.deps.db, a.actor, g.id)).toBe('mentions');
      await test.deps.db.update(user).set({ defaultGroupMode: 'off' }).where(eq(user.id, a.id));
      expect(await getEffectiveGroupMode(test.deps.db, a.actor, adminGroup)).toBe('all');
      const profiles = await getNotificationProfiles(test.deps.db, [a.id]);
      const pairs = [
        { userId: a.id, groupId: adminGroup },
        { userId: a.id, groupId: g.id },
      ];
      let modes = await getEffectiveModes(test.deps.db, pairs, profiles);
      expect(modes.get(`${a.id}:${adminGroup}`)).toBe('all');
      expect(modes.get(`${a.id}:${g.id}`)).toBe('off');
      await setGroupMode(test.deps.db, a.id, adminGroup, 'mentions');
      expect(await getEffectiveGroupMode(test.deps.db, a.actor, adminGroup)).toBe('mentions');
      modes = await getEffectiveModes(test.deps.db, pairs, profiles);
      expect(modes.get(`${a.id}:${adminGroup}`)).toBe('mentions');
    });

    it('the modes answer names the admin group for an admin, not for a client', async () => {
      const a = await adminSession();
      const modes = (
        await call('GET', '/api/notifications/modes', a.cookie)
      ).json<NotificationModes>();
      expect(modes.adminGroupId).toBe(adminGroup);
      const g = await newGroup();
      const client = await memberIn(g.id);
      const theirs = (
        await call('GET', '/api/notifications/modes', client.cookie)
      ).json<NotificationModes>();
      expect(theirs.adminGroupId ?? null).toBeNull();
    });
  });

  describe('the admin home and global lists', () => {
    it('the sidebar lists it first, in its own internal section', async () => {
      const a = await adminSession();
      const g = await newGroup();
      await addManager(test.deps.db, g.id, a.id);
      const res = await call('GET', '/api/me/home/sidebar', a.cookie);
      expect(res.statusCode).toBe(200);
      const rows = res.json<SidebarClient[]>();
      expect(rows[0]).toMatchObject({ groupId: adminGroup, section: 'internal', managed: false });
      expect(rows.filter((r) => r.section === 'internal')).toHaveLength(1);
      expect(rows[1]).toMatchObject({ groupId: g.id, section: 'client', managed: true });
    });

    it('the default board and knowledge scope include it with managed clients', async () => {
      const a = await adminSession();
      expect(await resolveClientIds(test.deps.db, a.id, undefined)).toBeNull();
      expect(await managedGroupIdsOf(test.deps.db, a.id)).toEqual([]);
      const g = await newGroup();
      await addManager(test.deps.db, g.id, a.id);
      expect(await resolveClientIds(test.deps.db, a.id, undefined)).toEqual([g.id, adminGroup]);
      expect(await managedGroupIdsOf(test.deps.db, a.id)).toEqual([g.id, adminGroup]);
      // An explicit choice stays as chosen.
      expect(await resolveClientIds(test.deps.db, a.id, [g.id])).toEqual([g.id]);
      expect(await withAdminGroup(test.deps.db, [adminGroup])).toEqual([adminGroup]);
    });
  });
});
