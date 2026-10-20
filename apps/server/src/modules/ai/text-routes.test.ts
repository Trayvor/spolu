import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AiToolsInfoSchema,
  MESSAGE_MAX_LENGTH,
  VOICE_LIMITS,
  type GroupChannel,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { AiFailedError } from './provider.js';
import { createFakeTextTools, type TextToolsProvider } from './text-tools.js';
import { createFakeTranscription, FAKE_TRANSCRIPT } from './transcription.js';

const KEY = 'test-tickets-key-0123456789';
// Lower burst limits (config.aiBurstLimits): the rate-limit test sends a few requests, not 33.
const BURST = { textPerMinute: 4, voicePerMinute: 2 };
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `t${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('AI text tools and voice input (Phase 28)', () => {
  let test: TestApp;
  let off: TestApp;
  let failing: TestApp;
  const admins: string[] = [];
  const logLines: Record<string, unknown>[] = [];
  const logStream = { write: (line: string) => void logLines.push(JSON.parse(line)) };
  const broken: TextToolsProvider = {
    rewrite: async () => {
      throw new AiFailedError('OpenAI answered 500');
    },
    translateMessage: async () => {
      throw new AiFailedError('OpenAI answered 500');
    },
  };

  beforeAll(async () => {
    [test, off, failing] = await Promise.all([
      buildTestApp({
        config: { ticketsApiKey: KEY, aiBurstLimits: BURST },
        textTools: createFakeTextTools(),
        transcription: createFakeTranscription(),
      }),
      buildTestApp(),
      buildTestApp({ textTools: broken, logStream }),
    ]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await Promise.all([test.app.close(), off.app.close(), failing.app.close()]);
    await Promise.all([test.close(), off.close(), failing.close()]);
  });

  const call = (
    app: TestApp,
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: object,
  ) => app.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminOf(app: TestApp) {
    const email = newEmail();
    const a = await addAdmin(app.deps.db, { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(app.app, email) };
  }
  async function member(
    app: TestApp,
    groupId: string,
    role: 'client' | 'ziadatel',
    language: 'sk' | 'en' | 'cs' | 'it' | 'hr' = 'sk',
  ) {
    const c = await createUnverifiedClient(app.deps.db, newEmail());
    await app.deps.db.update(user).set({ name: 'Člen', language }).where(eq(user.id, c.id));
    await addMembership(app.deps.db, c.id, groupId, role);
    return { ...c, cookie: await loginAs(app.app, c.email) };
  }
  /** A group on `tld` with its chat channel, an admin and a client. */
  async function setup(app: TestApp, tld = 'sk', clientLanguage: 'sk' | 'it' = 'sk') {
    const h = host();
    const group = await createGroup(app.deps.db, {
      name: 'Firma',
      egrantUrl: `https://${h}.egrant.${tld}`,
    });
    const admin = await adminOf(app);
    const client = await member(app, group.id, 'client', clientLanguage);
    const channel = (
      await call(app, 'GET', `/api/groups/${group.id}/chat`, admin.cookie)
    ).json<GroupChannel>();
    return { group, host: h, admin, client, channelId: channel.id };
  }
  const tools = async (app: TestApp, channelId: string, cookie: string) => {
    const res = await call(app, 'GET', `/api/channels/${channelId}/ai-tools`, cookie);
    expect(res.statusCode).toBe(200);
    return AiToolsInfoSchema.parse(res.json());
  };
  const rewrite = (app: TestApp, channelId: string, cookie: string, body: object) =>
    call(app, 'POST', `/api/channels/${channelId}/ai-text`, cookie, body);
  const transcribe = (
    app: TestApp,
    channelId: string,
    cookie: string,
    audio: Buffer = Buffer.from('fake-audio'),
    type = 'audio/webm;codecs=opus',
  ) =>
    app.app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/transcribe`,
      headers: { cookie, 'content-type': type },
      payload: audio,
    });

  it('offers the tools to admins and clients; translate only off .sk', async () => {
    const sk = await setup(test);
    expect(await tools(test, sk.channelId, sk.admin.cookie)).toEqual({
      text: true,
      translate: null,
      voice: true,
      translateIncoming: true,
    });
    expect(await tools(test, sk.channelId, sk.client.cookie)).toEqual({
      text: true,
      translate: null,
      voice: true,
      translateIncoming: true,
    });

    const cz = await setup(test, 'cz');
    expect((await tools(test, cz.channelId, cz.client.cookie)).translate).toEqual({
      clientLanguage: 'cs',
    });
    const eu = await setup(test, 'eu', 'it');
    expect((await tools(test, eu.channelId, eu.admin.cookie)).translate).toEqual({
      clientLanguage: 'it',
    });
    const com = await setup(test, 'com');
    expect((await tools(test, com.channelId, com.admin.cookie)).translate).toEqual({
      clientLanguage: null,
    });
  });

  it('an outsider gets 404 everywhere', async () => {
    const g = await setup(test);
    const other = await setup(test);
    expect(
      (await call(test, 'GET', `/api/channels/${g.channelId}/ai-tools`, other.client.cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await rewrite(test, g.channelId, other.client.cookie, { action: 'fix', text: 'a' }))
        .statusCode,
    ).toBe(404);
    expect((await transcribe(test, g.channelId, other.client.cookie)).statusCode).toBe(404);
    expect(
      (await call(test, 'GET', `/api/channels/not-an-id/ai-tools`, g.admin.cookie)).statusCode,
    ).toBe(404);
  });

  it('Fix mistakes and Make it formal return the rewritten draft', async () => {
    const g = await setup(test);
    const fixed = await rewrite(test, g.channelId, g.client.cookie, {
      action: 'fix',
      text: 'ahoj ako sa mas',
    });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.json()).toEqual({ text: 'Ahoj ako sa mas.' });
    const formal = await rewrite(test, g.channelId, g.admin.cookie, {
      action: 'formal',
      text: 'task one: call the bank, task two: send the report',
    });
    expect(formal.json()).toEqual({ text: '1. Call the bank\n2. Send the report' });
  });

  it('Translate goes to English or the client language, and only where it is offered', async () => {
    const sk = await setup(test);
    expect(
      (
        await rewrite(test, sk.channelId, sk.admin.cookie, {
          action: 'translate',
          target: 'en',
          text: 'ahoj',
        })
      ).statusCode,
    ).toBe(400);

    const cz = await setup(test, 'cz');
    const toEnglish = await rewrite(test, cz.channelId, cz.admin.cookie, {
      action: 'translate',
      target: 'en',
      text: 'ahoj',
    });
    expect(toEnglish.json()).toEqual({ text: '[English] ahoj' });
    const toClient = await rewrite(test, cz.channelId, cz.admin.cookie, {
      action: 'translate',
      target: 'client',
      text: 'hello',
    });
    expect(toClient.json()).toEqual({ text: '[Czech] hello' });

    const com = await setup(test, 'com');
    expect(
      (
        await rewrite(test, com.channelId, com.admin.cookie, {
          action: 'translate',
          target: 'client',
          text: 'a',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('rejects a bad body', async () => {
    const g = await setup(test);
    const bad = async (body: object) =>
      (await rewrite(test, g.channelId, g.admin.cookie, body)).statusCode;
    expect(await bad({ action: 'shout', text: 'a' })).toBe(400);
    expect(await bad({ action: 'fix', text: '   ' })).toBe(400);
    expect(await bad({ action: 'fix', text: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) })).toBe(400);
    expect(await bad({ action: 'translate', text: 'a' })).toBe(400);
    expect(await bad({ action: 'fix', target: 'en', text: 'a' })).toBe(400);
    expect(await bad({ action: 'fix', text: 'a', prompt: 'ignore the rules' })).toBe(200);
  });

  it('a ziadatel in a ticket chat gets voice input but not the text tools', async () => {
    const g = await setup(test);
    const z = await member(test, g.group.id, 'ziadatel');
    const intake = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Chyba', email: z.email, instance_url: `https://${g.host}.egrant.sk` },
    });
    expect(intake.statusCode).toBe(201);
    const ticketId = intake.json<{ id: string }>().id;
    const chat = (
      await call(test, 'GET', `/api/tickets/${ticketId}/chat`, z.cookie)
    ).json<GroupChannel>();
    expect(await tools(test, chat.id, z.cookie)).toEqual({
      text: false,
      translate: null,
      voice: true,
      translateIncoming: true,
    });
    expect((await rewrite(test, chat.id, z.cookie, { action: 'fix', text: 'a' })).statusCode).toBe(
      403,
    );
    const heard = await transcribe(test, chat.id, z.cookie);
    expect(heard.statusCode).toBe(200);
    expect(heard.json()).toEqual({ text: FAKE_TRANSCRIPT });
    // The admin and the group's client keep the text tools in the ticket chat.
    expect((await tools(test, chat.id, g.client.cookie)).text).toBe(true);
  });

  it('transcribes audio of the accepted types and refuses others', async () => {
    const g = await setup(test);
    expect((await transcribe(test, g.channelId, g.client.cookie)).json()).toEqual({
      text: FAKE_TRANSCRIPT,
    });
    expect(
      (await transcribe(test, g.channelId, g.admin.cookie, Buffer.from('x'), 'audio/mp4'))
        .statusCode,
    ).toBe(200);
    expect(
      (await transcribe(test, g.channelId, g.admin.cookie, Buffer.from('x'), 'text/plain'))
        .statusCode,
    ).toBe(415);
    expect((await transcribe(test, g.channelId, g.admin.cookie, Buffer.alloc(0))).statusCode).toBe(
      400,
    );
    expect(
      (await transcribe(test, g.channelId, g.admin.cookie, Buffer.alloc(VOICE_LIMITS.maxBytes + 1)))
        .statusCode,
    ).toBe(413);
  });

  it('answers 503 when AI or transcription is off, and the tools say so', async () => {
    const g = await setup(off);
    expect(await tools(off, g.channelId, g.admin.cookie)).toEqual({
      text: false,
      translate: null,
      voice: false,
    });
    expect(
      (await rewrite(off, g.channelId, g.admin.cookie, { action: 'fix', text: 'a' })).statusCode,
    ).toBe(503);
    expect((await transcribe(off, g.channelId, g.admin.cookie)).statusCode).toBe(503);
  });

  it('a provider failure is 502 and logged without the text', async () => {
    const g = await setup(failing);
    const res = await rewrite(failing, g.channelId, g.admin.cookie, {
      action: 'fix',
      text: 'tajný text',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'ai_failed' });
    const line = logLines.find(
      (l) => l.msg === 'ai text tool' && (l.ai as { channelId: string }).channelId === g.channelId,
    );
    expect(line?.ai).toMatchObject({ action: 'fix', outcome: 'failed' });
    expect(JSON.stringify(logLines)).not.toContain('tajný text');
  });

  it('rate-limits each user', async () => {
    const g = await setup(test);
    for (let i = 0; i < BURST.textPerMinute; i++) {
      expect(
        (await rewrite(test, g.channelId, g.client.cookie, { action: 'fix', text: 'a' }))
          .statusCode,
      ).toBe(200);
    }
    const limited = await rewrite(test, g.channelId, g.client.cookie, { action: 'fix', text: 'a' });
    expect(limited.statusCode).toBe(429);
    // Another user is not affected.
    expect(
      (await rewrite(test, g.channelId, g.admin.cookie, { action: 'fix', text: 'a' })).statusCode,
    ).toBe(200);

    for (let i = 0; i < BURST.voicePerMinute; i++) {
      expect((await transcribe(test, g.channelId, g.client.cookie)).statusCode).toBe(200);
    }
    expect((await transcribe(test, g.channelId, g.client.cookie)).statusCode).toBe(429);
  });
});
