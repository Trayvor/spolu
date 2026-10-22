import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MENTION_ALL_TOKEN, mentionToken, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { createFile } from '../files/service.js';
import { addManager, removeManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { deleteMessage, findReadableMessage, sendMessage } from '../chat/messages.js';
import { ensureGroupChannel, type ChannelRow } from '../chat/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { createProject, setProjectStatus } from '../projects/service.js';
import {
  AiFailedError,
  type RawTask,
  type SplitRequest,
  type TaskSplitProvider,
} from './provider.js';
import {
  AiNoTasksError,
  AiUnavailableError,
  buildSplitRequest,
  buildTextSplitRequest,
  proposeTasks,
  proposeTextTasks,
  sanitizeProposals,
} from './split.js';

const raw = (overrides: Partial<RawTask> = {}): RawTask => ({
  title: 'Task',
  description: '',
  assigneeIds: [],
  fileIds: [],
  deadline: null,
  urgent: false,
  ...overrides,
});

describe('sanitizeProposals', () => {
  const allowed = { peopleIds: new Set(['u1']), fileIds: new Set(['f1']) };

  it('drops unknown ids, invalid dates and blank titles; caps at 10', () => {
    const tasks = Array.from({ length: 14 }, (_, i) =>
      raw({
        title: i === 0 ? '   ' : `T${i} ${'x'.repeat(i === 1 ? 400 : 0)}`,
        assigneeIds: ['u1', 'u1', 'ghost'],
        fileIds: ['f1', 'nope', 'f1'],
        deadline: i === 2 ? '2026-02-31' : '2026-11-01',
      }),
    );
    const out = sanitizeProposals(tasks, allowed);
    expect(out).toHaveLength(10);
    expect(out[0]!.title).toHaveLength(200);
    expect(out[0]).toMatchObject({
      assigneeIds: ['u1'],
      messageFileIds: ['f1'],
      dueDate: '2026-11-01',
    });
    expect(out[1]!.dueDate).toBeNull();
    expect(out.map((t) => t.title.slice(0, 3).trim())).toEqual(
      ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].map((t) => t.slice(0, 3)),
    );
  });

  it('trims, cuts the description and rejects malformed dates', () => {
    const [task] = sanitizeProposals(
      [
        raw({
          title: '  Call the bank  ',
          description: ` ${'d'.repeat(6000)} `,
          deadline: '1.11.2026',
          urgent: true,
        }),
      ],
      allowed,
    );
    expect(task).toEqual({
      title: 'Call the bank',
      description: 'd'.repeat(5000),
      assigneeIds: [],
      dueDate: null,
      urgent: true,
      messageFileIds: [],
      link: null,
      projectId: null,
    });
  });

  it('cuts by code points, never splitting an emoji', () => {
    const [task] = sanitizeProposals(
      [raw({ title: `${'a'.repeat(199)}😀😀`, description: '😀'.repeat(5001) })],
      allowed,
    );
    expect(task!.title).toBe(`${'a'.repeat(199)}😀`);
    expect(Array.from(task!.description)).toHaveLength(5000);
    expect(task!.description.endsWith('😀')).toBe(true);
  });

  it('keeps at most 10 assignees', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const [task] = sanitizeProposals([raw({ assigneeIds: ids })], {
      peopleIds: new Set(ids),
      fileIds: new Set(),
    });
    expect(task!.assigneeIds).toEqual(ids.slice(0, 10));
  });

  it('keeps a project only when it is one of the allowed ones', () => {
    const out = sanitizeProposals(
      [raw({ projectId: 'p1' }), raw({ projectId: 'ghost' }), raw({ projectId: null }), raw()],
      { ...allowed, projectIds: new Set(['p1']) },
    );
    expect(out.map((t) => t.projectId)).toEqual(['p1', null, null, null]);
    expect(sanitizeProposals([raw({ projectId: 'p1' })], allowed)[0]!.projectId).toBeNull();
  });
});

