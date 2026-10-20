import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiToolsInfoSchema, type GroupChannel } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { createFakeTextTools } from './text-tools.js';
import { createFakeTranscription, FAKE_TRANSCRIPT } from './transcription.js';

// Lower burst limits (config.aiBurstLimits): the rate-limit test sends a few requests, not 33.
const BURST = { textPerMinute: 4, voicePerMinute: 2 };

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `g${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('AI text tools and voice for descriptions (Phase 33 part P5)', () => {
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
    cookie: string,
    payload?: object,
  ) => app.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const transcribe = (app: TestApp, groupId: string, cookie: string) =>
    app.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/transcribe`,
      headers: { cookie, 'content-type': 'audio/webm' },
      payload: Buffer.from('fake-audio'),
    });
  const rewrite = (app: TestApp, groupId: string, cookie: string, body: object) =>
    call(app, 'POST', `/api/groups/${groupId}/ai-text`, cookie, body);

  async function adminOf(app: TestApp) {
    const email = newEmail();
    const a = await addAdmin(app.deps.db, { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(app.app, email) };
  }
  async function member(app: TestApp, groupId: string, role: 'client' | 'ziadatel') {
    const c = await createUnverifiedClient(app.deps.db, newEmail());
    await addMembership(app.deps.db, c.id, groupId, role);
    return { ...c, cookie: await loginAs(app.app, c.email) };
  }
  async function setup(app: TestApp, tld = 'sk') {
    const group = await createGroup(app.deps.db, {
      name: 'Firma',
      egrantUrl: `https://${host()}.egrant.${tld}`,
    });
    return {
      group,
      admin: await adminOf(app),
      client: await member(app, group.id, 'client'),
      ziadatel: await member(app, group.id, 'ziadatel'),
    };
  }

  it('admins and the group clients get the tools; translate only off .sk', async () => {
    const g = await setup(test);
    for (const who of [g.admin, g.client]) {
      const res = await call(test, 'GET', `/api/groups/${g.group.id}/ai-tools`, who.cookie);
      expect(res.statusCode).toBe(200);
      expect(AiToolsInfoSchema.parse(res.json())).toEqual({
        text: true,
        translate: null,
        voice: true,
        translateIncoming: true,
      });
      expect(
        (
          await rewrite(test, g.group.id, who.cookie, { action: 'fix', text: 'ahoj ako sa mas' })
        ).json(),
      ).toEqual({ text: 'Ahoj ako sa mas.' });
      expect((await transcribe(test, g.group.id, who.cookie)).json()).toEqual({
        text: FAKE_TRANSCRIPT,
      });
    }
    const cz = await setup(test, 'cz');
    const info = await call(test, 'GET', `/api/groups/${cz.group.id}/ai-tools`, cz.client.cookie);
    expect(info.json<{ translate: unknown }>().translate).toEqual({ clientLanguage: 'cs' });
    const toEnglish = await rewrite(test, cz.group.id, cz.admin.cookie, {
      action: 'translate',
      target: 'en',
      text: 'ahoj',
    });
    expect(toEnglish.json()).toEqual({ text: '[English] ahoj' });
  });

  it('a ziadatel, an outsider and an unknown group get 404 on every route', async () => {
    const g = await setup(test);
    const other = await setup(test);
    for (const cookie of [g.ziadatel.cookie, other.client.cookie]) {
      expect(
        (await call(test, 'GET', `/api/groups/${g.group.id}/ai-tools`, cookie)).statusCode,
      ).toBe(404);
      expect(
        (await rewrite(test, g.group.id, cookie, { action: 'fix', text: 'a' })).statusCode,
      ).toBe(404);
      expect((await transcribe(test, g.group.id, cookie)).statusCode).toBe(404);
    }
    expect(
      (await call(test, 'GET', `/api/groups/${randomUUID()}/ai-tools`, g.admin.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call(test, 'GET', `/api/groups/not%20an%20id/ai-tools`, g.admin.cookie)).statusCode,
    ).toBe(404);
  });

  it('answers 503 when AI is off, and the tools say so', async () => {
    const g = await setup(off);
    const info = await call(off, 'GET', `/api/groups/${g.group.id}/ai-tools`, g.admin.cookie);
    expect(info.json()).toEqual({ text: false, translate: null, voice: false });
    expect(
      (await rewrite(off, g.group.id, g.admin.cookie, { action: 'fix', text: 'a' })).statusCode,
    ).toBe(503);
    expect((await transcribe(off, g.group.id, g.admin.cookie)).statusCode).toBe(503);
  });

  it('shares the per-user limits with the chat routes', async () => {
    const g = await setup(test);
    const channelId = (
      await call(test, 'GET', `/api/groups/${g.group.id}/chat`, g.admin.cookie)
    ).json<GroupChannel>().id;
    // Half in the chat, the rest in descriptions: the next call anywhere is refused.
    const half = Math.floor(BURST.textPerMinute / 2);
    for (let i = 0; i < BURST.textPerMinute; i++) {
      const url =
        i < half ? `/api/channels/${channelId}/ai-text` : `/api/groups/${g.group.id}/ai-text`;
      expect(
        (await call(test, 'POST', url, g.client.cookie, { action: 'fix', text: 'a' })).statusCode,
      ).toBe(200);
    }
    expect(
      (await rewrite(test, g.group.id, g.client.cookie, { action: 'fix', text: 'a' })).statusCode,
    ).toBe(429);
    expect(
      (
        await call(test, 'POST', `/api/channels/${channelId}/ai-text`, g.client.cookie, {
          action: 'fix',
          text: 'a',
        })
      ).statusCode,
    ).toBe(429);

    for (let i = 0; i < BURST.voicePerMinute; i++) {
      expect((await transcribe(test, g.group.id, g.admin.cookie)).statusCode).toBe(200);
    }
    const chatVoice = await test.app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/transcribe`,
      headers: { cookie: g.admin.cookie, 'content-type': 'audio/webm' },
      payload: Buffer.from('fake-audio'),
    });
    expect(chatVoice.statusCode).toBe(429);
  });
});
