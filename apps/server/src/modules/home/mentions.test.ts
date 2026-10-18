import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  mentionToken,
  type ChatMentionItem,
  type DescriptionMentionItem,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { sendMessage } from '../chat/messages.js';
import { messages } from '../chat/schema.js';
import { ensureTaskChannel, getChannel, markRead, markThreadRead } from '../chat/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import {
  recordDescriptionMentions,
  type DescriptionSubject,
} from '../notifications/description-mentions.js';
import { setDefaultMode, setGroupMode } from '../notifications/modes.js';
import { notificationEvents } from '../notifications/schema.js';
import {
  markKnowledgeSeen,
  markProjectSeen,
  markTaskSeen,
  markTicketSeen,
} from '../notifications/unseen.js';
import { projects } from '../projects/schema.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { setNotificationChannel } from '../users/service.js';
import { getMentions } from './mentions.js';
import { newAdmin, newClient, newGroup, newMessage, newTask } from './test-fixtures.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

/** A managed group GM, an unmanaged GO, admin A managing GM, client C in GM and D in GO. */
async function setup() {
  const GM = await newGroup(deps.db, 'Managed');
  const GO = await newGroup(deps.db, 'Other');
  const A = await newAdmin(deps.db, 'Ada Admin', [GM.id]);
  const C = await newClient(deps.db, GM.id, 'Cyril');
  const D = await newClient(deps.db, GO.id, 'Dana');
  const gmChannel = (await getChannel(deps.db, GM.channelId))!;
  const goChannel = (await getChannel(deps.db, GO.channelId))!;
  return { GM, GO, A, C, D, gmChannel, goChannel };
}

const send = (
  channel: NonNullable<Awaited<ReturnType<typeof getChannel>>>,
  author: SessionUser,
  body: string,
  parentId?: string,
) =>
  sendMessage(deps, {
    channel,
    author,
    data: { body, clientId: randomUUID(), ...(parentId ? { parentId } : {}) },
  });

/** The viewer's chat mentions in these groups. */
const mine = async (viewer: SessionUser, groupIds: string[]) =>
  (await getMentions(deps.db, viewer)).items.filter(
    (i): i is ChatMentionItem => i.source === 'chat' && groupIds.includes(i.groupId),
  );

