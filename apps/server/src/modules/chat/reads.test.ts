import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SendMessageInput, SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { createUnverifiedClient } from '../users/service.js';
import { deleteMessage, getMessage, sendMessage } from './messages.js';
import {
  changesAfter,
  encodeCursor,
  getThread,
  pageAfter,
  pageAround,
  pageBefore,
  parseCursor,
} from './reads.js';
import { channels, messages } from './schema.js';
import { ensureGroupChannel, getChannel, markRead, type ChannelRow } from './service.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

async function setup() {
  const group = await createGroup(deps.db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const row = await createUnverifiedClient(deps.db, `${randomUUID()}@example.com`);
  await deps.db.update(user).set({ emailVerified: true, name: 'Anna' }).where(eq(user.id, row.id));
  await addMember(deps.db, group.id, row.id);
  const a = { id: row.id, email: row.email, name: 'Anna', role: row.role } as SessionUser;
  return { group, channel, a };
}

const send = (channel: ChannelRow, author: SessionUser, data: Partial<SendMessageInput> = {}) =>
  sendMessage(deps, { channel, author, data: { body: 'hello', clientId: randomUUID(), ...data } });

const remove = async (channel: ChannelRow, id: string) =>
  deleteMessage(deps, { channel, message: (await getMessage(deps.db, id))! });

const fresh = async (channel: ChannelRow) => (await getChannel(deps.db, channel.id))!;

/** Inserts top-level rows directly with the given created_at values. */
async function insertRows(s: Awaited<ReturnType<typeof setup>>, times: Date[]) {
  const ids: string[] = [];
  for (const createdAt of times) {
    const id = randomUUID();
    ids.push(id);
    const [c] = await deps.db
      .update(channels)
      .set({ lastSeq: 1 })
      .where(eq(channels.id, s.channel.id))
      .returning();
    await deps.db.insert(messages).values({
      id,
      channelId: s.channel.id,
      authorId: s.a.id,
      body: 'x',
      clientId: randomUUID(),
      changeSeq: c!.lastSeq,
      createdAt,
    });
  }
  return ids;
}

describe('cursor', () => {
  it('round-trips and rejects garbage', () => {
    const m = { createdAt: '2026-01-01T00:00:00.123Z', id: 'abc' };
    const parsed = parseCursor(encodeCursor(m))!;
    expect(parsed.createdAt.toISOString()).toBe(m.createdAt);
    expect(parsed.id).toBe('abc');
    expect(parseCursor('nope')).toBeNull();
    expect(parseCursor('not-a-date,abc')).toBeNull();
    expect(parseCursor('2026-01-01T00:00:00.000Z,')).toBeNull();
  });

  it('orders rows sharing a millisecond by id and never skips or repeats one', async () => {
    const s = await setup();
    const t1 = new Date('2026-03-01T10:00:00.000Z');
    const t2 = new Date('2026-03-01T10:00:00.500Z');
    const t3 = new Date('2026-03-01T10:00:01.000Z');
    const ids = await insertRows(s, [t1, t2, t2, t3]);
    const seen: string[] = [];
    let cursor: ReturnType<typeof parseCursor> = null;
    for (;;) {
      const page = await pageBefore(deps.db, s.channel, s.a.id, cursor, 1);
      seen.push(...page.messages.map((m) => m.id));
      if (!page.hasMore) break;
      cursor = parseCursor(encodeCursor(page.messages.at(-1)!));
    }
    expect(seen).toHaveLength(4);
    expect(new Set(seen)).toEqual(new Set(ids));
    const [tie1, tie2] = [ids[1]!, ids[2]!].sort();
    expect(seen.indexOf(tie2!)).toBeLessThan(seen.indexOf(tie1!));
  });
});

describe('pageBefore / pageAfter', () => {
  it('paging 60 messages with before cursors returns each once, newest first, hasMore false at the end', async () => {
    const s = await setup();
    const sent: string[] = [];
    for (let i = 0; i < 60; i++)
      sent.push((await send(s.channel, s.a, { body: `m${i}` })).message.id);
    const first = await pageBefore(deps.db, await fresh(s.channel), s.a.id, null);
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.lastSeq).toBe(60);
    const second = await pageBefore(
      deps.db,
      s.channel,
      s.a.id,
      parseCursor(encodeCursor(first.messages.at(-1)!)),
    );
    expect(second.messages).toHaveLength(10);
    expect(second.hasMore).toBe(false);
    const all = [...first.messages, ...second.messages].map((m) => m.id);
    expect(new Set(all).size).toBe(60);
    expect(all).toEqual([...sent].reverse());
  });

  it('after cursor pages forward, oldest first, and reports lastReadAt', async () => {
    const s = await setup();
    const sent: string[] = [];
    for (let i = 0; i < 5; i++)
      sent.push((await send(s.channel, s.a, { body: `m${i}` })).message.id);
    const [m0] = await deps.db.select().from(messages).where(eq(messages.id, sent[0]!));
    const cursor = { createdAt: m0!.createdAt, id: m0!.id };
    const page = await pageAfter(deps.db, s.channel, s.a.id, cursor, 3);
    expect(page.messages.map((m) => m.id)).toEqual(sent.slice(1, 4));
    expect(page.hasMore).toBe(true);
    expect(page.lastReadAt).toBeNull();
    const at = await markRead(deps.db, s.a.id, s.channel.id, new Date());
    const rest = await pageAfter(
      deps.db,
      s.channel,
      s.a.id,
      parseCursor(encodeCursor(page.messages.at(-1)!))!,
      3,
    );
    expect(rest.messages.map((m) => m.id)).toEqual(sent.slice(4));
    expect(rest.hasMore).toBe(false);
    expect(rest.lastReadAt).toBe(at.toISOString());
  });

  it('excludes replies and shows deleted messages as deleted', async () => {
    const s = await setup();
    const root = (await send(s.channel, s.a)).message;
    await send(s.channel, s.a, { parentId: root.id });
    await remove(s.channel, root.id);
    const page = await pageBefore(deps.db, s.channel, s.a.id, null);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ id: root.id, body: '', replyCount: 1 });
    expect(page.messages[0]!.deletedAt).not.toBeNull();
    const thread = await getThread(deps.db, s.channel, root.id);
    expect(thread!.root.deletedAt).not.toBeNull();
    expect(thread!.replies).toHaveLength(1);
  });
});

