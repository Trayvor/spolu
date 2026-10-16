import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { mentionToken, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { sendMessage } from '../chat/messages.js';
import { messages } from '../chat/schema.js';
import { ensureTaskChannel, getChannel, markRead, markThreadRead } from '../chat/service.js';
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

const mine = async (userId: string, groupIds: string[]) =>
  (await getMentions(deps.db, userId)).items.filter((i) => groupIds.includes(i.groupId));

describe('getMentions', () => {
  it('a name mention by C is listed with author, group and excerpt', async () => {
    const s = await setup();
    const { message } = await send(s.gmChannel, s.C, `${mentionToken(s.A.id)} can you check?`);
    const items = await mine(s.A.id, [s.GM.id]);
    expect(items).toEqual([
      {
        messageId: message.id,
        channelId: s.GM.channelId,
        taskId: null,
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
    const items = await mine(s.A.id, [s.GM.id, s.GO.id]);
    expect(items.map((i) => i.messageId)).toEqual([message.id]);
    expect(items[0]!.excerpt).toBe('@all the form');
  });

  it('a message with a name mention and @all in a managed group is one item', async () => {
    const s = await setup();
    await send(s.gmChannel, s.C, `${mentionToken('all')} and ${mentionToken(s.A.id)}`);
    expect(await mine(s.A.id, [s.GM.id])).toHaveLength(1);
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
    expect(await mine(s.A.id, [s.GM.id])).toHaveLength(1);
    await markRead(deps.db, s.A.id, s.GM.channelId, new Date());
    expect(await mine(s.A.id, [s.GM.id])).toEqual([]);
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
    const items = await mine(s.A.id, [s.GM.id]);
    expect(items.map((i) => [i.messageId, i.parentId])).toEqual([[reply.id, root.id]]);
    await markThreadRead(deps.db, s.A.id, root.id);
    expect(await mine(s.A.id, [s.GM.id])).toEqual([]);
  });

  it('an @all reply counts until the channel read mark passes it', async () => {
    const s = await setup();
    const { message: root } = await send(s.gmChannel, s.C, 'root');
    await send(s.gmChannel, s.C, `${mentionToken('all')} reply`, root.id);
    expect(await mine(s.A.id, [s.GM.id])).toHaveLength(1);
    await markRead(deps.db, s.A.id, s.GM.channelId, new Date());
    expect(await mine(s.A.id, [s.GM.id])).toEqual([]);
  });

  it('a task chat mention carries taskId', async () => {
    const s = await setup();
    const taskId = await newTask(deps.db, { groupId: s.GM.id, createdBy: s.A.id });
    const channel = await ensureTaskChannel(deps.db, { id: taskId, groupId: s.GM.id });
    const { message } = await send(channel, s.C, `task ${mentionToken(s.A.id)}`);
    const items = await mine(s.A.id, [s.GM.id]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ messageId: message.id, channelId: channel.id, taskId });
  });

  it('older than 90 days is excluded', async () => {
    const s = await setup();
    const { message } = await send(s.gmChannel, s.C, `old ${mentionToken(s.A.id)}`);
    await deps.db
      .update(messages)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(eq(messages.id, message.id));
    expect(await mine(s.A.id, [s.GM.id])).toEqual([]);
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
    const result = await getMentions(deps.db, A.id);
    expect(result.total).toBe(100);
    expect(result.items.map((i) => i.messageId)).toEqual(ids.slice(-20).reverse());
  });

  it('one statement', async () => {
    const s = await setup();
    await send(s.gmChannel, s.C, `hi ${mentionToken(s.A.id)}`);
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      expect((await getMentions(counted, s.A.id)).total).toBeGreaterThan(0);
      expect(statements).toBe(1);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