describe('getMentions', () => {
  it('a name mention by C is listed with author, group and excerpt', async () => {
    const s = await setup();
    const { message } = await send(s.gmChannel, s.C, `${mentionToken(s.A.id)} can you check?`);
    const items = await mine(s.A, [s.GM.id]);
    expect(items).toEqual([
      {
        source: 'chat',
        messageId: message.id,
        channelId: s.GM.channelId,
        taskId: null,
        ticketId: null,
        parentId: null,
        groupId: s.GM.id,
        groupName: 'Managed',
        authorName: 'Cyril',
        excerpt: '@Ada Admin can you check?',
        createdAt: message.createdAt,
      },
    ]);
  });

  it('@all in GM is listed; @all in GO is not', async () => {
    const s = await setup();
    const { message } = await send(s.gmChannel, s.C, `${mentionToken('all')} the form`);
    await send(s.goChannel, s.D, `${mentionToken('all')} the form`);
    const items = await mine(s.A, [s.GM.id, s.GO.id]);
    expect(items.map((i) => i.messageId)).toEqual([message.id]);
    expect(items[0]!.excerpt).toBe('@all the form');
  });

  it('a message with a name mention and @all in a managed group is one item', async () => {
    const s = await setup();
    await send(s.gmChannel, s.C, `${mentionToken('all')} and ${mentionToken(s.A.id)}`);
    expect(await mine(s.A, [s.GM.id])).toHaveLength(1);
  });

  it('own messages, deleted messages and read messages are excluded', async () => {
    const s = await setup();
    await newMessage(deps.db, {
      channelId: s.GM.channelId,
      authorId: s.A.id,
      mentions: [s.A.id],
      mentionsAll: true,
    });
    await newMessage(deps.db, {
      channelId: s.GM.channelId,
      authorId: s.C.id,
      mentions: [s.A.id],
      deletedAt: new Date(),
    });
    await send(s.gmChannel, s.C, `hi ${mentionToken(s.A.id)}`);
    expect(await mine(s.A, [s.GM.id])).toHaveLength(1);
    await markRead(deps.db, s.A.id, s.GM.channelId, new Date());
    expect(await mine(s.A, [s.GM.id])).toEqual([]);
  });

  it('a mention in a reply is listed with parentId and disappears after markThreadRead', async () => {
    const s = await setup();
    const { message: root } = await send(s.gmChannel, s.C, 'root');
    await markRead(deps.db, s.A.id, s.GM.channelId, new Date());
    const { message: reply } = await send(
      s.gmChannel,
      s.C,
      `look ${mentionToken(s.A.id)}`,
      root.id,
    );
    const items = await mine(s.A, [s.GM.id]);
    expect(items.map((i) => [i.messageId, i.parentId])).toEqual([[reply.id, root.id]]);
    await markThreadRead(deps.db, s.A.id, root.id);
    expect(await mine(s.A, [s.GM.id])).toEqual([]);
  });

  it('an @all reply counts until the channel read mark passes it', async () => {
    const s = await setup();
    const { message: root } = await send(s.gmChannel, s.C, 'root');
    await send(s.gmChannel, s.C, `${mentionToken('all')} reply`, root.id);
    expect(await mine(s.A, [s.GM.id])).toHaveLength(1);
    await markRead(deps.db, s.A.id, s.GM.channelId, new Date());
    expect(await mine(s.A, [s.GM.id])).toEqual([]);
  });

  it('a task chat mention carries taskId', async () => {
    const s = await setup();
    const taskId = await newTask(deps.db, { groupId: s.GM.id, createdBy: s.A.id });
    const channel = await ensureTaskChannel(deps.db, { id: taskId, groupId: s.GM.id });
    const { message } = await send(channel, s.C, `task ${mentionToken(s.A.id)}`);
    const items = await mine(s.A, [s.GM.id]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ messageId: message.id, channelId: channel.id, taskId });
  });

  describe('only what would notify (the dashboard follows the notification settings)', () => {
    /** A name mention of A in the group chat and in a task chat of GM. */
    async function both() {
      const s = await setup();
      const taskId = await newTask(deps.db, { groupId: s.GM.id, createdBy: s.A.id });
      const taskChannel = await ensureTaskChannel(deps.db, { id: taskId, groupId: s.GM.id });
      const { message: inChat } = await send(s.gmChannel, s.C, `chat ${mentionToken(s.A.id)}`);
      const { message: inTask } = await send(taskChannel, s.C, `task ${mentionToken(s.A.id)}`);
      const ids = async () => (await mine(s.A, [s.GM.id])).map((i) => i.messageId).sort();
      return { s, inChat, inTask, ids };
    }

    it('chat None hides the group chat mention; the task chat one stays', async () => {
      const { s, inTask, ids } = await both();
      await setNotificationChannel(deps.db, s.A.id, 'chat', 'none');
      expect(await ids()).toEqual([inTask.id]);
    });

    it('task board None hides the task chat mention; email still notifies', async () => {
      const { s, inChat, inTask, ids } = await both();
      await setNotificationChannel(deps.db, s.A.id, 'tasks', 'none');
      expect(await ids()).toEqual([inChat.id]);
      await setNotificationChannel(deps.db, s.A.id, 'tasks', 'email');
      expect(await ids()).toEqual([inChat.id, inTask.id].sort());
    });

    it('the group on Off hides both; Mentions and replies and All keep them', async () => {
      const { s, inChat, inTask, ids } = await both();
      const all = [inChat.id, inTask.id].sort();
      await setGroupMode(deps.db, s.A.id, s.GM.id, 'off');
      expect(await ids()).toEqual([]);
      await setGroupMode(deps.db, s.A.id, s.GM.id, 'mentions');
      expect(await ids()).toEqual(all);
      await setGroupMode(deps.db, s.A.id, s.GM.id, 'all');
      expect(await ids()).toEqual(all);
    });

    it('a default of Off hides them unless the group has its own mode', async () => {
      const { s, inChat, inTask, ids } = await both();
      // Also clears the manager's All for GM.
      await setDefaultMode(deps.db, s.A.id, 'off');
      expect(await ids()).toEqual([]);
      await setGroupMode(deps.db, s.A.id, s.GM.id, 'mentions');
      expect(await ids()).toEqual([inChat.id, inTask.id].sort());
    });

    it('the total counts only the listed mentions', async () => {
      const s = await setup();
      const A = await newAdmin(deps.db, 'Counted', [s.GM.id, s.GO.id]);
      await send(s.gmChannel, s.C, `one ${mentionToken(A.id)}`);
      await send(s.goChannel, s.D, `two ${mentionToken(A.id)}`);
      expect((await getMentions(deps.db, A)).total).toBe(2);
      await setGroupMode(deps.db, A.id, s.GO.id, 'off');
      const result = await getMentions(deps.db, A);
      expect(result.total).toBe(1);
      expect(result.items.map((i) => i.groupId)).toEqual([s.GM.id]);
    });
  });

  it('older than 90 days is excluded', async () => {
    const s = await setup();
    const { message } = await send(s.gmChannel, s.C, `old ${mentionToken(s.A.id)}`);
    await deps.db
      .update(messages)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(eq(messages.id, message.id));
    expect(await mine(s.A, [s.GM.id])).toEqual([]);
  });

  it('total caps at 100 and items at 20', async () => {
    const s = await setup();
    // A fresh admin, so other tests' mentions never count.
    const A = await newAdmin(deps.db, 'Solo', [s.GM.id]);
    const base = Date.now() - 60_000;
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) {
      ids.push(
        await newMessage(deps.db, {
          channelId: s.GM.channelId,
          authorId: s.C.id,
          mentions: [A.id],
          createdAt: new Date(base + i),
        }),
      );
    }
    const result = await getMentions(deps.db, A);
    expect(result.total).toBe(100);
    expect(result.items.map((i) => (i.source === 'chat' ? i.messageId : i.id))).toEqual(
      ids.slice(-20).reverse(),
    );
  });

  it('one statement', async () => {
    const s = await setup();
    await send(s.gmChannel, s.C, `hi ${mentionToken(s.A.id)}`);
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      expect((await getMentions(counted, s.A)).total).toBeGreaterThan(0);
      expect(statements).toBe(1);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});

