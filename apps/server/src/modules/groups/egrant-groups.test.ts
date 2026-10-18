import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jpegWith, pngWith, webpWith } from '../../../test/logo-images.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { addManager } from './managers.js';
import { addMembership, getMembership } from './memberships.js';
import { groupManagers, groupMembers, groups } from './schema.js';
import { createGroup, getGroup } from './service.js';

const KEY = 'test-egrant-tickets-key-0123';
const OWN_KEY = 'test-egrant-groups-key-4567';
const URL_PATH = '/api/egrant/groups';
const SECRET = 'GPS 48.1486N 17.1077E';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const host = () => `g${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;
const b64 = (bytes: Buffer) => bytes.toString('base64');
const logo = (bytes: Buffer, content_type = 'image/png') => ({
  content_type,
  data_base64: b64(bytes),
});

async function read(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

describe('eGrant groups webhook (create or update a client group)', () => {
  let test: TestApp;
  const admins: string[] = [];
  let ip = 0;
  const lines: string[] = [];

  beforeAll(async () => {
    // Only the tickets key: the groups webhook falls back to it.
    test = await buildTestApp({
      config: { ticketsApiKey: KEY },
      logStream: { write: (line) => void lines.push(line) },
    });
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const hook = (
    payload: object | string,
    key: string | null = KEY,
    from = `10.3.0.${++ip % 250}`,
    app = test.app,
  ) =>
    app.inject({
      method: 'PUT',
      url: URL_PATH,
      remoteAddress: from,
      headers: {
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
        'content-type': 'application/json',
      },
      payload,
    });
  const groupsOfHost = (h: string) =>
    db()
      .select()
      .from(groups)
      .where(eq(groups.egrantUrl, `https://${h}`));
  const storedLogo = async (groupId: string) => {
    const key = (await getGroup(db(), groupId))?.logoKey ?? null;
    if (!key) return null;
    const file = await test.deps.storage.get(key);
    return { key, type: file.contentType, bytes: await read(file.stream) };
  };

  describe('auth and limits', () => {
    it('without the key or with a wrong one is 401; nothing is created', async () => {
      const h = host();
      const body = { instance_url: h, name: 'Mesto X' };
      const missing = await hook(body, null);
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({ error: 'unauthorized' });
      expect((await hook(body, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      expect((await hook(body, `${KEY}x`)).statusCode).toBe(401);
      expect(await groupsOfHost(h)).toEqual([]);
    });

    it('with no key configured is 503', async () => {
      const off = await buildTestApp();
      try {
        const res = await hook({ instance_url: host(), name: 'X' }, KEY, '10.3.1.1', off.app);
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'intake_disabled' });
      } finally {
        await off.app.close();
        await off.close();
      }
    });

    it('EGRANT_GROUPS_API_KEY, when set, is the only key: the tickets key is 401', async () => {
      const own = await buildTestApp({
        config: { ticketsApiKey: KEY, egrantGroupsApiKey: OWN_KEY },
      });
      try {
        const h = host();
        const body = { instance_url: h, name: 'Mesto Own' };
        expect((await hook(body, KEY, '10.3.1.2', own.app)).statusCode).toBe(401);
        expect((await hook(body, OWN_KEY, '10.3.1.2', own.app)).statusCode).toBe(201);
        // Only the groups key is set: still on.
        const only = await buildTestApp({ config: { egrantGroupsApiKey: OWN_KEY } });
        try {
          const res = await hook({ instance_url: host(), name: 'Y' }, OWN_KEY, '10.3.1.3', only.app);
          expect(res.statusCode).toBe(201);
        } finally {
          await only.app.close();
          await only.close();
        }
      } finally {
        await own.app.close();
        await own.close();
      }
    });

    it('checks the key before the body: a broken or oversized body without the key is 401', async () => {
      const huge = { instance_url: host(), name: 'X', junk: 'x'.repeat(3 * 1024 * 1024 + 10) };
      expect((await hook('{not json', null)).statusCode).toBe(401);
      expect((await hook(huge, null)).statusCode).toBe(401);
      // With the key, the same bodies are refused for what they are.
      expect((await hook('{not json')).statusCode).toBe(400);
      expect((await hook(huge)).statusCode).toBe(413);
    });

    it('the 61st request in a minute from one address is 429, a wrong key counts too', async () => {
      const from = '10.3.9.9';
      const body = { instance_url: '', name: '' };
      for (let i = 0; i < 30; i++) expect((await hook(body, KEY, from)).statusCode).toBe(400);
      for (let i = 0; i < 30; i++) expect((await hook(body, 'nope', from)).statusCode).toBe(401);
      const res = await hook(body, KEY, from);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'rate_limited' });
      // Another address is not limited.
      expect((await hook(body, KEY, '10.3.9.10')).statusCode).toBe(400);
    });
  });

  describe('validation', () => {
    it('a malformed body is 400 naming the fields', async () => {
      const res = await hook({ instance_url: '', name: '  ', logo: { content_type: 7 } });
      expect(res.statusCode).toBe(400);
      const answer = res.json() as { error: string; fields: string[] };
      expect(answer.error).toBe('validation_failed');
      expect(answer.fields).toEqual(
        expect.arrayContaining(['instance_url', 'name', 'logo.content_type', 'logo.data_base64']),
      );
    });

    it('a name over 100 characters, a non-http URL or broken base64 is 400', async () => {
      const name = await hook({ instance_url: host(), name: 'x'.repeat(101) });
      expect(name.json()).toMatchObject({ fields: ['name'] });
      const url = await hook({ instance_url: 'ftp://x.egrant.sk', name: 'X' });
      expect(url.statusCode).toBe(400);
      expect(url.json()).toMatchObject({ error: 'validation_failed', fields: ['instance_url'] });
      const h = host();
      const bad = await hook({
        instance_url: h,
        name: 'X',
        logo: { content_type: 'image/png', data_base64: 'not base64!' },
      });
      expect(bad.json()).toMatchObject({ fields: ['logo.data_base64'] });
      expect(await groupsOfHost(h)).toEqual([]);
    });
  });

  describe('create, update, unchanged', () => {
    it('creates the client group with the in-app defaults; a repeat is unchanged; a new name updates', async () => {
      const h = host();
      const created = await hook({ instance_url: `https://${h}`, name: 'Mesto Nové' });
      expect(created.statusCode).toBe(201);
      const { state, group_id } = created.json() as { state: string; group_id: string };
      expect(state).toBe('created');
      const row = (await getGroup(db(), group_id))!;
      expect(row).toMatchObject({
        name: 'Mesto Nové',
        kind: 'client',
        egrantUrl: `https://${h}`,
        logoKey: null,
      });
      expect(row.inviteToken.length).toBeGreaterThan(20);

      const again = await hook({ instance_url: `https://${h}`, name: 'Mesto Nové' });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ state: 'unchanged', group_id });

      const renamed = await hook({ instance_url: h, name: '  Mesto Nové 2  ' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toEqual({ state: 'updated', group_id });
      expect((await getGroup(db(), group_id))!.name).toBe('Mesto Nové 2');
      expect(await groupsOfHost(h)).toHaveLength(1);
    });

    it('matches by host: a bare host, www., a path and the case reach the same group', async () => {
      const h = host();
      const first = await hook({ instance_url: h.toUpperCase(), name: 'A' });
      expect(first.statusCode).toBe(201);
      const { group_id } = first.json() as { group_id: string };
      expect((await getGroup(db(), group_id))!.egrantUrl).toBe(`https://${h}`);
      for (const url of [`https://www.${h}/app/login?x=1`, `http://${h}.`, `HTTPS://${h}:443/`]) {
        const res = await hook({ instance_url: url, name: 'A' });
        expect(res.json()).toEqual({ state: 'unchanged', group_id });
      }
    });

    it('updates a group an admin created in the app, keeping its stored URL', async () => {
      const h = host();
      const g = await createGroup(db(), { name: 'Old name', egrantUrl: `http://www.${h}/x` });
      const res = await hook({ instance_url: `https://${h}`, name: 'New name' });
      expect(res.json()).toEqual({ state: 'updated', group_id: g.id });
      const row = (await getGroup(db(), g.id))!;
      expect(row.name).toBe('New name');
      expect(row.egrantUrl).toBe(`http://www.${h}`);
    });

    it('two groups sharing the host is 409 ambiguous_instance and changes neither', async () => {
      const h = host();
      const a = await createGroup(db(), { name: 'A', egrantUrl: `http://${h}` });
      const b = await createGroup(db(), { name: 'B', egrantUrl: `https://www.${h}` });
      const res = await hook({ instance_url: h, name: 'C' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'ambiguous_instance' });
      expect((await getGroup(db(), a.id))!.name).toBe('A');
      expect((await getGroup(db(), b.id))!.name).toBe('B');
    });

    it('two first calls at once make one group', async () => {
      const h = host();
      const body = { instance_url: h, name: 'Race' };
      const answers = await Promise.all([hook(body), hook(body), hook(body)]);
      const ids = new Set(answers.map((r) => (r.json() as { group_id: string }).group_id));
      expect(ids.size).toBe(1);
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect(await groupsOfHost(h)).toHaveLength(1);
    });

    it('never touches members or managers', async () => {
      const h = host();
      const g = await createGroup(db(), { name: 'Members', egrantUrl: `https://${h}` });
      const a = await addAdmin(db(), { email: `${randomUUID()}@example.com`, name: 'Eva Admin' });
      admins.push(a.id);
      await addManager(db(), g.id, a.id);
      const c = await createUnverifiedClient(db(), `${randomUUID()}@example.com`, 'Jana');
      await addMembership(db(), c.id, g.id, 'client');
      const members = () => db().select().from(groupMembers).where(eq(groupMembers.groupId, g.id));
      const managers = () =>
        db().select().from(groupManagers).where(eq(groupManagers.groupId, g.id));
      const before = { members: await members(), managers: await managers() };
      const res = await hook({ instance_url: h, name: 'Renamed', logo: logo(pngWith()) });
      expect(res.json()).toEqual({ state: 'updated', group_id: g.id });
      expect(await members()).toEqual(before.members);
      expect(await managers()).toEqual(before.managers);
      expect((await getMembership(db(), c.id, g.id))?.removedAt).toBeNull();
    });
  });

  describe('logo', () => {
    it('stores a PNG without its metadata; the same logo again is unchanged', async () => {
      const h = host();
      const res = await hook({ instance_url: h, name: 'Logo', logo: logo(pngWith(SECRET)) });
      expect(res.statusCode).toBe(201);
      const { group_id } = res.json() as { group_id: string };
      const stored = (await storedLogo(group_id))!;
      expect(stored.key).toMatch(new RegExp(`^groups/${group_id}/logo-[a-z0-9]+\\.png$`));
      expect(stored.type).toBe('image/png');
      expect(stored.bytes.equals(pngWith())).toBe(true);
      expect(stored.bytes.toString('latin1')).not.toContain('GPS');

      // The same image, with or without the metadata: nothing to do, the file stays.
      for (const bytes of [pngWith(SECRET), pngWith()]) {
        const again = await hook({ instance_url: h, name: 'Logo', logo: logo(bytes) });
        expect(again.json()).toEqual({ state: 'unchanged', group_id });
      }
      expect((await storedLogo(group_id))!.key).toBe(stored.key);
    });

    it('a JPEG replaces the PNG: updated, stripped, the old file deleted', async () => {
      const h = host();
      const first = await hook({ instance_url: h, name: 'J', logo: logo(pngWith()) });
      const { group_id } = first.json() as { group_id: string };
      const old = (await storedLogo(group_id))!;
      const res = await hook({
        instance_url: h,
        name: 'J',
        logo: logo(jpegWith(SECRET), 'image/jpeg'),
      });
      expect(res.json()).toEqual({ state: 'updated', group_id });
      const stored = (await storedLogo(group_id))!;
      expect(stored.key).toMatch(/\.jpg$/);
      expect(stored.type).toBe('image/jpeg');
      expect(stored.bytes.equals(jpegWith())).toBe(true);
      expect(await test.deps.storage.exists(old.key)).toBe(false);
    });

    it('takes a WebP', async () => {
      const res = await hook({
        instance_url: host(),
        name: 'W',
        logo: logo(webpWith(SECRET), 'image/webp'),
      });
      expect(res.statusCode).toBe(201);
      const stored = (await storedLogo((res.json() as { group_id: string }).group_id))!;
      expect(stored.bytes.equals(webpWith())).toBe(true);
    });

    it('omitting logo keeps it; logo: null removes it (and the file); null again is unchanged', async () => {
      const h = host();
      const first = await hook({ instance_url: h, name: 'N', logo: logo(pngWith()) });
      const { group_id } = first.json() as { group_id: string };
      const key = (await storedLogo(group_id))!.key;
      expect((await hook({ instance_url: h, name: 'N' })).json()).toEqual({
        state: 'unchanged',
        group_id,
      });
      expect((await storedLogo(group_id))!.key).toBe(key);
      expect((await hook({ instance_url: h, name: 'N', logo: null })).json()).toEqual({
        state: 'updated',
        group_id,
      });
      expect(await storedLogo(group_id)).toBeNull();
      expect(await test.deps.storage.exists(key)).toBe(false);
      expect((await hook({ instance_url: h, name: 'N', logo: null })).json()).toEqual({
        state: 'unchanged',
        group_id,
      });
    });

    it('a logo over 2 MiB is 413 file_too_large and creates nothing', async () => {
      const h = host();
      const big = Buffer.concat([pngWith(), Buffer.alloc(2 * 1024 * 1024 + 1 - pngWith().length)]);
      const res = await hook({ instance_url: h, name: 'Big', logo: logo(big) });
      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({ error: 'file_too_large', fields: ['logo.data_base64'] });
      expect(await groupsOfHost(h)).toEqual([]);
    });

    it('SVG or another declared type is 415 unsupported_type and creates nothing', async () => {
      const h = host();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
      for (const type of ['image/svg+xml', 'image/gif', 'application/pdf']) {
        const res = await hook({ instance_url: h, name: 'S', logo: logo(svg, type) });
        expect(res.statusCode).toBe(415);
        expect(res.json()).toEqual({ error: 'unsupported_type', fields: ['logo.content_type'] });
      }
      expect(await groupsOfHost(h)).toEqual([]);
    });

    it('bytes that are not the declared image are 422 invalid_logo, the old logo stays', async () => {
      const h = host();
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      for (const [bytes, type] of [
        [Buffer.from('just some text'), 'image/png'],
        [svg, 'image/png'],
        [jpegWith(), 'image/png'],
        [pngWith().subarray(0, 40), 'image/png'],
      ] as const) {
        const res = await hook({ instance_url: h, name: 'F', logo: logo(bytes, type) });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: 'invalid_logo', fields: ['logo.data_base64'] });
      }
      expect(await groupsOfHost(h)).toEqual([]);

      const ok = await hook({ instance_url: h, name: 'F', logo: logo(pngWith()) });
      const { group_id } = ok.json() as { group_id: string };
      const key = (await storedLogo(group_id))!.key;
      const res = await hook({
        instance_url: h,
        name: 'F renamed',
        logo: logo(Buffer.from('x'), 'image/png'),
      });
      expect(res.statusCode).toBe(422);
      expect((await getGroup(db(), group_id))!.name).toBe('F');
      expect((await storedLogo(group_id))!.key).toBe(key);
    });
  });

  it('writes a log line without the key or the image data', async () => {
    const h = host();
    lines.length = 0;
    const data = b64(pngWith(SECRET));
    const res = await hook({ instance_url: h, name: 'Logged', logo: logo(pngWith(SECRET)) });
    const { group_id } = res.json() as { group_id: string };
    const line = lines.find((l) => l.includes('egrant group webhook'));
    expect(line).toBeDefined();
    expect(line).toContain(group_id);
    const all = lines.join('\n');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(data.slice(0, 40));
    expect(all).not.toContain(SECRET);
  });
});
