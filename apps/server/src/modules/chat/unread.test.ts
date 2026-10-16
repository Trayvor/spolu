import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import type { SendMessageInput, SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { tasks } from '../tasks/schema.js';
import { ensureBoard, listBuckets } from '../tasks/service.js';
import { deleteMessage, getMessage, sendMessage } from './messages.js';
import { messages, threadReadStates } from './schema.js';
import {
  ensureGroupChannel,
  ensureTaskChannel,
  markAllRead,
  markRead,
  markThreadRead,
  recordReplyReads,
  taskChatSummaries,
  unreadByGroup,
  unreadCount,
  unreadThreads,
  type ChannelRow,
} from './service.js';

// Unread counts with thread replies (polish C1): a reply counts for the people of its thread.

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

/** A group chat with an admin and three clients; Anna's chat is read up to now. */
async function setup() {
  const group = await createGroup(deps.db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const admin = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Admin' });
  const a = await newClient(group.id, 'Anna');
  const b = await newClient(group.id, 'Boris');
  const c = await newClient(group.id, 'Cyril');
  return { group, channel, admin: asSession({ ...admin, role: 'admin' }), a, b, c };
}

const send = async (
  channel: ChannelRow,
  author: SessionUser,
  data: Partial<SendMessageInput> = {},
) =>
  (
    await sendMessage(deps, {
      channel,
      author,
      data: { body: 'hello', clientId: randomUUID(), ...data },
    })
  ).message;

/** Marks the main feed read, so only thread replies are left to count. */
const readFeed = (s: Awaited<ReturnType<typeof setup>>, who: SessionUser) =>
  markRead(deps.db, who.id, s.channel.id, new Date());

describe('unread thread replies', () => {
  it('counts replies in a thread the user started', async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    await send(s.channel, s.b, { parentId: root.id });
    await send(s.channel, s.c, { parentId: root.id });
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(2);
    expect(await unreadThreads(deps.db, s.a.id, s.channel.id)).toEqual([root.id]);
  });

  it('counts later replies in a thread the user replied in, not the earlier ones', async () => {
    const s = await setup();
    const root = await send(s.channel, s.b);
    await send(s.channel, s.c, { parentId: root.id });
    await send(s.channel, s.a, { parentId: root.id });
    await readFeed(s, s.a);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
    await send(s.channel, s.b, { parentId: root.id });
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(1);
  });

  // A quote always points into its own thread (checkThread), so its author is one of the thread's
  // people: this case is covered by the thread rows and needs no rule of its own.
  it("counts a reply that quotes the user's message (one of the thread's people, via checkThread)", async () => {
    const s = await setup();
    const root = await send(s.channel, s.b);
    const mine = await send(s.channel, s.a, { parentId: root.id });
    await readFeed(s, s.a);
    await send(s.channel, s.c, { parentId: root.id, replyToId: mine.id });
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(1);
  });

  it("never counts the user's own messages, other threads or deleted replies", async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    const elsewhere = await send(s.channel, s.b);
    await readFeed(s, s.a);
    await send(s.channel, s.a, { parentId: root.id });
    await send(s.channel, s.c, { parentId: elsewhere.id });
    const gone = await send(s.channel, s.b, { parentId: root.id });
    await deleteMessage(deps, {
      channel: s.channel,
      message: (await getMessage(deps.db, gone.id))!,
    });
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
    expect(await unreadThreads(deps.db, s.a.id, s.channel.id)).toEqual([]);
  });

  it('reading the main feed leaves thread replies unread; reading the thread clears them', async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    await send(s.channel, s.b, { parentId: root.id });
    await send(s.channel, s.c);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(2);
    await readFeed(s, s.a);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(1);
    expect(await markThreadRead(deps.db, s.a.id, root.id)).toBeInstanceOf(Date);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
    expect(await unreadThreads(deps.db, s.a.id, s.channel.id)).toEqual([]);
  });

  it('reading a thread the user is not in records nothing', async () => {
    const s = await setup();
    const root = await send(s.channel, s.b);
    await send(s.channel, s.c, { parentId: root.id });
    expect(await markThreadRead(deps.db, s.a.id, root.id)).toBeNull();
    // Anna joins later: replies before her own one stay read for her.
    await send(s.channel, s.a, { parentId: root.id });
    await readFeed(s, s.a);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
  });

  it('unreadByGroup adds the thread replies to the top-level count', async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    await send(s.channel, s.b, { parentId: root.id });
    await send(s.channel, s.b);
    expect((await unreadByGroup(deps.db, s.a.id, null))[s.group.id]).toBe(2);
    expect(await unreadByGroup(deps.db, s.a.id, s.group.id)).toEqual({ [s.group.id]: 2 });
  });

  it('a reply that committed first but has a later time is read by the next replier', async () => {
    const s = await setup();
    const root = await send(s.channel, s.c);
    // Boris's reply got its time first but committed first too: Anna's reply sees it.
    const later = new Date(Date.now() + 60_000);
    await deps.db.insert(messages).values({
      id: randomUUID(),
      channelId: s.channel.id,
      authorId: s.b.id,
      parentId: root.id,
      body: 'early',
      clientId: randomUUID(),
      changeSeq: 1,
      createdAt: later,
    });
    await recordReplyReads(
      deps.db,
      { channelId: s.channel.id, rootId: root.id, authorId: s.b.id },
      { authorId: s.c.id, createdAt: new Date(root.createdAt) },
    );
    await send(s.channel, s.a, { parentId: root.id });
    const [row] = await deps.db
      .select()
      .from(threadReadStates)
      .where(and(eq(threadReadStates.rootId, root.id), eq(threadReadStates.userId, s.a.id)));
    expect(row!.lastReadAt.getTime()).toBe(later.getTime());
    expect(row!.lastReplyAt.getTime()).toBe(later.getTime());
    await readFeed(s, s.a);
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
  });

  it('deleting the only unread reply takes the thread out of the unread index', async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    const reply = await send(s.channel, s.b, { parentId: root.id });
    await deleteMessage(deps, {
      channel: s.channel,
      message: (await getMessage(deps.db, reply.id))!,
    });
    const [row] = await deps.db
      .select()
      .from(threadReadStates)
      .where(and(eq(threadReadStates.rootId, root.id), eq(threadReadStates.userId, s.a.id)));
    expect(row!.lastReadAt.getTime()).toBe(row!.lastReplyAt.getTime());
    expect(await unreadCount(deps.db, s.a.id, s.channel.id)).toBe(0);
  });
});

