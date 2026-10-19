import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AiToolsInfoSchema,
  IncomingTranslationSchema,
  type GroupChannel,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureGroupChannel } from '../chat/service.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { aiTranslations } from './schema.js';
import { createFakeTextTools, type TextToolsProvider } from './text-tools.js';

const KEY = 'test-tickets-key-0123456789';
const BURST = { textPerMinute: 3, voicePerMinute: 2 };
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Language = 'sk' | 'en' | 'cs' | 'sl' | 'hr' | 'it';
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `t${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('translating a message someone else wrote (2026-10-19)', () => {
  let test: TestApp;
  let off: TestApp;
  const admins: string[] = [];
  /** How often the model was asked to translate a message, by text. */
  const calls: string[] = [];
  const fake = createFakeTextTools();
  const counting: TextToolsProvider = {
    rewrite: (request, signal) => fake.rewrite(request, signal),
    translateMessage: (request, signal) => {
      calls.push(request.text);
      return fake.translateMessage(request, signal);
    },
  };

  beforeAll(async () => {
    [test, off] = await Promise.all([
      buildTestApp({
        config: { ticketsApiKey: KEY, aiBurstLimits: BURST },
        textTools: counting,
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => app.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminOf(app: TestApp, language: Language = 'sk') {
    const email = newEmail();
    const a = await addAdmin(app.deps.db, { email, name: 'Ad Min' });
    admins.push(a.id);
    await app.deps.db.update(user).set({ language }).where(eq(user.id, a.id));
    return { ...a, cookie: await loginAs(app.app, email) };
  }
  async function member(
    app: TestApp,
    groupId: string,
    role: 'client' | 'ziadatel',
    language: Language = 'sk',
  ) {
    const c = await createUnverifiedClient(app.deps.db, newEmail());
    await app.deps.db.update(user).set({ name: 'Člen', language }).where(eq(user.id, c.id));
    await addMembership(app.deps.db, c.id, groupId, role);
    return { ...c, cookie: await loginAs(app.app, c.email) };
  }
  /** A group on `tld` with its chat, a Slovak admin and a Czech client. */
  async function setup(app: TestApp, tld = 'cz') {
    const h = host();
    const group = await createGroup(app.deps.db, {
      name: 'Firma',
      egrantUrl: `https://${h}.egrant.${tld}`,
    });
    const admin = await adminOf(app);
    const client = await member(app, group.id, 'client', 'cs');
    const channel = (
      await call(app, 'GET', `/api/groups/${group.id}/chat`, admin.cookie)
    ).json<GroupChannel>();
    return { group, host: h, admin, client, channelId: channel.id };
  }
  const send = async (
    app: TestApp,
    channelId: string,
    cookie: string,
    body: string,
    parentId?: string,
  ) => {
    const res = await call(app, 'POST', `/api/channels/${channelId}/messages`, cookie, {
      body,
      clientId: randomUUID(),
      ...(parentId ? { parentId } : {}),
    });
    expect(res.statusCode).toBe(201);
    return res.json<MessageDto>();
  };
  const translate = (app: TestApp, messageId: string, cookie: string) =>
    call(app, 'POST', `/api/messages/${messageId}/translate`, cookie);
  const storedRows = async (messageId: string) =>
    (
      await test.deps.db
        .select({ text: aiTranslations.text })
        .from(aiTranslations)
        .where(eq(aiTranslations.messageId, messageId))
    ).length;
  const tools = async (app: TestApp, channelId: string, cookie: string) =>
    AiToolsInfoSchema.parse(
      (await call(app, 'GET', `/api/channels/${channelId}/ai-tools`, cookie)).json(),
    );

  it('the tools offer it only off .sk', async () => {
    const cz = await setup(test);
    expect((await tools(test, cz.channelId, cz.admin.cookie)).translateIncoming).toBe(true);
    expect((await tools(test, cz.channelId, cz.client.cookie)).translateIncoming).toBe(true);
    const sk = await setup(test, 'sk');
    expect((await tools(test, sk.channelId, sk.admin.cookie)).translateIncoming).toBeUndefined();
    const offGroup = await setup(off);
    expect(
      (await tools(off, offGroup.channelId, offGroup.admin.cookie)).translateIncoming,
    ).toBeUndefined();
  });

  it("translates a client's message into the reader's language, keeping mentions", async () => {
    const g = await setup(test);
    const body = 'Dobrý den <@all>, posílám **rozpočet**.';
    const message = await send(test, g.channelId, g.client.cookie, body);
    const res = await translate(test, message.id, g.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(IncomingTranslationSchema.parse(res.json())).toEqual({
      text: `[Slovak] ${body}`,
      // The fake calls an untagged text German.
      sourceLanguage: 'de',
      targetLanguage: 'sk',
      unchanged: false,
    });
  });

  it('a thread reply and a ticket chat message translate too, also for a ziadatel', async () => {
    const g = await setup(test);
    const root = await send(test, g.channelId, g.admin.cookie, 'Ahoj');
    const reply = await send(test, g.channelId, g.admin.cookie, 'Odpoveď', root.id);
    const res = await translate(test, reply.id, g.client.cookie);
    expect(res.json()).toMatchObject({ text: '[Czech] Odpoveď', targetLanguage: 'cs' });

    const z = await member(test, g.group.id, 'ziadatel', 'cs');
    const intake = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Chyba', email: z.email, instance_url: `https://${g.host}.egrant.cz` },
    });
    expect(intake.statusCode).toBe(201);
    const ticketId = intake.json<{ id: string }>().id;
    const chat = (
      await call(test, 'GET', `/api/tickets/${ticketId}/chat`, g.admin.cookie)
    ).json<GroupChannel>();
    expect((await tools(test, chat.id, z.cookie)).translateIncoming).toBe(true);
    const answer = await send(test, chat.id, g.admin.cookie, 'Pozrieme sa na to.');
    const translated = await translate(test, answer.id, z.cookie);
    expect(translated.statusCode).toBe(200);
    expect(translated.json()).toMatchObject({ text: '[Czech] Pozrieme sa na to.' });
  });

  it('a message already in the reader language comes back unchanged', async () => {
    const g = await setup(test);
    const message = await send(test, g.channelId, g.client.cookie, '[sk] Dobrý deň');
    const res = await translate(test, message.id, g.admin.cookie);
    expect(res.json()).toEqual({
      text: '[sk] Dobrý deň',
      sourceLanguage: 'sk',
      targetLanguage: 'sk',
      unchanged: true,
    });
  });

  it('an unreadable or unknown message is 404, own and deleted ones are refused', async () => {
    const g = await setup(test);
    const other = await setup(test);
    const message = await send(test, g.channelId, g.client.cookie, 'Ahoj');
    expect((await translate(test, message.id, other.client.cookie)).statusCode).toBe(404);
    expect((await translate(test, 'not-an-id!', g.admin.cookie)).statusCode).toBe(404);
    expect((await translate(test, randomUUID(), g.admin.cookie)).statusCode).toBe(404);
    expect((await translate(test, message.id, g.client.cookie)).statusCode).toBe(403);
    expect((await translate(test, message.id, g.admin.cookie)).statusCode).toBe(200);
    expect(await storedRows(message.id)).toBe(1);
    expect(
      (await call(test, 'DELETE', `/api/messages/${message.id}`, g.client.cookie)).statusCode,
    ).toBe(204);
    // The delete took the stored translation with it.
    expect(await storedRows(message.id)).toBe(0);
    expect((await translate(test, message.id, g.admin.cookie)).statusCode).toBe(404);
    expect(
      (await test.app.inject({ method: 'POST', url: `/api/messages/${message.id}/translate` }))
        .statusCode,
    ).toBe(401);
  });

  it('is refused on a .sk instance and in the admin group; 503 when AI is off', async () => {
    const sk = await setup(test, 'sk');
    const message = await send(test, sk.channelId, sk.client.cookie, 'Ahoj');
    expect((await translate(test, message.id, sk.admin.cookie)).statusCode).toBe(403);

    const adminGroup = await ensureAdminGroup(test.deps.db);
    const channel = await ensureGroupChannel(test.deps.db, adminGroup);
    const a = await adminOf(test);
    const b = await adminOf(test, 'en');
    const internal = await send(test, channel.id, a.cookie, 'Interné');
    expect((await translate(test, internal.id, b.cookie)).statusCode).toBe(403);

    const g = await setup(off);
    const offMessage = await send(off, g.channelId, g.client.cookie, 'Ahoj');
    expect((await translate(off, offMessage.id, g.admin.cookie)).statusCode).toBe(503);
  });

  it('asks the model once per text and language; an edit asks again', async () => {
    const g = await setup(test);
    const text = `cache ${randomUUID()}`;
    const message = await send(test, g.channelId, g.client.cookie, text);
    const secondAdmin = await adminOf(test);
    const english = await adminOf(test, 'en');
    expect((await translate(test, message.id, g.admin.cookie)).json()).toMatchObject({
      text: `[Slovak] ${text}`,
    });
    // Another reader with the same language gets the stored translation.
    expect((await translate(test, message.id, secondAdmin.cookie)).json()).toMatchObject({
      text: `[Slovak] ${text}`,
    });
    expect(calls.filter((c) => c === text)).toHaveLength(1);
    // Another language is its own translation.
    expect((await translate(test, message.id, english.cookie)).json()).toMatchObject({
      text: `[English] ${text}`,
    });
    expect(calls.filter((c) => c === text)).toHaveLength(2);

    const edited = `${text} edited`;
    const patch = await call(test, 'PATCH', `/api/messages/${message.id}`, g.client.cookie, {
      body: edited,
    });
    expect(patch.statusCode).toBe(200);
    expect(await storedRows(message.id)).toBe(0);
    expect((await translate(test, message.id, g.admin.cookie)).json()).toMatchObject({
      text: `[Slovak] ${edited}`,
    });
    expect(calls.filter((c) => c === edited)).toHaveLength(1);
  });

  it('translates the description of a ticket someone else wrote', async () => {
    const g = await setup(test);
    const z = await member(test, g.group.id, 'ziadatel', 'cs');
    const intake = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Chyba',
        body: 'Nejde mi nahrát přílohu.',
        email: z.email,
        instance_url: `https://${g.host}.egrant.cz`,
      },
    });
    expect(intake.statusCode).toBe(201);
    const ticketId = intake.json<{ id: string }>().id;
    const res = await call(test, 'POST', `/api/tickets/${ticketId}/translate`, g.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      text: '[Slovak] Nejde mi nahrát přílohu.',
      targetLanguage: 'sk',
    });
    // The initiator's own text is not offered to them; an outsider gets 404.
    expect(
      (await call(test, 'POST', `/api/tickets/${ticketId}/translate`, z.cookie)).statusCode,
    ).toBe(403);
    const other = await setup(test);
    expect(
      (await call(test, 'POST', `/api/tickets/${ticketId}/translate`, other.client.cookie))
        .statusCode,
    ).toBe(404);
  });

  it('a miss counts against the per-user limit; a stored translation does not', async () => {
    const g = await setup(test);
    const reader = await adminOf(test, 'it');
    const ids: string[] = [];
    for (let i = 0; i <= BURST.textPerMinute; i++) {
      ids.push((await send(test, g.channelId, g.client.cookie, `limit ${i} ${randomUUID()}`)).id);
    }
    for (const id of ids.slice(0, BURST.textPerMinute)) {
      expect((await translate(test, id, reader.cookie)).statusCode).toBe(200);
    }
    expect((await translate(test, ids.at(-1)!, reader.cookie)).statusCode).toBe(429);
    // Already translated: answered from the store, no limit.
    expect((await translate(test, ids[0]!, reader.cookie)).statusCode).toBe(200);
  });
});