describe('split service', () => {
  let deps: AppDeps;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ deps, close } = await buildTestApp());
  });
  afterAll(() => close());

  const asSession = (row: { id: string; email: string; name: string; role: string }) =>
    ({ id: row.id, email: row.email, name: row.name, role: row.role }) as SessionUser;

  async function newClient(groupId: string, name: string) {
    const row = await createUnverifiedClient(deps.db, `${randomUUID()}@example.com`);
    await deps.db.update(user).set({ emailVerified: true, name }).where(eq(user.id, row.id));
    await addMember(deps.db, groupId, row.id);
    return asSession({ ...row, name });
  }

  async function setup() {
    const group = await createGroup(deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
    });
    const channel = await ensureGroupChannel(deps.db, group.id);
    const admin = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Admin' });
    const ana = await newClient(group.id, 'Ana');
    return { group, channel, admin: asSession({ ...admin, role: 'admin' }), ana };
  }

  const send = (channel: ChannelRow, author: SessionUser, data: object) =>
    sendMessage(deps, {
      channel,
      author,
      data: { body: 'hello', clientId: randomUUID(), ...data },
    });

  const upload = (groupId: string, uploadedBy: string, name: string) =>
    createFile(
      { db: deps.db, storage: deps.storage },
      {
        groupId,
        uploadedBy,
        name,
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from(name)]),
      },
    );

  async function found(actor: SessionUser, id: string) {
    const result = await findReadableMessage(deps.db, actor, id);
    if (!result) throw new Error('message not readable');
    return result;
  }

  /** A provider that records the request and answers `tasks`. */
  function capturing(tasks: RawTask[]) {
    const calls: SplitRequest[] = [];
    const provider: TaskSplitProvider = {
      async split(request) {
        calls.push(request);
        return { tasks, usage: { promptTokens: 10, completionTokens: 5 } };
      },
    };
    return { provider, calls };
  }

  it('sends names, not mention tokens, and the files as id — name', async () => {
    const s = await setup();
    const file = await upload(s.group.id, s.admin.id, 'report.pdf');
    const { message } = await send(s.channel, s.admin, {
      body: `Ask ${mentionToken(s.ana.id)} about report.pdf\nand tell ${MENTION_ALL_TOKEN}`,
      fileIds: [file.id],
    });
    const { provider, calls } = capturing([raw({ assigneeIds: [s.ana.id], fileIds: [file.id] })]);

    const result = await proposeTasks({ ...deps, ai: provider }, await found(s.admin, message.id));

    const [captured] = calls;
    expect(captured!.text).toBe('Ask @Ana about report.pdf\nand tell @all');
    expect(captured!.quoted).toBeNull();
    expect(captured!.files).toEqual([{ id: file.id, name: 'report.pdf' }]);
    expect(captured!.people).toContainEqual({ id: s.ana.id, name: 'Ana', team: 'client' });
    expect(captured!.people.map((p) => p.id)).not.toContain(s.admin.id);
    expect(captured!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.tasks).toEqual([
      {
        title: 'Task',
        description: '',
        assigneeIds: [s.ana.id],
        dueDate: null,
        urgent: false,
        messageFileIds: [file.id],
        link: null,
        projectId: null,
      },
    ]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('the prompt lists pickable people only', async () => {
    const s = await setup();
    const manager = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Mo' });
    await addManager(deps.db, s.group.id, manager.id);
    const { message } = await send(s.channel, s.ana, { body: 'Do it' });
    const request = await buildSplitRequest(deps.db, await found(s.ana, message.id));
    const ids = request.people.map((p) => p.id);
    expect(ids).toContain(s.ana.id);
    expect(ids).toContain(manager.id);
    expect(ids).not.toContain(s.admin.id);
    // Each person says whose side they are on, so "eGrant should…" can be matched.
    expect(request.people.find((p) => p.id === manager.id)!.team).toBe('egrant');
    expect(request.people.find((p) => p.id === s.ana.id)!.team).toBe('client');
  });

  it('a proposal naming a non-manager admin is dropped', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.ana, { body: 'Do it' });
    const { provider } = capturing([raw({ assigneeIds: [s.admin.id, s.ana.id] })]);
    const result = await proposeTasks({ ...deps, ai: provider }, await found(s.ana, message.id));
    expect(result.tasks[0]!.assigneeIds).toEqual([s.ana.id]);
  });

  it('the message text still names a mentioned non-manager', async () => {
    const s = await setup();
    await addManager(deps.db, s.group.id, s.admin.id);
    const { message } = await send(s.channel, s.ana, {
      body: `Ask ${mentionToken(s.admin.id)}`,
    });
    await removeManager(deps.db, s.group.id, s.admin.id);
    const request = await buildSplitRequest(deps.db, await found(s.ana, message.id));
    expect(request.text).toBe('Ask @Admin');
  });

  it('quotes the reply-to message and dates today in Bratislava', async () => {
    const s = await setup();
    const { message: root } = await send(s.channel, s.ana, { body: 'Root' });
    await addManager(deps.db, s.group.id, s.admin.id);
    const { message: first } = await send(s.channel, s.ana, {
      body: `Is it ready, ${mentionToken(s.admin.id)}?`,
      parentId: root.id,
    });
    await removeManager(deps.db, s.group.id, s.admin.id);
    const { message: reply } = await send(s.channel, s.admin, {
      body: '- Finish it',
      parentId: root.id,
      replyToId: first.id,
    });
    // 23:30 UTC on 31 Dec is already 1 Jan in Bratislava.
    const request = await buildSplitRequest(
      deps.db,
      await found(s.admin, reply.id),
      new Date('2026-12-31T23:30:00Z'),
    );
    expect(request.quoted).toBe('Is it ready, @Admin?');
    expect(request.today).toBe('2027-01-01');

    await deleteMessage(deps, await found(s.ana, first.id));
    const again = await buildSplitRequest(deps.db, await found(s.admin, reply.id));
    expect(again.quoted).toBeNull();
  });

  describe('links and mentions survive into the cards', () => {
    const URL_A = 'https://x.egrant.sk/app/form?id=3';
    const URL_B = 'https://docs.example.com/guide';

    it('a URL of the text the AI dropped is added to every card that lacks it', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, {
        body: `Fix the form at ${URL_A}.\nSee [the guide](${URL_B})`,
      });
      const { provider } = capturing([
        raw({ title: 'Fix the form', description: 'Fix the form.' }),
        raw({ title: 'Read the guide', description: `Read ${URL_B} first.` }),
      ]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks.map((t) => t.description)).toEqual([
        `Fix the form.\n\n${URL_A}`,
        `Read ${URL_B} first.\n\n${URL_A}`,
      ]);
    });

    it('a URL the AI kept is not repeated, and a card link must come from the text', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, { body: `Fix ${URL_A}` });
      const { provider } = capturing([
        raw({ title: 'One', description: `Fix ${URL_A}`, link: URL_A }),
        raw({ title: 'Two', description: 'Fix it', link: 'https://evil.example.com' }),
      ]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks.map((t) => [t.description, t.link])).toEqual([
        [`Fix ${URL_A}`, URL_A],
        ['Fix it', null],
      ]);
    });

    it('a card without a link takes the one URL of its own description', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, {
        body: `Fix ${URL_A}\nRead ${URL_B}\nCall the bank`,
      });
      const { provider } = capturing([
        raw({ title: 'Fix', description: `Fix ${URL_A}` }),
        raw({ title: 'Read', description: `Read ${URL_B}`, link: null }),
        raw({ title: 'Both', description: `Compare ${URL_A} and ${URL_B}` }),
        raw({ title: 'Fake', description: 'See https://evil.example.com' }),
      ]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks.map((t) => t.link)).toEqual([URL_A, URL_B, null, null]);
    });

    it('a single card without a link takes the one URL of the source text', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, { body: `Fix the form ${URL_A}.` });
      const { provider } = capturing([raw({ title: 'Fix', description: 'Fix the form.' })]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks[0]!.link).toBe(URL_A);
      // keepUrls has nothing to add: the card carries it as its link.
      expect(result.tasks[0]!.description).toBe('Fix the form.');
    });

    it('two cards without a link do not take the source text URL', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, { body: `Fix ${URL_A} and call` });
      const { provider } = capturing([raw({ title: 'Fix' }), raw({ title: 'Call' })]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks.map((t) => t.link)).toEqual([null, null]);
    });

    it('a mentioned person named in a description is a mention again', async () => {
      const s = await setup();
      const { message } = await send(s.channel, s.admin, {
        body: `Ask ${mentionToken(s.ana.id)} to sign it`,
      });
      const { provider } = capturing([
        raw({ title: 'Ask Ana', description: 'Ask @Ana to sign it; @Anabela is someone else.' }),
      ]);
      const result = await proposeTasks(
        { ...deps, ai: provider },
        await found(s.admin, message.id),
      );
      expect(result.tasks[0]!.description).toBe(
        `Ask ${mentionToken(s.ana.id)} to sign it; @Anabela is someone else.`,
      );
    });
  });

  describe("the group's projects", () => {
    async function project(groupId: string, adminId: string, name: string) {
      return createProject(deps.db, adminId, groupId, {
        name,
        description: '',
        fileIds: [],
      });
    }

    it('the request lists the active projects only, by name', async () => {
      const s = await setup();
      const beta = await project(s.group.id, s.admin.id, 'Beta');
      const alfa = await project(s.group.id, s.admin.id, 'Alfa');
      const old = await project(s.group.id, s.admin.id, 'Old');
      await setProjectStatus(deps.db, old.id, 'archived');
      const request = await buildTextSplitRequest(deps.db, s.group.id, 'Do it');
      expect(request.projects).toEqual([
        { id: alfa.id, name: 'Alfa' },
        { id: beta.id, name: 'Beta' },
      ]);
      const { message } = await send(s.channel, s.ana, { body: 'Do it' });
      const fromMessage = await buildSplitRequest(deps.db, await found(s.ana, message.id));
      expect(fromMessage.projects.map((p) => p.name)).toEqual(['Alfa', 'Beta']);
    });

    it("the AI's project is kept when it is an active project of the group", async () => {
      const s = await setup();
      const alfa = await project(s.group.id, s.admin.id, 'Alfa');
      const old = await project(s.group.id, s.admin.id, 'Old');
      await setProjectStatus(deps.db, old.id, 'archived');
      const other = await setup();
      const foreign = await project(other.group.id, other.admin.id, 'Foreign');
      const { provider } = capturing([
        raw({ title: 'A', projectId: alfa.id }),
        raw({ title: 'B', projectId: old.id }),
        raw({ title: 'C', projectId: foreign.id }),
      ]);
      const result = await proposeTextTasks({ ...deps, ai: provider }, s.group.id, 'A, B, C');
      expect(result.tasks.map((t) => t.projectId)).toEqual([alfa.id, null, null]);
    });
  });

  it('throws AiUnavailableError without a provider', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.admin, { body: '- one' });
    await expect(
      proposeTasks({ ...deps, ai: null }, await found(s.admin, message.id)),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('throws AiNoTasksError when nothing survives sanitizing', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.admin, { body: 'just chatting' });
    const { provider } = capturing([raw({ title: '  ' })]);
    const error = await proposeTasks({ ...deps, ai: provider }, await found(s.admin, message.id))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiNoTasksError);
    expect((error as AiNoTasksError).usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('wraps a provider error as AiFailedError', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.admin, { body: '- one' });
    const broken: TaskSplitProvider = {
      split: async () => {
        throw new Error('boom');
      },
    };
    await expect(
      proposeTasks({ ...deps, ai: broken }, await found(s.admin, message.id)),
    ).rejects.toBeInstanceOf(AiFailedError);
  });

  it('times out as AiFailedError, even when the provider ignores the signal', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.admin, { body: '- one' });
    const target = await found(s.admin, message.id);
    const hanging: TaskSplitProvider = {
      split: (_, signal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(new AiFailedError())),
        ),
    };
    await expect(
      proposeTasks({ ...deps, ai: hanging }, target, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(AiFailedError);
    const deaf: TaskSplitProvider = { split: () => new Promise<never>(() => {}) };
    await expect(
      proposeTasks({ ...deps, ai: deaf }, target, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(AiFailedError);
  });
});