/** A task in the group's To do (no chat channel yet). */
async function newTask(groupId: string, authorId: string) {
  await ensureBoard(deps.db, groupId);
  const todo = (await listBuckets(deps.db, groupId)).find((b) => b.kind === 'todo')!;
  const now = new Date();
  const task = { id: randomUUID(), groupId };
  await deps.db.insert(tasks).values({
    ...task,
    bucketId: todo.id,
    position: `a${randomUUID().slice(0, 8)}`,
    title: 'Task',
    createdBy: authorId,
    createdAt: now,
    updatedAt: now,
  });
  return task;
}

describe('taskChatSummaries', () => {
  it('counts live messages and flags unread per task', async () => {
    const s = await setup();
    const a = await newTask(s.group.id, s.a.id);
    const b = await newTask(s.group.id, s.a.id);
    await newTask(s.group.id, s.a.id); // no chat channel: absent
    const chatA = await ensureTaskChannel(deps.db, a);
    const chatB = await ensureTaskChannel(deps.db, b);
    await send(chatA, s.b);
    await send(chatA, s.b);
    await send(chatA, s.a);
    const gone = await send(chatA, s.b);
    await deleteMessage(deps, { channel: chatA, message: (await getMessage(deps.db, gone.id))! });
    await send(chatB, s.a);
    expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toEqual({
      [a.id]: { count: 3, unread: true },
      [b.id]: { count: 1, unread: false },
    });
    // Replies count too; reading the channel clears the top-level unread.
    const root = (await send(chatB, s.a)).id;
    await send(chatB, s.b, { parentId: root });
    await markRead(deps.db, s.a.id, chatA.id, new Date());
    expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toMatchObject({
      [a.id]: { count: 3, unread: false },
      [b.id]: { count: 3, unread: true },
    });
  });

  it('a reply by someone else in my thread makes the task unread; markAllRead clears it', async () => {
    const s = await setup();
    const task = await newTask(s.group.id, s.a.id);
    const chat = await ensureTaskChannel(deps.db, task);
    const root = await send(chat, s.a);
    await send(chat, s.b, { parentId: root.id });
    // A thread Anna is not one of the people of never makes the task unread for her.
    const foreign = await send(chat, s.c);
    await send(chat, s.b, { parentId: foreign.id });
    await markRead(deps.db, s.a.id, chat.id, new Date());
    expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toEqual({
      [task.id]: { count: 4, unread: true },
    });
    const at = await markAllRead(deps.db, s.a.id, chat.id);
    expect(at).toBeInstanceOf(Date);
    expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toEqual({
      [task.id]: { count: 4, unread: false },
    });
    expect(await unreadThreads(deps.db, s.a.id, chat.id)).toEqual([]);
    // Only Anna's marks move: Cyril still has Boris's reply in his thread to read.
    await markRead(deps.db, s.c.id, chat.id, new Date());
    expect(await taskChatSummaries(deps.db, s.c.id, s.group.id)).toEqual({
      [task.id]: { count: 4, unread: true },
    });
  });

  it('markAllRead on a chat never read creates the read mark', async () => {
    const s = await setup();
    const task = await newTask(s.group.id, s.a.id);
    const chat = await ensureTaskChannel(deps.db, task);
    await send(chat, s.b);
    await markAllRead(deps.db, s.a.id, chat.id);
    expect((await taskChatSummaries(deps.db, s.a.id, s.group.id))[task.id]).toEqual({
      count: 1,
      unread: false,
    });
  });

  it('a task chat whose only message by someone else was deleted is not unread', async () => {
    const s = await setup();
    const task = await newTask(s.group.id, s.a.id);
    const chat = await ensureTaskChannel(deps.db, task);
    await send(chat, s.a);
    const gone = await send(chat, s.b);
    await deleteMessage(deps, { channel: chat, message: (await getMessage(deps.db, gone.id))! });
    expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toEqual({
      [task.id]: { count: 1, unread: false },
    });
  });

  it('never counts task chats in the group chat badge', async () => {
    const s = await setup();
    const task = await newTask(s.group.id, s.a.id);
    const chat = await ensureTaskChannel(deps.db, task);
    const root = await send(chat, s.a);
    await send(chat, s.b);
    await send(chat, s.b, { parentId: root.id });
    expect(await unreadByGroup(deps.db, s.a.id, s.group.id)).toEqual({});
    expect((await unreadByGroup(deps.db, s.a.id, null))[s.group.id]).toBeUndefined();
  });

  it("is one statement and leaves other groups' task chats out", async () => {
    const s = await setup();
    const other = await setup();
    const otherTask = await newTask(other.group.id, other.a.id);
    await send(await ensureTaskChannel(deps.db, otherTask), other.b);
    const task = await newTask(s.group.id, s.a.id);
    await send(await ensureTaskChannel(deps.db, task), s.b);
    const spy = vi.spyOn(deps.db, 'execute');
    try {
      expect(await taskChatSummaries(deps.db, s.a.id, s.group.id)).toEqual({
        [task.id]: { count: 1, unread: true },
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('migration 0008 backfill', () => {
  const migration = readFileSync(
    new URL('../../infra/db/migrations/0008_thread_read_states.sql', import.meta.url),
    'utf8',
  );
  const backfill = migration.split('--> statement-breakpoint').at(-1)!;

  it('existing threads are neither unread nor lost', async () => {
    const s = await setup();
    // A thread from before the release: rows only, no read states.
    const rootId = randomUUID();
    const base = { channelId: s.channel.id, body: 'old', changeSeq: 1 };
    const old = new Date(Date.now() - 3_600_000);
    await deps.db.insert(messages).values([
      {
        ...base,
        id: rootId,
        authorId: s.a.id,
        clientId: randomUUID(),
        createdAt: old,
        replyCount: 1,
      },
      {
        ...base,
        id: randomUUID(),
        authorId: s.b.id,
        parentId: rootId,
        clientId: randomUUID(),
        createdAt: old,
      },
    ]);
    class Rollback extends Error {}
    await expect(
      deps.db.transaction(async (tx) => {
        await tx.execute(sql.raw(backfill));
        const rows = await tx
          .select({ userId: threadReadStates.userId })
          .from(threadReadStates)
          .where(eq(threadReadStates.rootId, rootId));
        expect(rows.map((r) => r.userId).sort()).toEqual([s.a.id, s.b.id].sort());
        expect(await unreadCount(tx, s.a.id, s.channel.id)).toBe(0);
        // Not lost: a new reply counts for both people of the thread.
        await tx.insert(messages).values({
          ...base,
          id: randomUUID(),
          authorId: s.c.id,
          parentId: rootId,
          clientId: randomUUID(),
          // now() is fixed for the transaction (the backfill's mark): come after it.
          createdAt: new Date(Date.now() + 1000),
        });
        await recordReplyReads(
          tx,
          { channelId: s.channel.id, rootId, authorId: s.c.id },
          { authorId: s.a.id, createdAt: old },
        );
        expect(await unreadCount(tx, s.a.id, s.channel.id)).toBe(1);
        expect(await unreadThreads(tx, s.a.id, s.channel.id)).toEqual([rootId]);
        expect(await unreadThreads(tx, s.b.id, s.channel.id)).toEqual([rootId]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
