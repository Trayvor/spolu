import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SendMessageInput, SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { deleteMessage, getMessage, sendMessage } from './messages.js';
import {
  ensureGroupChannel,
  markRead,
  markThreadRead,
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

  it("counts a reply that quotes the user's message", async () => {
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
});
