import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SendMessageInput, SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, createUnverifiedClient } from '../users/service.js';
import { deleteMessage, getMessage, sendMessage } from './messages.js';
import { unreadForNotify } from './notify.js';
import { ensureGroupChannel, markRead, markThreadRead, type ChannelRow } from './service.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  const test = await buildTestApp();
  // No delivery here: these tests only read the marks.
  deps = { ...test.deps, jobs: { send: async () => {} } };
  close = test.close;
});
/** Admins are people of every group: deactivate ours so later sends elsewhere skip them. */
const admins: string[] = [];
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

async function newClient(groupId: string, name: string): Promise<SessionUser> {
  const row = await createUnverifiedClient(deps.db, `${randomUUID()}@example.com`);
  await deps.db.update(user).set({ emailVerified: true, name }).where(eq(user.id, row.id));
  await addMember(deps.db, groupId, row.id);
  return { id: row.id, email: row.email, name, role: 'client' } as SessionUser;
}

async function setup() {
  const group = await createGroup(deps.db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const row = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Admin' });
  admins.push(row.id);
  const admin = { id: row.id, email: row.email, name: 'Admin', role: 'admin' } as SessionUser;
  return { channel, admin, a: await newClient(group.id, 'Anna') };
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

const unread = async (userId: string, messageId: string) =>
  (await unreadForNotify(deps.db, [{ userId, messageId }])).get(`${userId}:${messageId}`);

describe('unreadForNotify', () => {
  it('top-level unread until the channel mark passes it', async () => {
    const s = await setup();
    const m = await send(s.channel, s.admin);
    expect(await unread(s.a.id, m.id)).toEqual({
      id: m.id,
      channelId: s.channel.id,
      parentId: null,
    });
    await markRead(deps.db, s.a.id, s.channel.id, new Date(Date.now() + 1000));
    expect(await unread(s.a.id, m.id)).toBeUndefined();
  });

  it('a reply is unread until the thread mark passes it', async () => {
    const s = await setup();
    const root = await send(s.channel, s.a);
    const reply = await send(s.channel, s.admin, { parentId: root.id });
    // The channel mark does not cover replies.
    await markRead(deps.db, s.a.id, s.channel.id, new Date(Date.now() + 1000));
    expect(await unread(s.a.id, reply.id)).toEqual({
      id: reply.id,
      channelId: s.channel.id,
      parentId: root.id,
    });
    await markThreadRead(deps.db, s.a.id, root.id);
    expect(await unread(s.a.id, reply.id)).toBeUndefined();
  });

  it('a reply with no thread row counts as unread', async () => {
    const s = await setup();
    const root = await send(s.channel, s.admin);
    const reply = await send(s.channel, s.admin, { parentId: root.id });
    expect((await unread(s.a.id, reply.id))?.parentId).toBe(root.id);
  });

  it('own messages are never returned', async () => {
    const s = await setup();
    const m = await send(s.channel, s.a);
    expect(await unread(s.a.id, m.id)).toBeUndefined();
  });

  it('a deleted message is not returned', async () => {
    const s = await setup();
    const m = await send(s.channel, s.admin);
    const row = (await getMessage(deps.db, m.id))!;
    await deleteMessage(deps, { message: row, channel: s.channel });
    expect(await unread(s.a.id, m.id)).toBeUndefined();
  });

  it('answers many pairs in one call and ignores unknown ids', async () => {
    const s = await setup();
    const m1 = await send(s.channel, s.admin);
    const m2 = await send(s.channel, s.a);
    const result = await unreadForNotify(deps.db, [
      { userId: s.a.id, messageId: m1.id },
      { userId: s.admin.id, messageId: m2.id },
      { userId: s.a.id, messageId: m2.id },
      { userId: s.a.id, messageId: randomUUID() },
    ]);
    expect([...result.keys()].sort()).toEqual(
      [`${s.a.id}:${m1.id}`, `${s.admin.id}:${m2.id}`].sort(),
    );
    expect(await unreadForNotify(deps.db, [])).toEqual(new Map());
  });
});
