import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiStatusSchema, TaskProposalsSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFile } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { createFakeProvider } from './fake-provider.js';
import {
  AiFailedError,
  AiTimeoutError,
  type SplitResult,
  type TaskSplitProvider,
} from './provider.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('AI API', () => {
  /** The provider of `test`; each case sets what it answers. */
  let answer: (signal: AbortSignal) => Promise<SplitResult>;
  const stub: TaskSplitProvider = { split: (_, signal) => answer(signal) };
  let test: TestApp;
  let off: TestApp;
  /** The JSON log lines of `test`. */
  const logLines: Record<string, unknown>[] = [];
  const logStream = { write: (line: string) => void logLines.push(JSON.parse(line)) };

  beforeAll(async () => {
    [test, off] = await Promise.all([buildTestApp({ ai: stub, logStream }), buildTestApp()]);
  });
  const aiLogs = (messageId: string) =>
    logLines.filter(
      (l) => l.msg === 'ai task split' && (l.ai as { messageId: string }).messageId === messageId,
    );
  afterAll(async () => {
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

  async function clientIn(groupId: string, name: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  /** A group with its chat, an admin, a client and a message by the admin. */
  async function setup(body = '- Write the report\n- Call the bank') {
    const group = await createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
    const email = newEmail();
    await addAdmin(test.deps.db, { email, name: 'Admin' });
    const admin = { cookie: await loginAs(test.app, email) };
    const client = await clientIn(group.id, 'Anna');
    const channel = (await call(test, 'GET', `/api/groups/${group.id}/chat`, admin.cookie)).json<{
      id: string;
    }>();
    const sent = await call(test, 'POST', `/api/channels/${channel.id}/messages`, admin.cookie, {
      body,
      clientId: randomUUID(),
    });
    expect(sent.statusCode).toBe(201);
    return {
      group,
      admin,
      client,
      channelId: channel.id,
      messageId: sent.json<{ id: string }>().id,
    };
  }

  const split = (app: TestApp, messageId: string, cookie: string) =>
    call(app, 'POST', `/api/messages/${messageId}/task-split`, cookie);

  const ok = (title = 'Write the report'): Promise<SplitResult> =>
    Promise.resolve({
      tasks: [
        {
          title,
          description: 'details',
          assigneeIds: ['ghost'],
          fileIds: [],
          deadline: '2026-11-01',
          urgent: true,
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });

  it('GET /api/ai/status tells whether task split is available', async () => {
    const s = await setup();
    const on = await call(test, 'GET', '/api/ai/status', s.client.cookie);
    expect(on.statusCode).toBe(200);
    expect(AiStatusSchema.parse(on.json())).toEqual({
      taskSplit: true,
      meetingSummary: false,
      transcription: false,
      ticketDraft: false,
    });
    const cookie = await loginAs(
      off.app,
      (await addAdmin(off.deps.db, { email: newEmail(), name: 'Admin' })).email,
    );
    expect((await call(off, 'GET', '/api/ai/status', cookie)).json()).toEqual({
      taskSplit: false,
      meetingSummary: false,
      transcription: false,
      ticketDraft: false,
    });
    expect((await off.app.inject({ method: 'GET', url: '/api/ai/status' })).statusCode).toBe(401);
  });

  it('answers 200 with sanitized proposals, for a client of the group too', async () => {
    const s = await setup();
    answer = () => ok();
    const res = await split(test, s.messageId, s.client.cookie);
    expect(res.statusCode).toBe(200);
    expect(TaskProposalsSchema.parse(res.json())).toEqual({
      tasks: [
        {
          title: 'Write the report',
          description: 'details',
          assigneeIds: [],
          dueDate: '2026-11-01',
          urgent: true,
          messageFileIds: [],
          link: null,
        },
      ],
      files: [],
    });
  });

  it('works for a message in a task chat', async () => {
    const s = await setup();
    const task = (
      await call(test, 'POST', `/api/groups/${s.group.id}/tasks`, s.admin.cookie, { title: 'T' })
    ).json<{ id: string }>();
    const chat = (await call(test, 'GET', `/api/tasks/${task.id}/chat`, s.client.cookie)).json<{
      id: string;
    }>();
    const sent = await call(test, 'POST', `/api/channels/${chat.id}/messages`, s.client.cookie, {
      body: 'please split',
      clientId: randomUUID(),
    });
    answer = () => ok('From the task chat');
    const res = await split(test, sent.json<{ id: string }>().id, s.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ tasks: { title: string }[] }>().tasks[0]!.title).toBe('From the task chat');
  });

  it("answers 404 for another group's client asking about a task-chat message", async () => {
    const s = await setup();
    const task = (
      await call(test, 'POST', `/api/groups/${s.group.id}/tasks`, s.admin.cookie, { title: 'T' })
    ).json<{ id: string }>();
    const chat = (await call(test, 'GET', `/api/tasks/${task.id}/chat`, s.admin.cookie)).json<{
      id: string;
    }>();
    const sent = await call(test, 'POST', `/api/channels/${chat.id}/messages`, s.admin.cookie, {
      body: '- secret job',
      clientId: randomUUID(),
    });
    answer = () => ok();
    const other = await createGroup(test.deps.db, { name: 'Other', egrantUrl: newUrl() });
    const stranger = await clientIn(other.id, 'Stranger');
    const res = await split(test, sent.json<{ id: string }>().id, stranger.cookie);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  describe('POST /api/groups/:id/task-split-text', () => {
    const splitText = (
      app: TestApp,
      groupId: string,
      cookie: string,
      text = '- Write the report',
    ) => call(app, 'POST', `/api/groups/${groupId}/task-split-text`, cookie, { text });

    it('proposes cards for a pasted text, for an admin and for a client of the group', async () => {
      const s = await setup();
      answer = () => ok('From text');
      for (const cookie of [s.admin.cookie, s.client.cookie]) {
        const res = await splitText(test, s.group.id, cookie, '  Do the thing  ');
        expect(res.statusCode).toBe(200);
        const body = TaskProposalsSchema.parse(res.json());
        expect(body.tasks.map((t) => t.title)).toEqual(['From text']);
        expect(body.files).toEqual([]);
      }
    });

    it('answers 404 for another group, 400 for a blank text, 401 and 503', async () => {
      const s = await setup();
      answer = () => ok();
      const other = await createGroup(test.deps.db, { name: 'Other', egrantUrl: newUrl() });
      const stranger = await clientIn(other.id, 'Stranger');
      expect((await splitText(test, s.group.id, stranger.cookie)).statusCode).toBe(404);
      expect((await splitText(test, randomUUID(), s.admin.cookie)).statusCode).toBe(404);
      expect((await splitText(test, s.group.id, s.admin.cookie, '   ')).statusCode).toBe(400);
      expect((await splitText(test, s.group.id, '')).statusCode).toBe(401);
      const email = newEmail();
      await addAdmin(off.deps.db, { email, name: 'Admin' });
      const res = await splitText(off, s.group.id, await loginAs(off.app, email));
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'ai_unavailable' });
    });

    it('answers 422 ai_no_tasks and 502 ai_failed like the message split', async () => {
      const s = await setup();
      answer = () => Promise.resolve({ tasks: [], usage: null });
      const none = await splitText(test, s.group.id, s.admin.cookie);
      expect(none.statusCode).toBe(422);
      expect(none.json()).toEqual({ error: 'ai_no_tasks' });
      answer = () => Promise.reject(new AiFailedError());
      expect((await splitText(test, s.group.id, s.admin.cookie)).statusCode).toBe(502);
    });
  });

  it('answers 503 ai_unavailable without a provider', async () => {
    const email = newEmail();
    await addAdmin(off.deps.db, { email, name: 'Admin' });
    const res = await split(off, randomUUID(), await loginAs(off.app, email));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'ai_unavailable' });
  });

  it("answers 404 for another group's client, a missing id and a deleted message", async () => {
    const s = await setup();
    answer = () => ok();
    const other = await createGroup(test.deps.db, { name: 'Other', egrantUrl: newUrl() });
    const stranger = await clientIn(other.id, 'Stranger');
    expect((await split(test, s.messageId, stranger.cookie)).statusCode).toBe(404);
    expect((await split(test, randomUUID(), s.admin.cookie)).statusCode).toBe(404);
    expect((await split(test, 'bad%00id', s.admin.cookie)).statusCode).toBe(404);
    const removed = await call(
      test,
      'POST',
      `/api/channels/${s.channelId}/messages`,
      s.admin.cookie,
      {
        body: '- gone',
        clientId: randomUUID(),
      },
    );
    const removedId = removed.json<{ id: string }>().id;
    await test.app.inject({
      method: 'DELETE',
      url: `/api/messages/${removedId}`,
      headers: { cookie: s.admin.cookie },
    });
    expect((await split(test, removedId, s.admin.cookie)).statusCode).toBe(404);
  });

  it('answers 400 for a message with files but no text', async () => {
    const s = await setup();
    const file = await createFile(
      { db: test.deps.db, storage: test.deps.storage },
      {
        groupId: s.group.id,
        uploadedBy: s.client.id,
        name: 'scan.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('scan')]),
      },
    );
    const sent = await call(
      test,
      'POST',
      `/api/channels/${s.channelId}/messages`,
      s.client.cookie,
      {
        body: '  ',
        fileIds: [file.id],
        clientId: randomUUID(),
      },
    );
    expect(sent.statusCode).toBe(201);
    answer = () => ok();
    const res = await split(test, sent.json<{ id: string }>().id, s.client.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('answers 502 ai_failed on a provider failure and on a timeout', async () => {
    const s = await setup();
    answer = () => Promise.reject(new AiFailedError('OpenAI answered 500'));
    const res = await split(test, s.messageId, s.admin.cookie);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'ai_failed' });
    answer = () => Promise.reject(new TypeError('fetch failed'));
    expect((await split(test, s.messageId, s.admin.cookie)).statusCode).toBe(502);
    answer = () => Promise.reject(new AiTimeoutError());
    expect((await split(test, s.messageId, s.admin.cookie)).statusCode).toBe(502);
  });

  it('logs every provider call at info with user, message, duration, outcome and usage', async () => {
    const s = await setup();
    answer = () => ok();
    await split(test, s.messageId, s.client.cookie);
    answer = () => Promise.resolve({ tasks: [], usage: { promptTokens: 7, completionTokens: 0 } });
    await split(test, s.messageId, s.client.cookie);
    answer = () => Promise.reject(new AiTimeoutError());
    await split(test, s.messageId, s.client.cookie);
    answer = () => Promise.reject(new AiFailedError('OpenAI answered 401'));
    await split(test, s.messageId, s.client.cookie);

    const lines = aiLogs(s.messageId);
    expect(lines.map((l) => [l.level, l.ai])).toEqual([
      [
        30,
        {
          userId: s.client.id,
          messageId: s.messageId,
          durationMs: expect.any(Number),
          outcome: 'ok',
          usage: { promptTokens: 1, completionTokens: 1 },
        },
      ],
      [
        30,
        {
          userId: s.client.id,
          messageId: s.messageId,
          durationMs: expect.any(Number),
          outcome: 'no_tasks',
          usage: { promptTokens: 7, completionTokens: 0 },
        },
      ],
      [
        30,
        {
          userId: s.client.id,
          messageId: s.messageId,
          durationMs: expect.any(Number),
          outcome: 'timeout',
          usage: null,
        },
      ],
      [
        30,
        {
          userId: s.client.id,
          messageId: s.messageId,
          durationMs: expect.any(Number),
          outcome: 'failed',
          usage: null,
        },
      ],
    ]);
    // A request that never reaches the provider is not logged as an AI call.
    const count = logLines.filter((l) => l.msg === 'ai task split').length;
    expect((await split(test, randomUUID(), s.client.cookie)).statusCode).toBe(404);
    expect(logLines.filter((l) => l.msg === 'ai task split')).toHaveLength(count);
  });

  it('answers 422 ai_no_tasks when nothing usable comes back', async () => {
    const s = await setup();
    answer = () => Promise.resolve({ tasks: [], usage: null });
    const res = await split(test, s.messageId, s.admin.cookie);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'ai_no_tasks' });
  });

  it('works end to end with the fake provider', async () => {
    const fake = await buildTestApp({ ai: createFakeProvider() });
    try {
      const group = await createGroup(fake.deps.db, { name: 'Firma', egrantUrl: newUrl() });
      const email = newEmail();
      const name = `Zed${randomUUID().slice(0, 8)}`;
      await addAdmin(fake.deps.db, { email, name });
      const cookie = await loginAs(fake.app, email);
      const channel = (await call(fake, 'GET', `/api/groups/${group.id}/chat`, cookie)).json<{
        id: string;
      }>();
      const sent = await call(fake, 'POST', `/api/channels/${channel.id}/messages`, cookie, {
        body: `Todo:\n- Write report by 2026-11-01 for ${name}\n- Call bank urgent`,
        clientId: randomUUID(),
      });
      const res = await split(fake, sent.json<{ id: string }>().id, cookie);
      expect(res.statusCode).toBe(200);
      const { tasks } = TaskProposalsSchema.parse(res.json());
      // Assignees are not checked: every active admin of the shared test database is a group person.
      expect(tasks.map((t) => [t.title, t.dueDate, t.urgent])).toEqual([
        [`Write report by 2026-11-01 for ${name}`, '2026-11-01', false],
        ['Call bank urgent', null, true],
      ]);
    } finally {
      await fake.app.close();
      await fake.close();
    }
  });
});