describe('pageAround', () => {
  it("returns the page containing a reply's root with hasOlder/hasNewer", async () => {
    const s = await setup();
    const sent: string[] = [];
    for (let i = 0; i < 60; i++)
      sent.push((await send(s.channel, s.a, { body: `m${i}` })).message.id);
    const reply = (await send(s.channel, s.a, { parentId: sent[30]!, body: 'r' })).message;
    const page = (await pageAround(deps.db, s.channel, s.a.id, reply.id))!;
    expect(page.targetId).toBe(sent[30]);
    expect(page.messages.map((m) => m.id)).toEqual(sent.slice(5, 55));
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(true);
    const edge = (await pageAround(deps.db, s.channel, s.a.id, sent[0]!))!;
    expect(edge.hasOlder).toBe(false);
    expect(edge.messages[0]!.id).toBe(sent[0]);
    expect(edge.messages).toHaveLength(25);
    expect(edge.hasNewer).toBe(true);
  });

  it('returns null for an unknown message or one of another channel', async () => {
    const s = await setup();
    const other = await setup();
    const foreign = (await send(other.channel, other.a)).message;
    expect(await pageAround(deps.db, s.channel, s.a.id, randomUUID())).toBeNull();
    expect(await pageAround(deps.db, s.channel, s.a.id, foreign.id)).toBeNull();
    expect(await getThread(deps.db, s.channel, foreign.id)).toBeNull();
  });
});

describe('getThread', () => {
  it('returns root and replies oldest first; a reply id gives the same thread', async () => {
    const s = await setup();
    const root = (await send(s.channel, s.a)).message;
    const r1 = (await send(s.channel, s.a, { parentId: root.id, body: 'r1' })).message;
    const r2 = (await send(s.channel, s.a, { parentId: root.id, replyToId: r1.id, body: 'r2' }))
      .message;
    const thread = (await getThread(deps.db, s.channel, root.id))!;
    expect(thread.root.id).toBe(root.id);
    expect(thread.root.replyCount).toBe(2);
    expect(thread.replies.map((m) => m.id)).toEqual([r1.id, r2.id]);
    expect(await getThread(deps.db, s.channel, r2.id)).toEqual(thread);
  });
});

describe('changesAfter', () => {
  it('returns new, edited and deleted messages and the parent with its new reply count, ascending', async () => {
    const s = await setup();
    const root = (await send(s.channel, s.a)).message;
    const other = (await send(s.channel, s.a, { body: 'other' })).message;
    const mark = (await fresh(s.channel)).lastSeq;
    const reply = (await send(s.channel, s.a, { parentId: root.id })).message;
    const added = (await send(s.channel, s.a, { body: 'new' })).message;
    await remove(s.channel, other.id);
    const changes = await changesAfter(deps.db, await fresh(s.channel), mark);
    expect(changes.truncated).toBe(false);
    expect(changes.lastSeq).toBe(mark + 3);
    const seqs = changes.messages.map((m) => m.changeSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    const byId = new Map(changes.messages.map((m) => [m.id, m]));
    expect(new Set(byId.keys())).toEqual(new Set([root.id, reply.id, added.id, other.id]));
    expect(byId.get(root.id)!.replyCount).toBe(1);
    expect(byId.get(other.id)!.deletedAt).not.toBeNull();
    expect((await changesAfter(deps.db, s.channel, mark + 3)).messages).toEqual([]);
  });

  it('truncates at 500', async () => {
    const s = await setup();
    const base = new Date('2026-03-01T10:00:00.000Z');
    for (let i = 0; i < 501; i++) {
      await deps.db.insert(messages).values({
        id: randomUUID(),
        channelId: s.channel.id,
        authorId: s.a.id,
        body: 'x',
        clientId: randomUUID(),
        changeSeq: i + 1,
        createdAt: new Date(base.getTime() + i),
      });
    }
    await deps.db.update(channels).set({ lastSeq: 501 }).where(eq(channels.id, s.channel.id));
    const changes = await changesAfter(deps.db, await fresh(s.channel), 0);
    expect(changes.messages).toHaveLength(500);
    expect(changes.truncated).toBe(true);
    expect(changes.lastSeq).toBe(501);
    expect(changes.messages.at(-1)!.changeSeq).toBe(500);
  });
});
