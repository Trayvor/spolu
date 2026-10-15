import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient } from '../users/service.js';
import { messages } from './schema.js';
import {
  ensureGroupChannel,
  getChannel,
  getLastReadAt,
  markRead,
  nextSeq,
  unreadByGroup,
  unreadCount,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
const newUser = () => createUnverifiedClient(db, `${randomUUID()}@example.com`);

async function addMessage(
  channelId: string,
  authorId: string,
  extra: Partial<typeof messages.$inferInsert> = {},
) {
  await db.insert(messages).values({
    id: randomUUID(),
    channelId,
    authorId,
    body: 'hi',
    clientId: randomUUID(),
    changeSeq: 1,
    ...extra,
  });
}

describe('ensureGroupChannel', () => {
  it('creates once; 5 parallel calls return the same id', async () => {
    const group = await newGroup();
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => ensureGroupChannel(db, group.id)),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ groupId: group.id, kind: 'group', lastSeq: 0 });
    expect((await ensureGroupChannel(db, group.id)).id).toBe(rows[0]!.id);
    expect((await getChannel(db, rows[0]!.id))?.groupId).toBe(group.id);
    expect(await getChannel(db, randomUUID())).toBeNull();
  });
});

describe('nextSeq', () => {
  it('increments by one per call', async () => {
    const channel = await ensureGroupChannel(db, (await newGroup()).id);
    expect(await nextSeq(db, channel.id)).toBe(1);
    expect(await nextSeq(db, channel.id)).toBe(2);
    expect((await getChannel(db, channel.id))?.lastSeq).toBe(2);
  });
});

describe('markRead', () => {
  it('never moves backwards and never past now', async () => {
    const channel = await ensureGroupChannel(db, (await newGroup()).id);
    const u = await newUser();
    expect(await getLastReadAt(db, u.id, channel.id)).toBeNull();
    const t1 = new Date(Date.now() - 60_000);
    expect((await markRead(db, u.id, channel.id, t1)).getTime()).toBe(t1.getTime());
    const earlier = new Date(t1.getTime() - 30_000);
    expect((await markRead(db, u.id, channel.id, earlier)).getTime()).toBe(t1.getTime());
    const future = new Date(Date.now() + 3_600_000);
    const stored = await markRead(db, u.id, channel.id, future);
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now());
    expect(stored.getTime()).toBeGreaterThan(t1.getTime());
    expect((await getLastReadAt(db, u.id, channel.id))?.getTime()).toBe(stored.getTime());
  });
});

describe('unreadCount', () => {
  it('ignores own messages, thread replies and deleted messages, counts messages after last_read_at', async () => {
    const channel = await ensureGroupChannel(db, (await newGroup()).id);
    const me = await newUser();
    const other = await newUser();
    const old = new Date(Date.now() - 120_000);
    const fresh = new Date(Date.now() - 10_000);
    const readAt = new Date(Date.now() - 60_000);
    const rootId = randomUUID();
    await addMessage(channel.id, other.id, { id: rootId, createdAt: old });
    await addMessage(channel.id, other.id, { createdAt: fresh });
    await addMessage(channel.id, other.id, { createdAt: fresh });
    await addMessage(channel.id, me.id, { createdAt: fresh });
    await addMessage(channel.id, other.id, { createdAt: fresh, parentId: rootId });
    await addMessage(channel.id, other.id, { createdAt: fresh, deletedAt: new Date() });
    await markRead(db, me.id, channel.id, readAt);
    expect(await unreadCount(db, me.id, channel.id)).toBe(2);
  });

  it('with no read state counts every message', async () => {
    const channel = await ensureGroupChannel(db, (await newGroup()).id);
    const me = await newUser();
    const other = await newUser();
    await addMessage(channel.id, other.id, { createdAt: new Date(Date.now() - 86_400_000) });
    await addMessage(channel.id, other.id);
    expect(await unreadCount(db, me.id, channel.id)).toBe(2);
  });
});

describe('unreadByGroup', () => {
  it('counts at most 100 per group', async () => {
    const g = await newGroup();
    const c = await ensureGroupChannel(db, g.id);
    const me = await newUser();
    const other = await newUser();
    const base = {
      channelId: c.id,
      authorId: other.id,
      body: 'hi',
      changeSeq: 1,
    };
    await db
      .insert(messages)
      .values(
        Array.from({ length: 105 }, () => ({ ...base, id: randomUUID(), clientId: randomUUID() })),
      );
    expect((await unreadByGroup(db, me.id, null))[g.id]).toBe(100);
  });

  it('returns per-group counts, only the client group for a client', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    const c1 = await ensureGroupChannel(db, g1.id);
    const c2 = await ensureGroupChannel(db, g2.id);
    const me = await newUser();
    const other = await newUser();
    await addMessage(c1.id, other.id);
    await addMessage(c1.id, other.id);
    await addMessage(c2.id, other.id);
    const all = await unreadByGroup(db, me.id, null);
    expect(all[g1.id]).toBe(2);
    expect(all[g2.id]).toBe(1);
    expect(await unreadByGroup(db, me.id, g1.id)).toEqual({ [g1.id]: 2 });
    await markRead(db, me.id, c1.id, new Date());
    expect((await unreadByGroup(db, me.id, null))[g1.id]).toBeUndefined();
  });
});
