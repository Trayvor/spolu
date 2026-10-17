import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { GIF, jpegBytes, pngBytes } from '../../../test/bulk-images.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bulkCampaigns } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const audience = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};

describe('bulk email images and preview API', () => {
  let test: TestApp;
  let adminCookie: string;
  let clientCookie: string;

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'Eva Admin' });
    adminCookie = await loginAs(test.app, email);
    const clientEmail = `${randomUUID()}@example.com`;
    await test.deps.db.insert(user).values({
      id: randomUUID(),
      email: clientEmail,
      name: 'A Client',
      role: 'client',
      emailVerified: true,
    });
    clientCookie = await loginAs(test.app, clientEmail);
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const upload = (payload: Buffer, cookie?: string, type = 'image/png') =>
    test.app.inject({
      method: 'POST',
      url: '/api/bulk-email/images',
      headers: { 'content-type': type, ...(cookie ? { cookie } : {}) },
      payload,
    });

  const newCampaign = async () => {
    const id = randomUUID();
    await test.deps.db.insert(bulkCampaigns).values({ id, name: 'News', audience });
    return id;
  };

  const preview = (id: string, payload: unknown, cookie?: string) =>
    test.app.inject({
      method: 'POST',
      url: `/api/bulk-email/campaigns/${id}/preview`,
      headers: cookie ? { cookie } : {},
      payload: payload as object,
    });

  describe('POST /api/bulk-email/images', () => {
    it('PNG and JPEG upload answer 201 with width and height', async () => {
      const png = await upload(pngBytes(320, 240), adminCookie);
      expect(png.statusCode).toBe(201);
      const body = png.json();
      expect(body).toMatchObject({ width: 320, height: 240 });
      expect(body.url).toBe(`http://localhost:3000/api/bulk-email/images/${body.id}`);

      const jpeg = await upload(jpegBytes(800, 600), adminCookie, 'image/jpeg');
      expect(jpeg.statusCode).toBe(201);
      expect(jpeg.json()).toMatchObject({ width: 800, height: 600 });
    });

    it('the type comes from the bytes: a GIF sent as image/png → 415 unsupported_type', async () => {
      const res = await upload(GIF, adminCookie);
      expect(res.statusCode).toBe(415);
      expect(res.json()).toEqual({ error: 'unsupported_type' });
    });

    it('a JSON body is not an image → 415', async () => {
      const res = await upload(Buffer.from('{"a":1}'), adminCookie, 'application/json');
      expect(res.statusCode).toBe(415);
    });

    it('3 MB → 413', async () => {
      const res = await upload(pngBytes(10, 10, 3 * 1024 * 1024), adminCookie);
      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({ error: 'file_too_large' });
    });

    it('client upload → 403, anonymous → 401', async () => {
      expect((await upload(pngBytes(1, 1), clientCookie)).statusCode).toBe(403);
      expect((await upload(pngBytes(1, 1))).statusCode).toBe(401);
    });

    it('31st upload a minute from one admin → 429', async () => {
      const email = `${randomUUID()}@example.com`;
      await addAdmin(test.deps.db, { email, name: 'Busy Admin' });
      const cookie = await loginAs(test.app, email);
      const codes: number[] = [];
      for (let n = 0; n < 31; n++) codes.push((await upload(pngBytes(2, 2), cookie)).statusCode);
      expect(codes.slice(0, 30).every((c) => c === 201)).toBe(true);
      expect(codes[30]).toBe(429);
    });
  });

  describe('GET /api/bulk-email/images/:id (public)', () => {
    it('serves the bytes without a session, with safe headers and a public immutable cache', async () => {
      const bytes = jpegBytes(50, 40);
      const { id } = (await upload(bytes, adminCookie, 'image/jpeg')).json();
      const res = await test.app.inject({ method: 'GET', url: `/api/bulk-email/images/${id}` });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(bytes)).toBe(true);
      expect(res.headers).toMatchObject({
        'content-type': 'image/jpeg',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'content-security-policy': "default-src 'none'",
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'cross-origin',
        'content-length': String(bytes.length),
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('ignores a session cookie (same answer, no cookie set)', async () => {
      const { id } = (await upload(pngBytes(5, 5), adminCookie)).json();
      const res = await test.app.inject({
        method: 'GET',
        url: `/api/bulk-email/images/${id}`,
        headers: { cookie: clientCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('unknown id → 404', async () => {
      const res = await test.app.inject({
        method: 'GET',
        url: `/api/bulk-email/images/${randomUUID()}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('a path-like id (../x) → 404', async () => {
      for (const url of [
        '/api/bulk-email/images/..%2Fx',
        '/api/bulk-email/images/..%2F..%2Fgroups',
        '/api/bulk-email/images/bulk%2Fx',
      ]) {
        expect((await test.app.inject({ method: 'GET', url })).statusCode).toBe(404);
      }
    });
  });

  describe('POST /api/bulk-email/campaigns/:id/preview', () => {
    const draft = {
      subject: 'Novinky',
      preheader: 'Krátko',
      blocks: [
        { id: 'h', type: 'heading', text: 'Ahoj {{name}}', align: 'left' },
        { id: 'b', type: 'button', label: 'Open', url: 'https://egrant.sk', align: 'center' },
      ],
    };

    it("renders the draft with the admin's name", async () => {
      const id = await newCampaign();
      const res = await preview(id, draft, adminCookie);
      expect(res.statusCode).toBe(200);
      const { html } = res.json();
      expect(html).toContain('Ahoj Eva Admin');
      expect(html).toContain('<title>Novinky</title>');
      expect(html).toContain('Krátko');
      expect(html).toContain('Tento e-mail dostávate');
      // The builder's highlight finds each block by its id (never in a sent email).
      expect(html).toContain('data-sp-block="h"');
      expect(html).toContain('data-sp-block="b"');
    });

    it('uses the stored size of an uploaded image', async () => {
      const id = await newCampaign();
      const image = (await upload(pngBytes(200, 100), adminCookie)).json();
      const res = await preview(
        id,
        { ...draft, blocks: [{ id: 'i', type: 'image', imageId: image.id, alt: 'Pic' }] },
        adminCookie,
      );
      expect(res.json().html).toMatch(/width="200" height="100"/);
    });

    it('403 for a client, 401 anonymous', async () => {
      const id = await newCampaign();
      expect((await preview(id, draft, clientCookie)).statusCode).toBe(403);
      expect((await preview(id, draft)).statusCode).toBe(401);
    });

    it('unknown campaign → 404', async () => {
      expect((await preview(randomUUID(), draft, adminCookie)).statusCode).toBe(404);
    });

    it('a javascript: button URL → 400 validation_failed', async () => {
      const id = await newCampaign();
      const res = await preview(
        id,
        {
          ...draft,
          blocks: [
            { id: 'b', type: 'button', label: 'x', url: 'javascript:alert(1)', align: 'left' },
          ],
        },
        adminCookie,
      );
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    });
  });
});
