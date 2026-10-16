import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FileInfo } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { files } from './schema.js';
import { attachFiles, getFilesForGroup, setFilesAdminsOnly } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest of a png'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const MB = 1024 * 1024;

describe('files API', () => {
  let test: TestApp;
  let port: number;

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    port = (test.app.server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  async function clientIn(groupId: string) {
    const email = `${randomUUID()}@example.com`;
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'A Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  async function admin() {
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'File Admin' });
    return { cookie: await loginAs(test.app, email) };
  }

  const upload = (
    groupId: string,
    cookie: string | undefined,
    payload: Buffer | Readable,
    headers: Record<string, string> = {},
  ) =>
    test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/files`,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      payload,
    });

  const get = (url: string, cookie?: string) =>
    test.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  const putPreview = (
    id: string,
    cookie: string,
    payload: Buffer,
    headers: Record<string, string> = { 'x-image-width': '100', 'x-image-height': '50' },
  ) =>
    test.app.inject({
      method: 'PUT',
      url: `/api/files/${id}/preview`,
      headers: { cookie, 'content-type': 'image/webp', ...headers },
      payload,
    });

  const countRows = async (groupId: string) =>
    (await test.deps.db.select().from(files).where(eq(files.groupId, groupId))).length;

  /** A client with a PNG file already uploaded. */
  async function withPng() {
    const group = await newGroup();
    const client = await clientIn(group.id);
    const res = await upload(group.id, client.cookie, PNG, { 'content-type': 'image/png' });
    return { group, client, file: res.json<FileInfo>() };
  }

  describe('upload and download', () => {
    it('a client uploads to their group and downloads the same bytes', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const body = Buffer.from('%PDF-1.4 fake');
      const res = await upload(group.id, client.cookie, body, {
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent('Zmluva č. 1.pdf'),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<FileInfo>()).toMatchObject({
        name: 'Zmluva č. 1.pdf',
        mime: 'application/pdf',
        size: body.length,
      });

      const download = await get(`/api/files/${res.json<FileInfo>().id}`, client.cookie);
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(body)).toBe(true);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['content-disposition']).toBe(
        "attachment; filename*=UTF-8''Zmluva%20%C4%8D.%201.pdf",
      );
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    });

    it('percent-encodes quotes, parentheses and asterisks in the file name', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, Buffer.from('x'), {
        'content-type': 'text/plain',
        'x-file-name': encodeURIComponent("a'(b)*.txt"),
      });
      const download = await get(`/api/files/${res.json<FileInfo>().id}`, client.cookie);
      expect(download.headers['content-disposition']).toBe(
        "attachment; filename*=UTF-8''a%27%28b%29%2A.txt",
      );
    });

    it('an admin uploads to any group', async () => {
      const group = await newGroup();
      const { cookie } = await admin();
      const res = await upload(group.id, cookie, Buffer.from('hi'), {
        'content-type': 'text/plain',
      });
      expect(res.statusCode).toBe(201);
      expect((await get(`/api/files/${res.json<FileInfo>().id}`, cookie)).statusCode).toBe(200);
    });

    it('a client of another group gets 404 on upload, download and preview', async () => {
      const { file, group } = await withPng();
      const other = await clientIn((await newGroup()).id);
      expect((await upload(group.id, other.cookie, Buffer.from('x'))).statusCode).toBe(404);
      expect((await get(`/api/files/${file.id}`, other.cookie)).statusCode).toBe(404);
      expect((await get(`/api/files/${file.id}/preview`, other.cookie)).statusCode).toBe(404);
      expect((await putPreview(file.id, other.cookie, WEBP)).statusCode).toBe(404);
    });

    it('a client gets 404 for an admins-only file of their own group; an admin reads it', async () => {
      const { file, client } = await withPng();
      await setFilesAdminsOnly(test.deps.db, [file.id], true);
      expect((await get(`/api/files/${file.id}`, client.cookie)).statusCode).toBe(404);
      expect((await get(`/api/files/${file.id}/preview`, client.cookie)).statusCode).toBe(404);
      const { cookie } = await admin();
      expect((await get(`/api/files/${file.id}`, cookie)).statusCode).toBe(200);
      await setFilesAdminsOnly(test.deps.db, [file.id], false);
      expect((await get(`/api/files/${file.id}`, client.cookie)).statusCode).toBe(200);
    });

    it('unknown group or file answers 404', async () => {
      const { cookie } = await admin();
      expect((await upload(randomUUID(), cookie, Buffer.from('x'))).statusCode).toBe(404);
      expect((await get(`/api/files/${randomUUID()}`, cookie)).statusCode).toBe(404);
      expect((await get(`/api/files/${randomUUID()}/preview`, cookie)).statusCode).toBe(404);
    });

    it('an anonymous caller gets 401', async () => {
      const group = await newGroup();
      expect((await upload(group.id, undefined, Buffer.from('x'))).statusCode).toBe(401);
      expect((await get(`/api/files/${randomUUID()}`)).statusCode).toBe(401);
      expect((await get(`/api/files/${randomUUID()}/preview`)).statusCode).toBe(401);
    });

    it('an HTML file is served as attachment', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, Buffer.from('<script>alert(1)</script>'), {
        'content-type': 'text/html',
        'x-file-name': 'page.html',
      });
      const download = await get(`/api/files/${res.json<FileInfo>().id}`, client.cookie);
      expect(download.headers['content-disposition']).toMatch(/^attachment; /);
      expect(download.headers['x-content-type-options']).toBe('nosniff');
    });

    it('a PNG declared as application/pdf is served inline as image/png', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, PNG, { 'content-type': 'application/pdf' });
      const download = await get(`/api/files/${res.json<FileInfo>().id}`, client.cookie);
      expect(download.headers['content-type']).toBe('image/png');
      expect(download.headers['content-disposition']).toBe('inline');
    });

    it('stores application/octet-stream when content-type is missing', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, Buffer.from('abc'));
      expect(res.statusCode).toBe(201);
      expect(res.json<FileInfo>().mime).toBe('application/octet-stream');
    });

    it("stores the name 'file' when x-file-name is missing", async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, Buffer.from('abc'), {
        'content-type': 'text/plain',
      });
      expect(res.json<FileInfo>().name).toBe('file');
    });
  });

  describe('limits and failures', () => {
    it('content-length over 25 MB answers 413 file_too_large', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const res = await upload(group.id, client.cookie, Buffer.alloc(25 * MB + 1), {
        'content-type': 'application/octet-stream',
      });
      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({ error: 'file_too_large' });
      expect(await countRows(group.id)).toBe(0);
    });

    it('a chunked body over 25 MB answers 413 and stores no row', async () => {
      // Real HTTP: inject cannot observe a response after the server drops the request stream.
      const group = await newGroup();
      const client = await clientIn(group.id);
      const outcome = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/api/groups/${group.id}/files`,
            headers: { cookie: client.cookie, 'content-type': 'application/octet-stream' },
          },
          (res) => {
            let body = '';
            res.on('data', (d: Buffer) => (body += d.toString()));
            res.on('end', () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on('error', reject);
        const chunk = Buffer.alloc(MB);
        let sent = 0;
        const write = () => {
          while (sent < 26) {
            sent += 1;
            if (!req.write(chunk)) return void req.once('drain', write);
          }
          req.end();
        };
        write();
      });
      expect(outcome.status).toBe(413);
      expect(JSON.parse(outcome.body)).toEqual({ error: 'file_too_large' });
      expect(await countRows(group.id)).toBe(0);
    });

    it('the 61st upload in a minute answers 429 rate_limited', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      for (let i = 0; i < 60; i += 1) {
        const res = await upload(group.id, client.cookie, Buffer.from('x'));
        expect(res.statusCode).toBe(201);
      }
      const res = await upload(group.id, client.cookie, Buffer.from('x'));
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'rate_limited' });
      // 61 sequential uploads with their writes: under the full parallel suite this can pass 5 s,
      // and a timed-out run kept going and took the next test's storage mock.
    }, 30_000);

    it('a storage failure answers 500 and leaves no row', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const spy = vi.spyOn(test.deps.storage, 'put').mockRejectedValueOnce(new Error('disk full'));
      const res = await upload(group.id, client.cookie, Buffer.from('data'));
      spy.mockRestore();
      expect(res.statusCode).toBe(500);
      expect(await countRows(group.id)).toBe(0);
    });
  });

  describe('preview', () => {
    it('the uploader sets a preview and it streams back', async () => {
      const { group, client, file } = await withPng();
      const res = await putPreview(file.id, client.cookie, WEBP);
      expect(res.statusCode).toBe(204);

      const [info] = await getFilesForGroup(test.deps.db, group.id, [file.id]);
      expect(info).toMatchObject({ hasPreview: true, width: 100, height: 50 });

      const preview = await get(`/api/files/${file.id}/preview`, client.cookie);
      expect(preview.statusCode).toBe(200);
      expect(preview.rawPayload.equals(WEBP)).toBe(true);
      expect(preview.headers['content-type']).toBe('image/webp');
      expect(preview.headers['content-disposition']).toBe('inline');
      expect(preview.headers['x-content-type-options']).toBe('nosniff');
      expect(preview.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    });

    it('another member of the group gets 403', async () => {
      const { group, file } = await withPng();
      const other = await clientIn(group.id);
      const res = await putPreview(file.id, other.cookie, WEBP);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    });

    it('a PDF file answers 400 invalid_preview', async () => {
      const group = await newGroup();
      const client = await clientIn(group.id);
      const up = await upload(group.id, client.cookie, Buffer.from('%PDF-1.4'), {
        'content-type': 'application/pdf',
      });
      const res = await putPreview(up.json<FileInfo>().id, client.cookie, WEBP);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_preview' });
    });

    it('a non-WebP body answers 400 invalid_preview', async () => {
      const { client, file } = await withPng();
      const res = await putPreview(file.id, client.cookie, PNG);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_preview' });
    });

    it.each([
      ['0', '50'],
      ['abc', '50'],
      ['100', '20001'],
      ['100', '1.5'],
    ])('width %s and height %s answer 400 invalid_preview', async (width, height) => {
      const { client, file } = await withPng();
      const res = await putPreview(file.id, client.cookie, WEBP, {
        'x-image-width': width,
        'x-image-height': height,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_preview' });
    });

    it('missing dimensions answer 400 invalid_preview', async () => {
      const { client, file } = await withPng();
      const res = await putPreview(file.id, client.cookie, WEBP, {});
      expect(res.statusCode).toBe(400);
    });

    it('an attached file answers 400 invalid_preview', async () => {
      const { group, client, file } = await withPng();
      await attachFiles(test.deps.db, group.id, [file.id], client.id);
      const res = await putPreview(file.id, client.cookie, WEBP);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_preview' });
    });

    it('a second preview answers 400 invalid_preview', async () => {
      const { client, file } = await withPng();
      expect((await putPreview(file.id, client.cookie, WEBP)).statusCode).toBe(204);
      const res = await putPreview(file.id, client.cookie, WEBP);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_preview' });
    });

    it('two racing previews: exactly one wins, the other answers 400 invalid_preview', async () => {
      const { client, file } = await withPng();
      const results = await Promise.all([
        putPreview(file.id, client.cookie, WEBP),
        putPreview(file.id, client.cookie, WEBP),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 400]);
      const loser = results.find((r) => r.statusCode === 400)!;
      expect(loser.json()).toEqual({ error: 'invalid_preview' });
      expect((await get(`/api/files/${file.id}/preview`, client.cookie)).statusCode).toBe(200);
    });

    it('a body over 300 KB answers 413', async () => {
      const { client, file } = await withPng();
      const big = Buffer.concat([WEBP, Buffer.alloc(300 * 1024)]);
      expect((await putPreview(file.id, client.cookie, big)).statusCode).toBe(413);
    });

    it('GET preview without one answers 404', async () => {
      const { client, file } = await withPng();
      expect((await get(`/api/files/${file.id}/preview`, client.cookie)).statusCode).toBe(404);
    });
  });
});
