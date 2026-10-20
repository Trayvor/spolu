import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiToolsInfoSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { createFakeTextTools } from './text-tools.js';
import { createFakeTranscription, FAKE_TRANSCRIPT } from './transcription.js';

// Lower burst limits (config.aiBurstLimits): the rate-limit test sends a few requests, not 33.
const BURST = { textPerMinute: 4, voicePerMinute: 2 };

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const newGroup = (app: TestApp) =>
  createGroup(app.deps.db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`,
  });

describe('AI text tools and voice outside a client group (admins only)', () => {
  let test: TestApp;
  let off: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    [test, off] = await Promise.all([
      buildTestApp({
        config: { aiBurstLimits: BURST },
        textTools: createFakeTextTools(),
        transcription: createFakeTranscription(),
      }),
      buildTestApp(),
    ]);
    await ensureAdminGroup(test.deps.db);
    await ensureAdminGroup(off.deps.db);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await Promise.all([test.app.close(), off.app.close()]);
    await Promise.all([test.close(), off.close()]);
  });

  const call = (
    app: TestApp,
    method: 'GET' | 'POST',
    url: string,
    cookie?: string,
    payload?: object,
  ) =>
    app.app.inject({
      method,
      url,
      ...(cookie ? { headers: { cookie } } : {}),
      ...(payload ? { payload } : {}),
    });
  const transcribe = (app: TestApp, cookie: string) =>
    app.app.inject({
      method: 'POST',
      url: '/api/ai/admin/transcribe',
      headers: { cookie, 'content-type': 'audio/webm' },
      payload: Buffer.from('fake-audio'),
    });
  const rewrite = (app: TestApp, cookie: string, body: object = { action: 'fix', text: 'a' }) =>
    call(app, 'POST', '/api/ai/admin/ai-text', cookie, body);

  async function adminOf(app: TestApp) {
    const email = newEmail();
    const a = await addAdmin(app.deps.db, { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(app.app, email) };
  }
  async function clientOf(app: TestApp, role: 'client' | 'ziadatel') {
    const group = await newGroup(app);
    const c = await createUnverifiedClient(app.deps.db, newEmail());
    await addMembership(app.deps.db, c.id, group.id, role);
    return { ...c, cookie: await loginAs(app.app, c.email) };
  }

  it('an admin gets the tools (no translate), the rewrite and the transcript', async () => {
    const admin = await adminOf(test);
    const info = await call(test, 'GET', '/api/ai/admin/ai-tools', admin.cookie);
    expect(info.statusCode).toBe(200);
    expect(AiToolsInfoSchema.parse(info.json())).toEqual({
      text: true,
      translate: null,
      voice: true,
      translateIncoming: true,
    });
    expect(
      (await rewrite(test, admin.cookie, { action: 'fix', text: 'ahoj ako sa mas' })).json(),
    ).toEqual({ text: 'Ahoj ako sa mas.' });
    expect((await transcribe(test, admin.cookie)).json()).toEqual({ text: FAKE_TRANSCRIPT });
    // Translate needs an eGrant URL, which the admin group lacks.
    expect(
      (await rewrite(test, admin.cookie, { action: 'translate', target: 'en', text: 'ahoj' }))
        .statusCode,
    ).toBe(400);
  });

  it('a client, a ziadatel and an anonymous caller are refused on every route', async () => {
    for (const who of [await clientOf(test, 'client'), await clientOf(test, 'ziadatel')]) {
      expect((await call(test, 'GET', '/api/ai/admin/ai-tools', who.cookie)).statusCode).toBe(403);
      expect((await rewrite(test, who.cookie)).statusCode).toBe(403);
      expect((await transcribe(test, who.cookie)).statusCode).toBe(403);
    }
    expect((await call(test, 'GET', '/api/ai/admin/ai-tools')).statusCode).toBe(401);
    expect((await call(test, 'POST', '/api/ai/admin/ai-text')).statusCode).toBe(401);
  });

  it('answers 503 when AI is off, and the tools say so', async () => {
    const admin = await adminOf(off);
    expect((await call(off, 'GET', '/api/ai/admin/ai-tools', admin.cookie)).json()).toEqual({
      text: false,
      translate: null,
      voice: false,
    });
    expect((await rewrite(off, admin.cookie)).statusCode).toBe(503);
    expect((await transcribe(off, admin.cookie)).statusCode).toBe(503);
  });

  it('shares the per-user limit with the group routes', async () => {
    const admin = await adminOf(test);
    const group = await newGroup(test);
    const half = Math.floor(BURST.textPerMinute / 2);
    for (let i = 0; i < BURST.textPerMinute; i++) {
      const url = i < half ? '/api/ai/admin/ai-text' : `/api/groups/${group.id}/ai-text`;
      const res = await call(test, 'POST', url, admin.cookie, { action: 'fix', text: 'a' });
      expect(res.statusCode).toBe(200);
    }
    expect((await rewrite(test, admin.cookie)).statusCode).toBe(429);
  });
});
