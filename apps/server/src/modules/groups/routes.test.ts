import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Group, GroupPerson, GroupSummary, ManagersResponse, Member, Me } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { groupRoom, userRoom } from '../../infra/realtime/rooms.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { addMember, createGroup, getGroup, regenerateInvite } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('groups API', () => {
  let test: TestApp;
  let baseUrl: string;
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

  async function adminSession() {
    const email = newEmail();
    await addAdmin(test.deps.db, { email, name: 'Group Admin' });
    return { email, cookie: await loginAs(test.app, email) };
  }

  /** A verified client in `groupId`, logged in. */
  async function clientIn(groupId: string, name = 'A Client') {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, email, cookie: await loginAs(test.app, email) };
  }

  const newGroup = (name = 'Firma') => createGroup(test.deps.db, { name, egrantUrl: newUrl() });

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  it('admin creates, reads, edits a group', async () => {
    const { cookie } = await adminSession();
    const created = await call('POST', '/api/groups', cookie, {
      name: 'Acme',
      egrantUrl: `${newUrl().toUpperCase().replace('HTTPS', 'https')}/app/login`,
    });
    expect(created.statusCode).toBe(201);
    const group = created.json<Group>();
    expect(group.inviteUrl).toMatch(/\/join\/[\w-]{32}$/);
    expect(group.hasLogo).toBe(false);

    const read = await call('GET', `/api/groups/${group.id}`, cookie);
    expect(read.statusCode).toBe(200);
    expect(read.json<Group>()).toEqual(group);

    const edited = await call('PATCH', `/api/groups/${group.id}`, cookie, {
      name: 'Acme 2',
      egrantUrl: newUrl(),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<Group>().name).toBe('Acme 2');

    const list = (await call('GET', '/api/groups', cookie)).json<GroupSummary[]>();
    expect(list.find((g) => g.id === group.id)).toEqual({
      id: group.id,
      name: 'Acme 2',
      hasLogo: false,
      memberCount: 0,
      updatedAt: edited.json<Group>().updatedAt,
      managers: [],
      managedByMe: false,
    });
    expect((await call('GET', '/api/groups/nope', cookie)).statusCode).toBe(404);
    expect(
      (await call('PATCH', '/api/groups/nope', cookie, { name: 'x', egrantUrl: newUrl() }))
        .statusCode,
    ).toBe(404);
    expect((await call('POST', '/api/groups/nope/invite', cookie)).statusCode).toBe(404);
  });

  it('duplicate eGrant URL → 409 egrant_url_taken', async () => {
    const { cookie } = await adminSession();
    const url = newUrl();
    const body = { name: 'One', egrantUrl: url };
    expect((await call('POST', '/api/groups', cookie, body)).statusCode).toBe(201);
    const dup = await call('POST', '/api/groups', cookie, {
      name: 'Two',
      egrantUrl: `${url}/app/login`,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'egrant_url_taken' });
    const other = await newGroup();
    const patch = await call('PATCH', `/api/groups/${other.id}`, cookie, body);
    expect(patch.statusCode).toBe(409);
  });

  it('invalid body → 400 validation_failed', async () => {
    const { cookie } = await adminSession();
    for (const body of [
      {},
      { name: '', egrantUrl: newUrl() },
      { name: 'x'.repeat(101), egrantUrl: newUrl() },
      { name: 'Ok', egrantUrl: 'x'.repeat(2049) },
      { name: 'Ok', egrantUrl: 'not a url' },
      { name: 'Ok', egrantUrl: 'ftp://firma.egrant.sk' },
    ]) {
      const res = await call('POST', '/api/groups', cookie, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
    const g = await newGroup();
    const patch = await call('PATCH', `/api/groups/${g.id}`, cookie, {
      name: 'Ok',
      egrantUrl: 'nope',
    });
    expect(patch.statusCode).toBe(400);
  });

  it('unauthenticated → 401; client lists groups → 403', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    expect((await call('GET', '/api/groups')).statusCode).toBe(401);
    expect((await call('GET', `/api/groups/${g.id}`)).statusCode).toBe(401);
    expect((await call('GET', '/api/groups', client.cookie)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/groups', client.cookie, { name: 'x', egrantUrl: newUrl() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/api/groups/${g.id}`, client.cookie, {
          name: 'x',
          egrantUrl: newUrl(),
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('POST', `/api/groups/${g.id}/invite`, client.cookie)).statusCode).toBe(403);
    expect(
      (await call('GET', `/api/groups/${g.id}/members/removed`, client.cookie)).statusCode,
    ).toBe(403);
  });

  it('client reads own group → 200 without inviteUrl', async () => {
    const g = await newGroup('Mine');
    const client = await clientIn(g.id);
    const res = await call('GET', `/api/groups/${g.id}`, client.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<Group>();
    expect(body.name).toBe('Mine');
    expect(body).not.toHaveProperty('inviteUrl');
  });

  it('client reads another group → 404', async () => {
    const mine = await newGroup();
    const other = await newGroup();
    const client = await clientIn(mine.id);
    for (const url of [
      `/api/groups/${other.id}`,
      `/api/groups/${other.id}/members`,
      '/api/groups/nope',
    ]) {
      const res = await call('GET', url, client.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('regenerate returns a new inviteUrl', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const before = (await call('GET', `/api/groups/${g.id}`, cookie)).json<Group>().inviteUrl;
    const res = await call('POST', `/api/groups/${g.id}/invite`, cookie);
    expect(res.statusCode).toBe(200);
    const { inviteUrl } = res.json<{ inviteUrl: string }>();
    expect(inviteUrl).toMatch(/\/join\//);
    expect(inviteUrl).not.toBe(before);
    expect((await call('GET', `/api/groups/${g.id}`, cookie)).json<Group>().inviteUrl).toBe(
      inviteUrl,
    );
  });

  it('members list shows verified clients only; removed list is admin-only', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const a = await clientIn(g.id, 'Alpha');
    const unverified = randomUUID();
    await test.deps.db.insert(user).values({
      id: unverified,
      email: newEmail(),
      name: '',
      role: 'client',
      emailVerified: false,
    });
    await addMember(test.deps.db, g.id, unverified);

    const res = await call('GET', `/api/groups/${g.id}/members`, cookie);
    expect(res.json<Member[]>().map((m) => m.id)).toEqual([a.id]);
    // a client sees their own group's members too
    expect((await call('GET', `/api/groups/${g.id}/members`, a.cookie)).statusCode).toBe(200);

    await call('DELETE', `/api/groups/${g.id}/members/${a.id}`, cookie);
    expect((await call('GET', `/api/groups/${g.id}/members`, cookie)).json()).toEqual([]);
    const removed = await call('GET', `/api/groups/${g.id}/members/removed`, cookie);
    expect(removed.json<Member[]>().map((m) => m.id)).toEqual([a.id]);
    expect((await call('GET', '/api/groups/nope/members/removed', cookie)).statusCode).toBe(404);
  });

  it("remove → the client's /api/me is 401 and the socket is disconnected; restore → can log in again", async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: client.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    const closed = new Promise((resolve) => socket.once('disconnect', resolve));

    const res = await call('DELETE', `/api/groups/${g.id}/members/${client.id}`, cookie);
    expect(res.statusCode).toBe(204);
    await closed;
    expect(socket.connected).toBe(false);
    expect((await call('GET', '/api/me', client.cookie)).statusCode).toBe(401);

    const restored = await call('POST', `/api/groups/${g.id}/members/${client.id}/restore`, cookie);
    expect(restored.statusCode).toBe(204);
    const again = await loginAs(test.app, client.email);
    const me = await call('GET', '/api/me', again);
    expect(me.statusCode).toBe(200);
    expect(me.json<Me>().groupId).toBe(g.id);
  });

  it('remove of an admin via the members route → 403', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const other = newEmail();
    // An admin with a membership row is an impossible state, set up on purpose to test the guard.
    const target = await addAdmin(test.deps.db, { email: other, name: 'Other Admin' });
    await addMember(test.deps.db, g.id, target.id);
    const res = await call('DELETE', `/api/groups/${g.id}/members/${target.id}`, cookie);
    expect(res.statusCode).toBe(403);
    expect(
      (await call('POST', `/api/groups/${g.id}/members/${target.id}/restore`, cookie)).statusCode,
    ).toBe(403);
  });

  it('remove of a member of another group → 404', async () => {
    const { cookie } = await adminSession();
    const g1 = await newGroup();
    const g2 = await newGroup();
    const client = await clientIn(g2.id);
    expect(
      (await call('DELETE', `/api/groups/${g1.id}/members/${client.id}`, cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/groups/${g1.id}/members/${client.id}/restore`, cookie)).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/groups/${g1.id}/members/nope`, cookie)).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/api/me', client.cookie)).statusCode).toBe(200);
  });

  it("a client reads their group's people", async () => {
    const g = await newGroup();
    const client = await clientIn(g.id, 'Reader');
    const res = await call('GET', `/api/groups/${g.id}/people`, client.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<GroupPerson[]>().find((p) => p.id === client.id)).toEqual({
      id: client.id,
      name: 'Reader',
      isAdmin: false,
    });
  });

  it("an admin reads any group's people", async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id, 'Member');
    const res = await call('GET', `/api/groups/${g.id}/people`, cookie);
    expect(res.statusCode).toBe(200);
    const people = res.json<GroupPerson[]>();
    expect(people.find((p) => p.id === client.id)?.isAdmin).toBe(false);
    expect(people.some((p) => p.name === 'Group Admin' && p.isAdmin)).toBe(true);
  });

  it('people of a group the client does not belong to → 404', async () => {
    const mine = await newGroup();
    const theirs = await newGroup();
    const client = await clientIn(mine.id);
    const res = await call('GET', `/api/groups/${theirs.id}/people`, client.cookie);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('people of an unknown group → 404', async () => {
    const { cookie } = await adminSession();
    expect((await call('GET', `/api/groups/${randomUUID()}/people`, cookie)).statusCode).toBe(404);
  });

  it('a client cannot remove members', async () => {
    const g = await newGroup();
    const a = await clientIn(g.id);
    const b = await clientIn(g.id);
    expect((await call('DELETE', `/api/groups/${g.id}/members/${b.id}`, a.cookie)).statusCode).toBe(
      403,
    );
  });

  it('GET /api/me returns groupId for a client and null for an admin', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    expect((await call('GET', '/api/me', cookie)).json<Me>().groupId).toBeNull();
    expect((await call('GET', '/api/me', client.cookie)).json<Me>().groupId).toBe(g.id);
  });

  it("PATCH /api/me changes only the caller's name, validates 1..100", async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id, 'Before');
    const other = await clientIn(g.id, 'Untouched');

    const res = await call('PATCH', '/api/me', client.cookie, {
      name: '  After  ',
      id: other.id,
      role: 'admin',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Me>()).toMatchObject({
      id: client.id,
      name: 'After',
      role: 'client',
      groupId: g.id,
    });
    const members = (await call('GET', `/api/groups/${g.id}/members`, cookie)).json<Member[]>();
    expect(members.find((m) => m.id === other.id)?.name).toBe('Untouched');
    expect(members.find((m) => m.id === client.id)?.name).toBe('After');

    for (const name of ['', '   ', 'x'.repeat(101), 5]) {
      expect((await call('PATCH', '/api/me', client.cookie, { name })).statusCode).toBe(400);
    }
    expect((await call('PATCH', '/api/me', undefined, { name: 'x' })).statusCode).toBe(401);
  });

  it("a client's socket joins group:<id>; an admin's joins no group room", async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const { cookie } = await adminSession();
    const open = async (c: string) => {
      const s = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: c },
        reconnection: false,
      });
      sockets.push(s);
      await new Promise((resolve) => s.once('connect', () => resolve(null)));
    };
    await open(client.cookie);
    await open(cookie);
    const adminId = (await call('GET', '/api/me', cookie)).json<Me>().id;
    const inRoom = await test.app.io.in(groupRoom(g.id)).fetchSockets();
    expect(inRoom).toHaveLength(1);
    expect(inRoom[0]?.data.user.id).toBe(client.id);
    const adminSockets = await test.app.io.in(userRoom(adminId)).fetchSockets();
    expect(adminSockets).toHaveLength(1);
    expect([...(adminSockets[0]?.rooms ?? [])].filter((r) => r.startsWith('group:'))).toEqual([]);
  });

  describe('managers', () => {
    const url = (id: string) => `/api/groups/${id}/managers/me`;

    it('PUT managers/me makes the caller a manager and answers mode all', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const res = await call('PUT', url(g.id), cookie);
      expect(res.statusCode).toBe(200);
      const body = res.json<ManagersResponse>();
      expect(body.managedByMe).toBe(true);
      expect(body.mode).toBe('all');
      expect(body.managers).toEqual([{ id: expect.any(String), name: 'Group Admin' }]);
      const list = (await call('GET', '/api/groups', cookie)).json<GroupSummary[]>();
      const row = list.find((x) => x.id === g.id);
      expect(row?.managedByMe).toBe(true);
      expect(row?.managers).toEqual(body.managers);
    });

    it('PUT twice is 200 both times', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      expect((await call('PUT', url(g.id), cookie)).statusCode).toBe(200);
      const again = await call('PUT', url(g.id), cookie);
      expect(again.statusCode).toBe(200);
      expect(again.json<ManagersResponse>().managers).toHaveLength(1);
    });

    it('DELETE answers managedByMe false and mode mentions', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      await call('PUT', url(g.id), cookie);
      const res = await call('DELETE', url(g.id), cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json<ManagersResponse>()).toEqual({
        managers: [],
        managedByMe: false,
        mode: 'mentions',
      });
    });

    it('a client gets 403 on both', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      expect((await call('PUT', url(g.id), client.cookie)).statusCode).toBe(403);
      expect((await call('DELETE', url(g.id), client.cookie)).statusCode).toBe(403);
      expect((await call('PUT', url(g.id))).statusCode).toBe(401);
    });

    it('an unknown group gets 404', async () => {
      const { cookie } = await adminSession();
      expect((await call('PUT', url(randomUUID()), cookie)).statusCode).toBe(404);
      expect((await call('DELETE', url(randomUUID()), cookie)).statusCode).toBe(404);
    });
  });

  describe('logo', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fake png body'),
    ]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg')]);

    const putLogo = (id: string, cookie: string | undefined, body: Buffer, type = 'image/png') =>
      test.app.inject({
        method: 'PUT',
        url: `/api/groups/${id}/logo`,
        headers: { ...(cookie ? { cookie } : {}), 'content-type': type },
        payload: body,
      });

    const logoKey = async (id: string) => (await getGroup(test.deps.db, id))?.logoKey ?? null;

    it('uploads a PNG: 204, hasLogo, served with cache headers and the stored type', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      expect((await putLogo(g.id, cookie, png)).statusCode).toBe(204);
      expect((await call('GET', `/api/groups/${g.id}`, cookie)).json<Group>().hasLogo).toBe(true);

      const key = await logoKey(g.id);
      expect(key).toMatch(new RegExp(`^groups/${g.id}/logo-[a-z0-9]+\\.png$`));
      const res = await call('GET', `/api/groups/${g.id}/logo`, cookie);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, max-age=86400');
      expect(res.headers.etag).toBe(`"${key}"`);
      expect(res.rawPayload.equals(png)).toBe(true);

      const cached = await test.app.inject({
        method: 'GET',
        url: `/api/groups/${g.id}/logo`,
        headers: { cookie, 'if-none-match': `"${key}"` },
      });
      expect(cached.statusCode).toBe(304);
    });

    it('a PDF sent as image/png is 400 invalid_logo and the previous logo stays', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      await putLogo(g.id, cookie, png);
      const before = await logoKey(g.id);
      const res = await putLogo(g.id, cookie, Buffer.from('%PDF-1.7 not an image'));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_logo' });
      expect(await logoKey(g.id)).toBe(before);
      expect(await test.deps.storage.exists(before!)).toBe(true);
    });

    it('a real JPEG declared as image/png is 400 invalid_logo; other content types too', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      expect((await putLogo(g.id, cookie, jpeg, 'image/png')).json()).toEqual({
        error: 'invalid_logo',
      });
      for (const type of ['application/pdf', 'image/svg+xml', 'text/plain']) {
        const res = await putLogo(g.id, cookie, png, type);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_logo' });
      }
      expect(await logoKey(g.id)).toBeNull();
    });

    it('application/json is 400 invalid_logo, not a JSON parser error', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      for (const body of ['{"a":1}', 'not json', '']) {
        const res = await putLogo(g.id, cookie, Buffer.from(body), 'application/json');
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_logo' });
      }
    });

    it('stores the sniffed type: a JPEG is served as image/jpeg', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      expect((await putLogo(g.id, cookie, jpeg, 'image/jpeg')).statusCode).toBe(204);
      expect((await logoKey(g.id))!.endsWith('.jpg')).toBe(true);
      expect((await call('GET', `/api/groups/${g.id}/logo`, cookie)).headers['content-type']).toBe(
        'image/jpeg',
      );
    });

    it('more than 512 KB is 413 and nothing changes', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const big = Buffer.concat([png, Buffer.alloc(524288)]);
      expect((await putLogo(g.id, cookie, big)).statusCode).toBe(413);
      expect(await logoKey(g.id)).toBeNull();
    });

    it('replacing deletes the old file from storage; DELETE removes the logo', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      await putLogo(g.id, cookie, png);
      const first = (await logoKey(g.id))!;
      await putLogo(g.id, cookie, jpeg, 'image/jpeg');
      const second = (await logoKey(g.id))!;
      expect(second).not.toBe(first);
      expect(await test.deps.storage.exists(first)).toBe(false);
      expect(await test.deps.storage.exists(second)).toBe(true);

      expect((await call('DELETE', `/api/groups/${g.id}/logo`, cookie)).statusCode).toBe(204);
      expect(await logoKey(g.id)).toBeNull();
      expect(await test.deps.storage.exists(second)).toBe(false);
      expect((await call('GET', `/api/groups/${g.id}/logo`, cookie)).statusCode).toBe(404);
      expect((await call('DELETE', `/api/groups/${g.id}/logo`, cookie)).statusCode).toBe(204);
    });

    it('a client cannot upload or delete (403); anonymous is 401; unknown group is 404', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const client = await clientIn(g.id);
      expect((await putLogo(g.id, client.cookie, png)).statusCode).toBe(403);
      expect((await call('DELETE', `/api/groups/${g.id}/logo`, client.cookie)).statusCode).toBe(
        403,
      );
      expect((await putLogo(g.id, undefined, png)).statusCode).toBe(401);
      expect((await putLogo(randomUUID(), cookie, png)).statusCode).toBe(404);
      expect((await call('DELETE', `/api/groups/${randomUUID()}/logo`, cookie)).statusCode).toBe(
        404,
      );
    });

    it('own members read the logo; a client of another group gets 404', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const other = await newGroup();
      await putLogo(g.id, cookie, png);
      const member = await clientIn(g.id);
      const outsider = await clientIn(other.id);
      expect((await call('GET', `/api/groups/${g.id}/logo`, member.cookie)).statusCode).toBe(200);
      const res = await call('GET', `/api/groups/${g.id}/logo`, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
      expect((await call('GET', `/api/groups/${g.id}/logo`)).statusCode).toBe(401);
    });

    it('the public join logo works for a valid token and 404s for an old or unknown one', async () => {
      const { cookie } = await adminSession();
      const g = await newGroup();
      const withoutLogo = `/api/join/${g.inviteToken}/logo`;
      expect((await call('GET', withoutLogo)).statusCode).toBe(404);
      await putLogo(g.id, cookie, png);
      const res = await call('GET', withoutLogo);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, max-age=86400');
      expect(res.rawPayload.equals(png)).toBe(true);

      await regenerateInvite(test.deps.db, g.id);
      expect((await call('GET', withoutLogo)).statusCode).toBe(404);
      expect((await call('GET', '/api/join/nope/logo')).statusCode).toBe(404);
    });
  });
});
