import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarFeedAnswerSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { countEmailsTo, emailWithSubject } from '../../../test/mail.js';
import { feedAdmin, feedClient, feedGroup } from '../../../test/calendar.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { addMembership } from '../groups/memberships.js';
import { createUnverifiedClient } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const include = { events: true, tasks: true, calls: true };
const subject = serverTexts('sk').calendarFeed.createdEmail.subject;

describe('/api/me/calendar-feed (ADR 0051)', () => {
  let test: TestApp;
  let groupId: string;

  const call = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
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
  const put = (cookie: string, body: object = { include }) =>
    call('PUT', '/api/me/calendar-feed', cookie, body);

  async function signedInAdmin() {
    const admin = await feedAdmin(test.deps.db);
    return { ...admin, cookie: await loginAs(test.app, admin.email) };
  }

  beforeAll(async () => {
    test = await buildTestApp();
    groupId = (await feedGroup(test.deps.db)).id;
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('GET answers { feed: null } before any feed', async () => {
    const admin = await signedInAdmin();
    const res = await call('GET', '/api/me/calendar-feed', admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ feed: null });
  });

  it('PUT creates (201) then updates (200) and the URL shape is right', async () => {
    const client = await feedClient(test.deps.db, [groupId]);
    const cookie = await loginAs(test.app, client.email);
    const created = await put(cookie);
    expect(created.statusCode, created.body).toBe(201);
    const { feed } = CalendarFeedAnswerSchema.parse(created.json());
    expect(feed!.url).toMatch(/^http.*\/api\/public\/calendar\/[A-Za-z0-9_-]{43}\/help\.ics$/);
    expect(feed!.webcalUrl.startsWith('webcal://')).toBe(true);
    const updated = await put(cookie, { include: { ...include, calls: false } });
    expect(updated.statusCode).toBe(200);
    const after = CalendarFeedAnswerSchema.parse(updated.json()).feed!;
    expect(after.url).toBe(feed!.url);
    expect(after.include).toEqual({ ...include, calls: false });
    const read = CalendarFeedAnswerSchema.parse(
      (await call('GET', '/api/me/calendar-feed', cookie)).json(),
    );
    expect(read.feed!.url).toBe(feed!.url);
  });

  it('refuses a body with a non-boolean tasks', async () => {
    const admin = await signedInAdmin();
    const res = await put(admin.cookie, { include: { ...include, tasks: 'managed' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('a requester-only person gets 403 and no session 401', async () => {
    const email = `${randomUUID()}@example.com`;
    const requester = await createUnverifiedClient(test.deps.db, email, 'Zia');
    await addMembership(test.deps.db, requester.id, groupId, 'ziadatel');
    const cookie = await loginAs(test.app, email);
    for (const [method, url] of [
      ['GET', '/api/me/calendar-feed'],
      ['PUT', '/api/me/calendar-feed'],
      ['POST', '/api/me/calendar-feed/rotate'],
      ['DELETE', '/api/me/calendar-feed'],
    ] as const) {
      const res = await call(method, url, cookie, method === 'PUT' ? { include } : undefined);
      expect({ method, status: res.statusCode }).toEqual({ method, status: 403 });
      expect((await call(method, url)).statusCode).toBe(401);
    }
  });

  it('rotate and delete are 404 without a feed; delete is 204', async () => {
    const admin = await signedInAdmin();
    expect((await call('POST', '/api/me/calendar-feed/rotate', admin.cookie)).statusCode).toBe(404);
    expect((await call('DELETE', '/api/me/calendar-feed', admin.cookie)).statusCode).toBe(404);
    const created = CalendarFeedAnswerSchema.parse((await put(admin.cookie)).json()).feed!;
    const rotated = await call('POST', '/api/me/calendar-feed/rotate', admin.cookie);
    expect(rotated.statusCode).toBe(200);
    expect(CalendarFeedAnswerSchema.parse(rotated.json()).feed!.url).not.toBe(created.url);
    expect((await call('DELETE', '/api/me/calendar-feed', admin.cookie)).statusCode).toBe(204);
    expect((await call('GET', '/api/me/calendar-feed', admin.cookie)).json()).toEqual({
      feed: null,
    });
  });

  it('sends the created email on create and rotate, not on a settings change', async () => {
    const admin = await signedInAdmin();
    const before = await countEmailsTo(admin.email);
    await put(admin.cookie);
    const mail = await emailWithSubject(admin.email, subject);
    expect(mail.text).not.toContain('/api/public/calendar/');
    await put(admin.cookie, { include: { ...include, events: false } });
    expect(await countEmailsTo(admin.email)).toBe(before + 1);
    await call('POST', '/api/me/calendar-feed/rotate', admin.cookie);
    await expect.poll(() => countEmailsTo(admin.email)).toBe(before + 2);
    await call('DELETE', '/api/me/calendar-feed', admin.cookie);
    expect(await countEmailsTo(admin.email)).toBe(before + 2);
  });

  it('rate-limits writes to 20 an hour', async () => {
    const admin = await signedInAdmin();
    for (let i = 0; i < 20; i++) expect((await put(admin.cookie)).statusCode).toBeLessThan(300);
    const res = await put(admin.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });
});