describe('getMentions: mentions in descriptions (F16 follow-up, 2026-10-18)', () => {
  /** A managed group, its admin A and client C, and one subject of each kind in it. */
  async function subjects() {
    const GM = await newGroup(deps.db, 'Described');
    const A = await newAdmin(deps.db, 'Dora Admin', [GM.id]);
    const C = await newClient(deps.db, GM.id, 'Cecil');
    const taskId = await newTask(deps.db, { groupId: GM.id, createdBy: A.id, title: 'Budget' });
    const ticketId = randomUUID();
    const now = new Date();
    await deps.db.insert(tickets).values({
      id: ticketId,
      groupId: GM.id,
      status: 'new',
      source: 'manual',
      subject: 'Login',
      createdAt: now,
      updatedAt: now,
    });
    const [ticket] = await deps.db
      .select({ number: tickets.number })
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    const projectId = randomUUID();
    await deps.db
      .insert(projects)
      .values({ id: projectId, groupId: GM.id, name: 'Horizon', nameKey: `horizon-${projectId}` });
    const itemId = randomUUID();
    await deps.db.insert(knowledgeItems).values({
      id: itemId,
      groupId: GM.id,
      type: 'note',
      title: 'Guide',
      createdBy: A.id,
      searchText: 'guide',
    });
    const subject = {
      task: { kind: 'task', id: taskId, title: 'Budget' },
      ticket: { kind: 'ticket', id: ticketId, number: ticket!.number, subject: 'Login' },
      project: { kind: 'project', id: projectId, title: 'Horizon' },
      knowledge: { kind: 'knowledge', id: itemId, title: 'Guide', adminsOnly: false },
    } satisfies Record<string, DescriptionSubject>;
    /** C names A in the subject's description. */
    const name = (s: DescriptionSubject) =>
      recordDescriptionMentions(deps.db, {
        actor: C,
        groupId: GM.id,
        subject: s,
        before: '',
        after: `see ${mentionToken(A.id)}`,
      });
    const described = async () =>
      (await getMentions(deps.db, A)).items.filter(
        (i): i is DescriptionMentionItem => i.source === 'description',
      );
    const kinds = async () => (await described()).map((i) => i.subjectKind).sort();
    return { GM, A, C, subject, ticketNumber: ticket!.number, name, described, kinds };
  }

  it('each subject is listed with its current title, author and group, newest first', async () => {
    const s = await subjects();
    const [taskEvent] = await s.name(s.subject.task);
    await s.name(s.subject.ticket);
    await s.name(s.subject.project);
    await s.name(s.subject.knowledge);
    await deps.db
      .update(tasks)
      .set({ title: 'Budget 2027' })
      .where(eq(tasks.id, s.subject.task.id));
    const items = await s.described();
    expect(items.map((i) => [i.subjectKind, i.subjectId, i.title, i.ticketNumber])).toEqual([
      ['knowledge', s.subject.knowledge.id, 'Guide', null],
      ['project', s.subject.project.id, 'Horizon', null],
      ['ticket', s.subject.ticket.id, 'Login', s.ticketNumber],
      ['task', s.subject.task.id, 'Budget 2027', null],
    ]);
    expect(items.at(-1)).toEqual({
      source: 'description',
      id: taskEvent,
      subjectKind: 'task',
      subjectId: s.subject.task.id,
      title: 'Budget 2027',
      ticketNumber: null,
      groupId: s.GM.id,
      groupName: 'Described',
      authorName: 'Cecil',
      createdAt: expect.any(String),
    });
  });

  it('opening the subject after the mention clears it', async () => {
    const s = await subjects();
    for (const subject of Object.values(s.subject)) await s.name(subject);
    expect(await s.kinds()).toEqual(['knowledge', 'project', 'task', 'ticket']);
    await markTaskSeen(deps.db, s.A.id, s.subject.task.id);
    await markTicketSeen(deps.db, s.A.id, s.subject.ticket.id);
    expect(await s.kinds()).toEqual(['knowledge', 'project']);
    await markProjectSeen(deps.db, s.A.id, s.subject.project.id);
    await markKnowledgeSeen(deps.db, s.A.id, s.subject.knowledge.id);
    expect(await s.kinds()).toEqual([]);
    // A new mention after the open counts again.
    await s.name(s.subject.project);
    expect(await s.kinds()).toEqual(['project']);
  });

  it('a mention removed and added again without opening notifies once; after opening again', async () => {
    const s = await subjects();
    expect(await s.name(s.subject.task)).toHaveLength(1);
    // Removed and named again: A has not opened the task meanwhile.
    expect(await s.name(s.subject.task)).toEqual([]);
    expect(await s.kinds()).toEqual(['task']);
    await markTaskSeen(deps.db, s.A.id, s.subject.task.id);
    expect(await s.name(s.subject.task)).toHaveLength(1);
    expect(await s.name(s.subject.task)).toEqual([]);
    expect(await s.kinds()).toEqual(['task']);
  });

  it('a deleted subject drops its mention', async () => {
    const s = await subjects();
    await s.name(s.subject.task);
    await s.name(s.subject.knowledge);
    await deps.db.delete(tasks).where(eq(tasks.id, s.subject.task.id));
    await deps.db.delete(knowledgeItems).where(eq(knowledgeItems.id, s.subject.knowledge.id));
    expect(await s.kinds()).toEqual([]);
  });

  it('older than 90 days is excluded', async () => {
    const s = await subjects();
    const [id] = await s.name(s.subject.project);
    await deps.db
      .update(notificationEvents)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(eq(notificationEvents.id, id!));
    expect(await s.kinds()).toEqual([]);
  });

  it('follows the notification settings like delivery', async () => {
    const s = await subjects();
    for (const subject of Object.values(s.subject)) await s.name(subject);
    // The group on Off: only the ticket's passes (ticket board events pass every mode).
    await setGroupMode(deps.db, s.A.id, s.GM.id, 'off');
    expect(await s.kinds()).toEqual(['ticket']);
    await setGroupMode(deps.db, s.A.id, s.GM.id, 'mentions');
    expect(await s.kinds()).toEqual(['knowledge', 'project', 'task', 'ticket']);
    // A task's and a project's follow the task board, a knowledge item's the knowledge base.
    await setNotificationChannel(deps.db, s.A.id, 'tasks', 'none');
    expect(await s.kinds()).toEqual(['knowledge', 'ticket']);
    await setNotificationChannel(deps.db, s.A.id, 'knowledge', 'none');
    await setNotificationChannel(deps.db, s.A.id, 'tickets', 'none');
    expect(await s.kinds()).toEqual([]);
  });

  it('counts with the chat mentions, in one statement plus the ticket check', async () => {
    const s = await subjects();
    const channel = (await getChannel(deps.db, s.GM.channelId))!;
    await s.name(s.subject.task);
    await send(channel, s.C, `chat ${mentionToken(s.A.id)}`);
    await s.name(s.subject.ticket);
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      const result = await getMentions(counted, s.A);
      expect(result.total).toBe(3);
      expect(result.items.map((i) => (i.source === 'chat' ? 'chat' : i.subjectKind))).toEqual([
        'ticket',
        'chat',
        'task',
      ]);
      // The listed tickets' read access is checked in one batch query after it.
      expect(statements).toBe(2);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
