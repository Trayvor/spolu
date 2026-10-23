import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { TicketDto, TicketListResponse } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { signEgrantRequest } from '../../infra/http/egrant-signature.js';
import { cookieHeader, loginAs } from '../../../test/login.js';
import { countEmailsTo, latestEmail } from '../../../test/mail.js';
import { addManager } from '../groups/managers.js';
import {
  addMembership,
  getMembership,
  listMemberships,
  removeMembership,
} from '../groups/memberships.js';
import { createGroup, setGroupDeactivated } from '../groups/service.js';
import {
  addAdmin,
  createUnverifiedClient,
  findUserByEmail,
  deactivateUser,
} from '../users/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tasks } from '../tasks/schema.js';
import { files } from '../files/schema.js';
import { tickets } from './schema.js';
import { findTicketByRequestId } from './service.js';
import { user } from '../users/schema.js';
import { getBoard } from '../tasks/service.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `t${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('tickets API', () => {
  let test: TestApp;
  // Deactivated in afterAll: a ticket without a client notifies every active admin of the
  // shared test database, so admins left active make later runs slower.
  const admins: string[] = [];
  let baseUrl = '';
  const sockets: Socket[] = [];
  let ip = 0;

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
    cookie?: string,
    payload?: object,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  const intake = (payload: object, key: string | null = KEY, from = `10.1.0.${++ip % 250}`) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      remoteAddress: from,
      headers: key === null ? {} : { authorization: `Bearer ${key}` },
      payload,
    });

  async function group(name = 'Firma') {
    const h = host();
    const g = await createGroup(db(), { name, egrantUrl: `https://${h}.egrant.sk` });
    return { ...g, host: h };
  }
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const c = await createUnverifiedClient(db(), newEmail());
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }

  describe('intake', () => {
    it('with EGRANT_TICKETS_SIGNING_SECRET set, needs a valid signature after the key', async () => {
      const secret = 'tickets-signing-secret-0123456789abcdef';
      const signed = await buildTestApp({
        config: {
          ticketsApiKey: KEY,
          egrantSigningSecrets: { tickets: secret, managers: null, groups: null, projects: null },
        },
      });
      try {
        const body = JSON.stringify({ subject: 'Podpísaná požiadavka', email: newEmail() });
        const send = (headers: Record<string, string>, key = KEY) =>
          signed.app.inject({
            method: 'POST',
            url: '/api/tickets/intake',
            remoteAddress: `10.1.7.${++ip % 250}`,
            headers: {
              authorization: `Bearer ${key}`,
              'content-type': 'application/json',
              ...headers,
            },
            payload: body,
          });
        const ts = Math.floor(Date.now() / 1000);
        const good = {
          'x-spolu-timestamp': String(ts),
          'x-spolu-signature': signEgrantRequest(secret, ts, body),
        };
        // The key is still checked first; then a missing or wrong signature is 401.
        expect((await send(good, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
        expect((await send({})).statusCode).toBe(401);
        expect(
          (await send({ ...good, 'x-spolu-signature': signEgrantRequest(secret, ts, '{}') }))
            .statusCode,
        ).toBe(401);
        expect((await send(good)).statusCode).toBe(201);
        // A replay of the same signed request is refused.
        expect((await send(good)).statusCode).toBe(401);
      } finally {
        await signed.app.close();
        await signed.close();
      }
    });

    it('without the key is 401; with no key configured 503', async () => {
      expect((await intake({ subject: 'x' }, null)).statusCode).toBe(401);
      expect((await intake({ subject: 'x' }, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      const off = await buildTestApp();
      try {
        const res = await off.app.inject({
          method: 'POST',
          url: '/api/tickets/intake',
          headers: { authorization: `Bearer ${KEY}` },
          payload: { subject: 'x' },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'intake_disabled' });
      } finally {
        await off.app.close();
        await off.close();
      }
    });

    it('a bad body is 400 naming the field', async () => {
      const res = await intake({ subject: 'x', due_date: '2026-13-01' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed', fields: ['due_date'] });
      expect((await intake({ email: 'a@b.sk' })).statusCode).toBe(400);
    });

    it('the 61st request in a minute from one address is 429', async () => {
      const from = '10.9.9.1';
      // With a client and no managers, nobody is notified: a ticket without a client would
      // notify every admin of the test database 60 times.
      const g = await group();
      const body = { subject: 'x', instance_url: `https://${g.host}.egrant.sk` };
      for (let i = 0; i < 60; i++) expect((await intake(body, KEY, from)).statusCode).toBe(201);
      expect((await intake(body, KEY, from)).statusCode).toBe(429);
    });

    it('wrong keys count toward the limit too: the limit is checked before the key', async () => {
      const from = '10.9.9.2';
      const wrong = 'not-the-key-0123456789';
      for (let i = 0; i < 60; i++) {
        expect((await intake({ subject: 'x' }, wrong, from)).statusCode).toBe(401);
      }
      expect((await intake({ subject: 'x' }, wrong, from)).statusCode).toBe(429);
      expect((await intake({ subject: 'x' }, KEY, from)).statusCode).toBe(429);
    });

    it('matches the instance link, makes the requester a ziadatel and emails them a login link', async () => {
      const g = await group();
      const manager = await admin();
      await addManager(db(), g.id, manager.id);
      const email = newEmail();
      const res = await intake({
        subject: 'Nejde odoslať žiadosť',
        body: 'Pri odoslaní sa zobrazí chyba.',
        email: ` ${email.toUpperCase()} `,
        requester_name: 'Jana Nová',
        instance_url: `https://WWW.${g.host}.egrant.sk/app/login`,
        file_links: ['https://files.egrant.sk/a.png'],
        due_date: '2026-11-01',
      });
      expect(res.statusCode).toBe(201);
      const { id, number } = res.json<{ id: string; number: number }>();
      const requester = await findUserByEmail(db(), email);
      expect((await getMembership(db(), requester!.id, g.id))?.role).toBe('ziadatel');

      const mail = await latestEmail(email);
      expect(mail.subject).toBe(`Tiket #${number} bol vytvorený: Nejde odoslať žiadosť`);
      // A one-click sign-in link (ADR 0022): it signs the requester in and answers the ticket.
      const token = /\/t#([A-Za-z0-9_-]{43,})/.exec(mail.text)?.[1];
      expect(token).toBeDefined();
      expect(mail.text).toContain('bez kódu');
      const opened = await test.app.inject({
        method: 'POST',
        url: '/api/auth/ticket-link/sign-in',
        payload: { token },
      });
      expect(opened.statusCode).toBe(200);
      expect(opened.json()).toEqual({ ticketId: id });
      const own = await call('GET', `/api/tickets/${id}`, cookieHeader(opened));
      expect(own.statusCode).toBe(200);

      const dto = (await call('GET', `/api/tickets/${id}`, manager.cookie)).json<TicketDto>();
      expect(dto).toMatchObject({
        groupId: g.id,
        status: 'new',
        source: 'api',
        requester: { userId: requester!.id, name: 'Jana Nová', email },
        files: [],
        dueDate: '2026-11-01',
        assignees: [],
      });
      // The removed file_links is ignored.
      expect(dto).not.toHaveProperty('fileLinks');
    });

    it('a client of the group as the requester: the email links to the code login, not a one-click link', async () => {
      const g = await group();
      const c = await clientIn(g.id);
      const res = await intake({
        subject: 'Klient',
        email: c.email,
        instance_url: `https://${g.host}.egrant.sk`,
      });
      expect(res.statusCode).toBe(201);
      const mail = await latestEmail(c.email);
      expect(mail.text).toContain(
        `/login?redirect=${encodeURIComponent(`/tickets/${res.json().id}`)}&email=`,
      );
      expect(mail.text).not.toContain('/t#');
    });

    it('a repeat with the same request_id answers the first ticket and does nothing else', async () => {
      const g = await group();
      const manager = await admin();
      await addManager(db(), g.id, manager.id);
      const email = newEmail();
      const requestId = `egrant-${randomUUID()}`;
      const body = {
        subject: 'Opakovaný',
        email,
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: requestId,
      };
      const first = await intake(body);
      expect(first.statusCode).toBe(201);
      await latestEmail(email);
      // A retry may differ in content; the request id alone decides.
      const again = await intake({ ...body, subject: 'Iný predmet' });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());

      const { id } = first.json<{ id: string }>();
      const rows = await db().select().from(tickets).where(eq(tickets.requestId, requestId));
      expect(rows.map((r) => [r.id, r.subject])).toEqual([[id, 'Opakovaný']]);
      const events = await db()
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.userId, manager.id),
            sql`${notificationEvents.payload}->>'ticketId' = ${id}`,
          ),
        );
      expect(events).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await countEmailsTo(email)).toBe(1);
    });

    it('concurrent requests with one request_id make one ticket', async () => {
      const g = await group();
      const body = {
        subject: 'Súbežný',
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: randomUUID(),
      };
      const answers = await Promise.all(Array.from({ length: 6 }, () => intake(body)));
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect(new Set(answers.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
      const rows = await db().select().from(tickets).where(eq(tickets.requestId, body.request_id));
      expect(rows).toHaveLength(1);
    });

    it('no match: a ticket without client, only in the global view with scope none', async () => {
      const a = await admin();
      const email = newEmail();
      const res = await intake({
        subject: 'Bez klienta',
        email,
        instance_url: 'https://nobody.egrant.sk',
      });
      const { id } = res.json<{ id: string }>();
      expect(await findUserByEmail(db(), email)).toBeNull();
      expect(await countEmailsTo(email)).toBe(0);
      const none = (
        await call('GET', '/api/tickets/global?scope=none', a.cookie)
      ).json<TicketListResponse>();
      expect(none.items.map((t) => t.id)).toContain(id);
      const dto = (await call('GET', `/api/tickets/${id}`, a.cookie)).json<TicketDto>();
      expect(dto).toMatchObject({ groupId: null, instanceUrl: 'https://nobody.egrant.sk' });
    });
  });

  describe('intake files', () => {
    // An 8-byte PNG signature plus a few bytes, and a tiny PDF: sniffing reads only the head.
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n');
    const b64 = (bytes: Buffer) => bytes.toString('base64');
    const MiB = 1024 * 1024;
    /** Valid base64 of `bytes` zero bytes, without allocating them. */
    const zeros = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

    const groupFiles = (groupId: string) =>
      db().select().from(files).where(eq(files.groupId, groupId));
    const download = (id: string, cookie: string) => call('GET', `/api/files/${id}`, cookie);

    it('stores a PNG and a PDF in the client files; the requester sees and downloads them', async () => {
      const g = await group();
      const email = newEmail();
      const res = await intake({
        subject: 'So súbormi',
        email,
        instance_url: `https://${g.host}.egrant.sk`,
        files: [
          { name: 'C:\\shots\\chyba.png', content_base64: b64(PNG), content_type: 'text/plain' },
          { name: 'rozpočet.pdf', content_base64: b64(PDF) },
        ],
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json<{ id: string }>();
      const requester = await loginAs(test.app, email);
      const dto = (await call('GET', `/api/tickets/${id}`, requester)).json<TicketDto>();
      // The type comes from the bytes, never from content_type.
      expect(dto.files.map((f) => [f.name, f.mime, f.size])).toEqual([
        ['chyba.png', 'image/png', PNG.length],
        ['rozpočet.pdf', 'application/pdf', PDF.length],
      ]);
      const rows = await groupFiles(g.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.attachedAt !== null && r.uploadedBy === null)).toBe(true);

      const png = await download(dto.files[0]!.id, requester);
      expect(png.statusCode).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect(png.rawPayload).toEqual(PNG);
      const pdf = await download(dto.files[1]!.id, requester);
      expect(pdf.headers['content-disposition']).toMatch(/^attachment;/);
      expect(pdf.rawPayload).toEqual(PDF);
      // Another ziadatel of the client does not read them.
      const other = await clientIn(g.id, 'ziadatel');
      expect((await download(dto.files[0]!.id, other.cookie)).statusCode).toBe(404);
    });

    it('a disallowed type is 400 naming the file and stores nothing', async () => {
      const g = await group();
      const requestId = randomUUID();
      const res = await intake({
        subject: 'Program',
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: requestId,
        files: [
          { name: 'a.png', content_base64: b64(PNG) },
          { name: 'setup.pdf', content_base64: b64(Buffer.from('MZ\x90\x00\x03\x00\x00\x00')) },
        ],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'validation_failed',
        fields: ['files[1].content_base64'],
      });
      expect(await findTicketByRequestId(db(), requestId)).toBeNull();
      expect(await groupFiles(g.id)).toHaveLength(0);
    });

    it('bad base64, a bad name and too many files are 400 with the field names', async () => {
      const file = { name: 'a.png', content_base64: b64(PNG) };
      const bad = await intake({
        subject: 'x',
        files: [file, { name: 'b.png', content_base64: 'iVBO Rw0K' }, { ...file, name: ' ' }],
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({
        error: 'validation_failed',
        fields: ['files[1].content_base64', 'files[2].name'],
      });
      const many = await intake({ subject: 'x', files: Array.from({ length: 11 }, () => file) });
      expect(many.json()).toEqual({ error: 'validation_failed', fields: ['files'] });
    });

    it('a file over 10 MiB or files over 20 MiB in total are 413; nothing is stored', async () => {
      const g = await group();
      const base = { subject: 'Veľké', instance_url: `https://${g.host}.egrant.sk` };
      const big = await intake({
        ...base,
        files: [
          { name: 'a.png', content_base64: b64(PNG) },
          { name: 'big.pdf', content_base64: zeros(10 * MiB + 1) },
        ],
      });
      expect(big.statusCode).toBe(413);
      expect(big.json()).toEqual({ error: 'file_too_large', fields: ['files[1].content_base64'] });
      const total = await intake({
        ...base,
        files: Array.from({ length: 3 }, (_, i) => ({
          name: `${i}.pdf`,
          content_base64: zeros(7_000_000),
        })),
      });
      expect(total.statusCode).toBe(413);
      expect(total.json()).toEqual({ error: 'file_too_large', fields: ['files'] });
      expect(await groupFiles(g.id)).toHaveLength(0);
    });

    it('takes a body up to 28 MiB on the intake only; 1 MiB stays the limit elsewhere', async () => {
      const g = await group();
      // 6 files of 3.3 MB: 19.8 MB decoded, about 26.4 MB of JSON.
      const pdf = b64(Buffer.concat([PDF, Buffer.alloc(3_300_000 - PDF.length)]));
      const res = await intake({
        subject: 'Takmer limit',
        instance_url: `https://${g.host}.egrant.sk`,
        files: Array.from({ length: 6 }, (_, i) => ({ name: `${i}.pdf`, content_base64: pdf })),
      });
      expect(res.statusCode).toBe(201);
      const over = await intake({ subject: 'x', body: 'y'.repeat(29 * MiB) });
      expect(over.statusCode).toBe(413);
      const a = await admin();
      const manual = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        subject: 'x',
        body: 'y'.repeat(MiB),
      });
      expect(manual.statusCode).toBe(413);
    });

    it('a repeated request_id answers 200 and stores no file again', async () => {
      const g = await group();
      const body = {
        subject: 'Opakovaný so súborom',
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: randomUUID(),
        files: [{ name: 'a.png', content_base64: b64(PNG) }],
      };
      expect((await intake(body)).statusCode).toBe(201);
      expect((await intake(body)).statusCode).toBe(200);
      const answers = await Promise.all(Array.from({ length: 4 }, () => intake(body)));
      expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      expect(await groupFiles(g.id)).toHaveLength(1);
    });

    it('concurrent first requests with one request_id keep the files of one ticket only', async () => {
      const g = await group();
      const body = {
        subject: 'Súbežný so súbormi',
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: randomUUID(),
        files: [
          { name: 'a.png', content_base64: b64(PNG) },
          { name: 'b.pdf', content_base64: b64(PDF) },
        ],
      };
      const answers = await Promise.all(Array.from({ length: 4 }, () => intake(body)));
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
      const rows = await groupFiles(g.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.attachedAt !== null)).toBe(true);
    });

    it('a storage failure fails the request without a ticket and removes stored files', async () => {
      const g = await group();
      const requestId = randomUUID();
      const storage = test.deps.storage;
      const put = storage.put.bind(storage);
      let calls = 0;
      storage.put = (key, data, type) =>
        ++calls === 2 ? Promise.reject(new Error('disk full')) : put(key, data, type);
      try {
        const res = await intake({
          subject: 'Plný disk',
          instance_url: `https://${g.host}.egrant.sk`,
          request_id: requestId,
          files: [
            { name: 'a.png', content_base64: b64(PNG) },
            { name: 'b.pdf', content_base64: b64(PDF) },
          ],
        });
        expect(res.statusCode).toBe(500);
      } finally {
        storage.put = put;
      }
      expect(await findTicketByRequestId(db(), requestId)).toBeNull();
      expect(await groupFiles(g.id)).toHaveLength(0);
    });

    it('a ticket without a client keeps its files for admins; they move with the client', async () => {
      const a = await admin();
      const email = newEmail();
      const res = await intake({
        subject: 'Bez klienta so súborom',
        email,
        instance_url: 'https://nobody.egrant.sk',
        files: [{ name: 'a.png', content_base64: b64(PNG) }],
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json<{ id: string }>();
      const before = (await call('GET', `/api/tickets/${id}`, a.cookie)).json<TicketDto>();
      expect(before.files.map((f) => f.name)).toEqual(['a.png']);
      const fileId = before.files[0]!.id;
      expect((await download(fileId, a.cookie)).rawPayload).toEqual(PNG);

      const g = await group();
      const outsider = await clientIn(g.id);
      expect((await download(fileId, outsider.cookie)).statusCode).toBe(404);
      const assigned = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g.id });
      expect(assigned.statusCode).toBe(200);
      expect((await groupFiles(g.id)).map((r) => r.id)).toEqual([fileId]);
      // Now the client's people and the requester read it.
      expect((await download(fileId, outsider.cookie)).statusCode).toBe(200);
      const requester = await loginAs(test.app, email);
      const dto = (await call('GET', `/api/tickets/${id}`, requester)).json<TicketDto>();
      expect(dto.files.map((f) => f.id)).toEqual([fileId]);
      expect((await download(fileId, requester)).rawPayload).toEqual(PNG);
    });
  });

  describe('reading', () => {
    it('a client reads every ticket of the group, a ziadatel only their own, others nothing', async () => {
      const g = await group();
      const other = await group();
      const client = await clientIn(g.id);
      const z = await clientIn(g.id, 'ziadatel');
      const stranger = await clientIn(other.id);
      const own = (
        await intake({
          subject: 'Moja',
          email: z.email,
          instance_url: `https://${g.host}.egrant.sk`,
        })
      ).json<{ id: string }>();
      const foreign = (
        await intake({
          subject: 'Cudzia',
          email: newEmail(),
          instance_url: `https://${g.host}.egrant.sk`,
        })
      ).json<{ id: string }>();

      const ids = async (cookie: string) =>
        (await call('GET', `/api/groups/${g.id}/tickets`, cookie))
          .json<TicketListResponse>()
          .items.map((t) => t.id);
      expect(await ids(client.cookie)).toEqual(expect.arrayContaining([own.id, foreign.id]));
      expect(await ids(z.cookie)).toEqual([own.id]);
      expect((await call('GET', `/api/groups/${g.id}/tickets`, stranger.cookie)).statusCode).toBe(
        404,
      );
      expect((await call('GET', `/api/tickets/${foreign.id}`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/tickets/${own.id}`, z.cookie)).statusCode).toBe(200);
      expect((await call('GET', `/api/tickets/${own.id}`, stranger.cookie)).statusCode).toBe(404);
      // The ziadatel membership opens nothing else of the group.
      expect((await call('GET', `/api/groups/${g.id}/board`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/groups/${g.id}/chat`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', '/api/tickets/global', client.cookie)).statusCode).toBe(403);
    });

    it('My tickets lists the tickets of two clients for one requester', async () => {
      const [a, b] = [await group('A'), await group('B')];
      const email = newEmail();
      const t1 = (
        await intake({ subject: '1', email, instance_url: `https://${a.host}.egrant.sk` })
      ).json<{ id: string }>();
      const t2 = (
        await intake({ subject: '2', email, instance_url: `https://${b.host}.egrant.sk` })
      ).json<{ id: string }>();
      const cookie = await loginAs(test.app, email);
      const mine = (await call('GET', '/api/tickets/mine', cookie)).json<TicketListResponse>();
      expect(mine.items.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
      expect(new Set(mine.items.map((t) => t.groupName))).toEqual(new Set(['A', 'B']));
      const requester = await findUserByEmail(db(), email);
      expect((await listMemberships(db(), requester!.id)).map((m) => m.role)).toEqual([
        'ziadatel',
        'ziadatel',
      ]);
    });

    it('filters by status and pages with a cursor', async () => {
      const g = await group();
      const a = await admin();
      const made: string[] = [];
      for (let i = 0; i < 52; i++) {
        made.push(
          (await intake({ subject: `T${i}`, instance_url: `https://${g.host}.egrant.sk` })).json<{
            id: string;
          }>().id,
        );
      }
      const first = (
        await call('GET', `/api/groups/${g.id}/tickets`, a.cookie)
      ).json<TicketListResponse>();
      expect(first.items).toHaveLength(50);
      expect(first.items[0]!.id).toBe(made[51]);
      const second = (
        await call('GET', `/api/groups/${g.id}/tickets?cursor=${first.nextCursor}`, a.cookie)
      ).json<TicketListResponse>();
      expect(second.items.map((t) => t.id)).toEqual([made[1], made[0]]);
      expect(second.nextCursor).toBeNull();

      await call('PATCH', `/api/tickets/${made[0]}`, a.cookie, { status: 'resolved' });
      const resolved = (
        await call('GET', `/api/groups/${g.id}/tickets?status=resolved`, a.cookie)
      ).json<TicketListResponse>();
      expect(resolved.items.map((t) => t.id)).toEqual([made[0]]);
      // The removed "Following" filter is ignored.
      const ignored = (
        await call('GET', `/api/groups/${g.id}/tickets?following=true&status=resolved`, a.cookie)
      ).json<TicketListResponse>();
      expect(ignored.items.map((t) => t.id)).toEqual([made[0]]);
      expect(
        (await call('GET', `/api/groups/${g.id}/tickets?cursor=bad`, a.cookie)).statusCode,
      ).toBe(400);
    });
  });

  describe('manual creation', () => {
    it('a client creates in their group as the initiator, without an email to themselves', async () => {
      const g = await group();
      const client = await clientIn(g.id);
      const before = await countEmailsTo(client.email);
      const res = await call('POST', '/api/tickets', client.cookie, {
        groupId: g.id,
        subject: 'Otázka',
        requesterEmail: null,
        requesterName: 'Ignored',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>()).toMatchObject({
        source: 'manual',
        requester: { userId: client.id, email: client.email },
      });
      expect(await countEmailsTo(client.email)).toBe(before);
    });

    it('a ziadatel cannot create (403), a stranger gets 404', async () => {
      const g = await group();
      const z = await clientIn(g.id, 'ziadatel');
      const stranger = await clientIn((await group()).id);
      expect(
        (await call('POST', '/api/tickets', z.cookie, { groupId: g.id, subject: 'x' })).statusCode,
      ).toBe(403);
      expect(
        (await call('POST', '/api/tickets', stranger.cookie, { groupId: g.id, subject: 'x' }))
          .statusCode,
      ).toBe(404);
    });

    it('an admin creates for a new email: a ziadatel account and the email', async () => {
      const g = await group();
      const a = await admin();
      const email = newEmail();
      const res = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        subject: 'Telefonát',
        requesterEmail: email,
        requesterName: 'Peter',
      });
      expect(res.statusCode).toBe(201);
      const dto = res.json<TicketDto>();
      expect((await latestEmail(email)).subject).toContain(`#${dto.number}`);
      const account = await findUserByEmail(db(), email);
      expect((await getMembership(db(), account!.id, g.id))?.role).toBe('ziadatel');
    });
  });

  describe('a manager creates on behalf of another person (2026-10-23)', () => {
    it('a new email: a ziadatel account in the group, the email, and the requester reads it', async () => {
      const g = await group();
      const manager = await clientIn(g.id);
      const email = newEmail();
      const res = await call('POST', '/api/tickets', manager.cookie, {
        groupId: g.id,
        subject: 'Za kolegu',
        requesterEmail: email,
        requesterName: 'Peter Kolega',
        requesterPhone: '+421900111222',
      });
      expect(res.statusCode).toBe(201);
      const dto = res.json<TicketDto>();
      // The manager sees the initiator's name, email and phone, never their account id.
      expect(dto.requester).toEqual({
        userId: null,
        name: 'Peter Kolega',
        email,
        phone: '+421900111222',
      });
      expect(dto.createdBy).toBe(manager.id);
      expect((await latestEmail(email)).subject).toContain(`#${dto.number}`);
      const account = await findUserByEmail(db(), email);
      expect((await getMembership(db(), account!.id, g.id))?.role).toBe('ziadatel');
      const [row] = await db().select().from(tickets).where(eq(tickets.id, dto.id));
      expect(row!.requesterUserId).toBe(account!.id);
      // The requester reads their ticket and sees their own account id.
      const cookie = await loginAs(test.app, email);
      const own = await call('GET', `/api/tickets/${dto.id}`, cookie);
      expect(own.statusCode).toBe(200);
      expect(own.json<TicketDto>().requester.userId).toBe(account!.id);
      const mine = (await call('GET', '/api/tickets/mine', cookie)).json<TicketListResponse>();
      expect(mine.items.map((t) => t.id)).toEqual([dto.id]);
    });

    it('an existing account is matched by email (a client of another group becomes a ziadatel)', async () => {
      const g = await group();
      const manager = await clientIn(g.id);
      const elsewhere = await clientIn((await group()).id);
      const res = await call('POST', '/api/tickets', manager.cookie, {
        groupId: g.id,
        subject: 'x',
        requesterEmail: `  ${elsewhere.email.toUpperCase()} `,
      });
      expect(res.statusCode).toBe(201);
      const [row] = await db().select().from(tickets).where(eq(tickets.id, res.json().id));
      expect(row!.requesterUserId).toBe(elsewhere.id);
      expect((await getMembership(db(), elsewhere.id, g.id))?.role).toBe('ziadatel');
      expect((await latestEmail(elsewhere.email)).subject).toContain(`#${row!.number}`);
    });

    it('another manager of the group as the initiator: linked, emailed, sees the ticket', async () => {
      const g = await group();
      const manager = await clientIn(g.id);
      const colleague = await clientIn(g.id);
      const res = await call('POST', '/api/tickets', manager.cookie, {
        groupId: g.id,
        subject: 'x',
        requesterEmail: colleague.email,
      });
      expect(res.statusCode).toBe(201);
      const id = res.json<TicketDto>().id;
      const [row] = await db().select().from(tickets).where(eq(tickets.id, id));
      expect(row!.requesterUserId).toBe(colleague.id);
      expect((await getMembership(db(), colleague.id, g.id))?.role).toBe('client');
      expect((await latestEmail(colleague.email)).subject).toContain(`#${row!.number}`);
      const seen = await call('GET', `/api/tickets/${id}`, colleague.cookie);
      expect(seen.json<TicketDto>().requester.userId).toBe(colleague.id);
    });

    it('a ziadatel cannot set the initiator: still 403', async () => {
      const g = await group();
      const z = await clientIn(g.id, 'ziadatel');
      const res = await call('POST', '/api/tickets', z.cookie, {
        groupId: g.id,
        subject: 'x',
        requesterEmail: newEmail(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('a manager of another group, a removed manager or a deactivated group: 404, no ticket, no account', async () => {
      const g = await group();
      const other = await clientIn((await group()).id);
      const removed = await clientIn(g.id);
      await removeMembership(db(), g.id, removed.id);
      const dg = await group();
      const inDeactivated = await clientIn(dg.id);
      await setGroupDeactivated(db(), dg.id, true);
      for (const [who, groupId] of [
        [other, g.id],
        [removed, g.id],
        [inDeactivated, dg.id],
      ] as const) {
        const email = newEmail();
        const res = await call('POST', '/api/tickets', who.cookie, {
          groupId,
          subject: 'x',
          requesterEmail: email,
        });
        expect(res.statusCode).toBe(404);
        expect(await findUserByEmail(db(), email)).toBeNull();
      }
    });
  });

  describe('requester.userId only for admins and the requester (2026-10-23)', () => {
    it('another manager and a list reader get null; the admin and the requester the id', async () => {
      const g = await group();
      const manager = await clientIn(g.id);
      const z = await clientIn(g.id, 'ziadatel');
      const a = await admin();
      const created = await intake({
        subject: 'Moja',
        email: z.email,
        instance_url: `https://${g.host}.egrant.sk`,
      });
      const id = created.json<{ id: string }>().id;
      const userIdFor = async (cookie: string) =>
        (await call('GET', `/api/tickets/${id}`, cookie)).json<TicketDto>().requester.userId;
      expect(await userIdFor(manager.cookie)).toBeNull();
      expect(await userIdFor(z.cookie)).toBe(z.id);
      expect(await userIdFor(a.cookie)).toBe(z.id);
      // The detail read after a change (what a socket push makes the client refetch) too.
      const patched = await call('PATCH', `/api/tickets/${id}`, a.cookie, {
        status: 'in_progress',
      });
      expect(patched.json<TicketDto>().requester.userId).toBe(z.id);
      expect(await userIdFor(manager.cookie)).toBeNull();
    });
  });

  describe("an admin's email as the initiator", () => {
    const accountsWith = async (email: string) =>
      (
        await db()
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email.trim().toLowerCase()))
      ).length;
    // Gmail ignores dots and a "+tag" in the local part; googlemail.com is gmail.com.
    const gmailAdmin = async () => {
      const local = `ad.${randomUUID().slice(0, 8)}`;
      const a = await admin();
      const email = `${local}@gmail.com`;
      await db().execute(sql`update "user" set email = ${email} where id = ${a.id}`);
      return { ...a, email, local };
    };

    it('manual create by another admin, email in another case and with spaces: that admin, no new account', async () => {
      const g = await group();
      const owner = await admin();
      const manager = await admin();
      const res = await call('POST', '/api/tickets', owner.cookie, {
        groupId: g.id,
        subject: 'Chyba',
        requesterEmail: `  ${manager.email.toUpperCase()} `,
        requesterName: 'Iné meno',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>().requester.userId).toBe(manager.id);
      expect(await accountsWith(manager.email)).toBe(1);
      expect(await listMemberships(db(), manager.id)).toEqual([]);
    });

    it('intake with an admin email: that admin, no new account and no membership', async () => {
      const g = await group();
      const manager = await admin();
      const res = await intake({
        subject: 'x',
        email: ` ${manager.email.toUpperCase()}`,
        name: 'Niekto',
        instance_url: `https://${g.host}.egrant.sk`,
      });
      expect(res.statusCode).toBe(201);
      const [row] = await db().select().from(tickets).where(eq(tickets.id, res.json().id));
      expect(row!.requesterUserId).toBe(manager.id);
      expect(await accountsWith(manager.email)).toBe(1);
      expect(await listMemberships(db(), manager.id)).toEqual([]);
      // No one-click link for an admin: the login page with the email filled in.
      const mail = await latestEmail(manager.email);
      expect(mail.text).toContain(
        `/login?redirect=${encodeURIComponent(`/tickets/${res.json().id}`)}&email=`,
      );
      expect(mail.text).not.toContain('/t#');
    });

    it('a disabled admin: no account linked, no new account', async () => {
      const g = await group();
      const owner = await admin();
      const gone = await admin();
      await deactivateUser(db(), gone.id);
      const res = await call('POST', '/api/tickets', owner.cookie, {
        groupId: g.id,
        subject: 'x',
        requesterEmail: gone.email.toUpperCase(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>().requester.userId).toBeNull();
      expect(await accountsWith(gone.email)).toBe(1);
      expect(await listMemberships(db(), gone.id)).toEqual([]);
    });

    it('a ticket assigned a client later: the admin, no new account', async () => {
      const g = await group();
      const owner = await admin();
      const manager = await admin();
      const res = await intake({
        subject: 'x',
        email: manager.email,
        instance_url: 'https://nobody.egrant.sk',
      });
      const id = res.json().id as string;
      const moved = await call('PUT', `/api/tickets/${id}/group`, owner.cookie, { groupId: g.id });
      expect(moved.statusCode).toBe(200);
      expect(moved.json<TicketDto>().requester.userId).toBe(manager.id);
      expect(await accountsWith(manager.email)).toBe(1);
      expect(await listMemberships(db(), manager.id)).toEqual([]);
    });

    it('a gmail admin typed with dots, a +tag or googlemail.com: that admin, no new account', async () => {
      const g = await group();
      const owner = await admin();
      const manager = await gmailAdmin();
      const variant = `${manager.local.replaceAll('.', '')}+spolu@googlemail.com`;
      const res = await call('POST', '/api/tickets', owner.cookie, {
        groupId: g.id,
        subject: 'x',
        requesterEmail: variant,
        requesterName: 'Iné meno',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>().requester.userId).toBe(manager.id);
      expect(await accountsWith(variant)).toBe(0);
      expect(await listMemberships(db(), manager.id)).toEqual([]);
    });
  });

  describe('changes', () => {
    it('only admins edit; resolving sets resolved_at, reopening clears it', async () => {
      const g = await group();
      const a = await admin();
      const client = await clientIn(g.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g.host}.egrant.sk` })
      ).json<{ id: string }>();
      expect(
        (await call('PATCH', `/api/tickets/${id}`, client.cookie, { status: 'resolved' }))
          .statusCode,
      ).toBe(403);
      const stranger = await clientIn((await group()).id);
      expect(
        (await call('PATCH', `/api/tickets/${id}`, stranger.cookie, { status: 'resolved' }))
          .statusCode,
      ).toBe(404);
      const resolved = (
        await call('PATCH', `/api/tickets/${id}`, a.cookie, { status: 'resolved' })
      ).json<TicketDto>();
      expect(resolved.resolvedAt).not.toBeNull();
      const reopened = (
        await call('PATCH', `/api/tickets/${id}`, a.cookie, {
          status: 'in_progress',
          subject: 'Nový',
        })
      ).json<TicketDto>();
      expect(reopened).toMatchObject({ status: 'in_progress', resolvedAt: null, subject: 'Nový' });
    });

    it('assigning a client sends the email once; the initiator reads it in the new client', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const email = newEmail();
      const { id } = (await intake({ subject: 'Kam?', email })).json<{ id: string }>();
      expect(await countEmailsTo(email)).toBe(0);

      expect(
        (await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g1.id })).statusCode,
      ).toBe(200);
      await latestEmail(email);
      expect(await countEmailsTo(email)).toBe(1);
      const requester = (await findUserByEmail(db(), email))!;
      const zCookie = await loginAs(test.app, email);

      // The ziadatel of the first client is told the ticket left, and loses it.
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: zCookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));
      const moved = new Promise<unknown>((resolve) => socket.once('ticket:moved', resolve));
      const mailsBefore = await countEmailsTo(email);

      const res = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      expect(res.statusCode).toBe(200);
      expect(await moved).toEqual({ ticketId: id, groupId: g1.id });
      expect(await countEmailsTo(email)).toBe(mailsBefore); // never a second "Ticket created"
      // Same email, so the requester is now the new client's ziadatel and still reads it.
      expect((await getMembership(db(), requester.id, g2.id))?.role).toBe('ziadatel');
      expect((await call('GET', `/api/tickets/${id}`, zCookie)).statusCode).toBe(200);
    });

    it('a client of the old client cannot read it in the new one', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const client = await clientIn(g1.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g1.host}.egrant.sk` })
      ).json<{ id: string }>();
      expect((await call('GET', `/api/tickets/${id}`, client.cookie)).statusCode).toBe(200);
      await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      expect((await call('GET', `/api/tickets/${id}`, client.cookie)).statusCode).toBe(404);
    });

    it('a ticket with tasks cannot move (409 has_tasks)', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g1.host}.egrant.sk` })
      ).json<{ id: string }>();
      const board = await getBoard(db(), g1.id);
      await db().insert(tasks).values({
        id: randomUUID(),
        groupId: g1.id,
        bucketId: board.buckets[0]!.id,
        position: 'a0',
        title: 'Z tiketu',
        createdBy: a.id,
        sourceTicketId: id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const res = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'has_tasks' });
    });

    it('per-ticket following is gone (owner decision 2026-10-17)', async () => {
      const g = await group();
      const client = await clientIn(g.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g.host}.egrant.sk` })
      ).json<{ id: string }>();
      expect((await call('PUT', `/api/tickets/${id}/follow`, client.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/tickets/${id}/followers`, client.cookie)).statusCode).toBe(
        404,
      );
      expect((await call('GET', `/api/tickets/${id}`, client.cookie)).json()).not.toHaveProperty(
        'following',
      );
    });
  });

  it('F16: the text naming a client notifies them on create and on an edit, only the new ones', async () => {
    const g = await group();
    const a = await admin();
    const named = async () => {
      const c = await createUnverifiedClient(db(), newEmail(), 'Klára');
      await addMembership(db(), c.id, g.id, 'client');
      await loginAs(test.app, c.email);
      return c;
    };
    const ana = await named();
    const bea = await named();
    const mentioned = async (ticketId: string) =>
      (
        await db()
          .select({ userId: notificationEvents.userId })
          .from(notificationEvents)
          .where(
            and(
              eq(notificationEvents.kind, 'description.mention'),
              sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
            ),
          )
      )
        .map((r) => r.userId)
        .sort();
    const created = await call('POST', '/api/tickets', a.cookie, {
      groupId: g.id,
      subject: 'Prístup',
      body: `Pozri <@${ana.id}>`,
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<TicketDto>();
    expect(await mentioned(id)).toEqual([ana.id]);
    const edited = await call('PATCH', `/api/tickets/${id}`, a.cookie, {
      body: `Pozri <@${ana.id}> a <@${bea.id}>`,
    });
    expect(edited.statusCode).toBe(200);
    expect(await mentioned(id)).toEqual([ana.id, bea.id].sort());
  });
});
