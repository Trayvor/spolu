import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { mentionToken, type SendMessageInput, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import * as filesService from '../files/service.js';
import { createFile, getFile, getFilesForGroup, InvalidAttachmentError } from '../files/service.js';
import { addMember, createGroup, listGroupPeople } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { selectMessages, toMessageDtos } from './dto.js';
import {
  deleteMessage,
  editMessage,
  EmptyMessageError,
  getMessage,
  InvalidMentionError,
  InvalidThreadError,
  MessageDeletedError,
  sendMessage,
} from './messages.js';
import { files } from '../files/schema.js';
import { messageAttachments, messageMentions, messages } from './schema.js';
import { ensureGroupChannel, getChannel, type ChannelRow } from './service.js';

vi.mock('../files/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../files/service.js')>();
  return { ...actual, deleteFiles: vi.fn(actual.deleteFiles) };
});

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

const asSession = (row: { id: string; email: string; name: string; role: string }) =>
  ({ id: row.id, email: row.email, name: row.name, role: row.role }) as SessionUser;

async function newClient(groupId: string, name = 'Client') {
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
  const a = await newClient(group.id, 'Anna');
  const b = await newClient(group.id, 'Boris');
  return { group, channel, admin: asSession({ ...admin, role: 'admin' }), a, b };
}

const send = (channel: ChannelRow, author: SessionUser, data: Partial<SendMessageInput> = {}) =>
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

const messageCount = async (channelId: string) =>
  (await deps.db.select().from(messages).where(eq(messages.channelId, channelId))).length;

async function eventsFor(messageId: string) {
  return deps.db
    .select({ userId: notificationEvents.userId, kind: notificationEvents.kind })
    .from(notificationEvents)
    .where(sql`${notificationEvents.payload}->>'messageId' = ${messageId}`);
}

const recipientsOf = (events: { userId: string; kind: string }[], kind: string) =>
  new Set(events.filter((e) => e.kind === kind).map((e) => e.userId));

describe('sendMessage', () => {
  it('sends a top-level message with change_seq = channel last_seq', async () => {
    const s = await setup();
    await send(s.channel, s.a);
    const { message, parent, created } = await send(s.channel, s.b, { body: 'second' });
    expect(created).toBe(true);
    expect(parent).toBeNull();
    const channel = await getChannel(deps.db, s.channel.id);
    expect(message.changeSeq).toBe(channel!.lastSeq);
    expect(message.changeSeq).toBe(2);
    expect(message).toMatchObject({
      channelId: s.channel.id,
      parentId: null,
      replyToId: null,
      body: 'second',
      author: { id: s.b.id, name: 'Boris', isAdmin: false },
      mentions: [],
      mentionsAll: false,
      attachments: [],
      replyCount: 0,
    });
  });

  it('stores mentions and mentions_all', async () => {
    const s = await setup();
    const body = `hi ${mentionToken(s.b.id)} and ${mentionToken(s.admin.id)} ${mentionToken('all')} \`${mentionToken(s.a.id)}\``;
    const { message } = await send(s.channel, s.a, { body });
    expect(message.mentionsAll).toBe(true);
    expect(new Set(message.mentions)).toEqual(new Set([s.b.id, s.admin.id]));
    const stored = await deps.db
      .select()
      .from(messageMentions)
      .where(eq(messageMentions.messageId, message.id));
    expect(new Set(stored.map((m) => m.userId))).toEqual(new Set([s.b.id, s.admin.id]));
    const [row] = await deps.db.select().from(messages).where(eq(messages.id, message.id));
    expect(row!.mentionsAll).toBe(true);
  });

  it("a mention of another group's client → InvalidMentionError and nothing written", async () => {
    const s = await setup();
    const other = await setup();
    const before = (await getChannel(deps.db, s.channel.id))!.lastSeq;
    await expect(
      send(s.channel, s.a, { body: `hi ${mentionToken(other.a.id)}` }),
    ).rejects.toBeInstanceOf(InvalidMentionError);
    await expect(
      send(s.channel, s.a, { body: `hi ${mentionToken(randomUUID())}` }),
    ).rejects.toBeInstanceOf(InvalidMentionError);
    expect(await messageCount(s.channel.id)).toBe(0);
    expect((await getChannel(deps.db, s.channel.id))!.lastSeq).toBe(before);
  });

  it('attaches files in order and returns FileInfo', async () => {
    const s = await setup();
    const f1 = await upload(s.group.id, s.a.id, 'one.txt');
    const f2 = await upload(s.group.id, s.a.id, 'two.txt');
    const f3 = await upload(s.group.id, s.a.id, 'three.txt');
    const { message } = await send(s.channel, s.a, { body: '', fileIds: [f3.id, f1.id, f2.id] });
    expect(message.attachments).toEqual([f3, f1, f2]);
  });

  it('a file of another group → invalid_attachment and nothing written (no message row)', async () => {
    const s = await setup();
    const other = await setup();
    const mine = await upload(s.group.id, s.a.id, 'mine.txt');
    const foreign = await upload(other.group.id, s.a.id, 'foreign.txt');
    const before = (await getChannel(deps.db, s.channel.id))!.lastSeq;
    await expect(send(s.channel, s.a, { fileIds: [mine.id, foreign.id] })).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    expect(await messageCount(s.channel.id)).toBe(0);
    expect((await getChannel(deps.db, s.channel.id))!.lastSeq).toBe(before);
    // The rollback left `mine` unattached, so it can still be sent.
    const { message } = await send(s.channel, s.a, { fileIds: [mine.id] });
    expect(message.attachments.map((f) => f.id)).toEqual([mine.id]);
  });

  it('a file uploaded by another member of the group → invalid_attachment', async () => {
    const s = await setup();
    const hers = await upload(s.group.id, s.b.id, 'hers.txt');
    await expect(send(s.channel, s.a, { fileIds: [hers.id] })).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
    expect(await messageCount(s.channel.id)).toBe(0);
  });

  it("a reply bumps the parent's reply_count, last_reply_at and change_seq to the reply's seq", async () => {
    const s = await setup();
    const { message: root } = await send(s.channel, s.a);
    const first = await send(s.channel, s.b, { parentId: root.id });
    expect(first.parent).toMatchObject({ id: root.id, replyCount: 1 });
    const { message: reply, parent } = await send(s.channel, s.admin, {
      parentId: root.id,
      replyToId: first.message.id,
    });
    expect(reply).toMatchObject({ parentId: root.id, replyToId: first.message.id });
    expect(parent).toMatchObject({
      id: root.id,
      replyCount: 2,
      lastReplyAt: reply.createdAt,
      changeSeq: reply.changeSeq,
    });
    const [stored] = await deps.db.select().from(messages).where(eq(messages.id, root.id));
    expect(stored).toMatchObject({ replyCount: 2, changeSeq: reply.changeSeq });
    expect(stored!.lastReplyAt?.toISOString()).toBe(reply.createdAt);
    // A reply to the root itself is allowed too.
    await expect(
      send(s.channel, s.a, { parentId: root.id, replyToId: root.id }),
    ).resolves.toMatchObject({ created: true });
  });

  it('parentId that is itself a reply → InvalidThreadError', async () => {
    const s = await setup();
    const other = await setup();
    const { message: root } = await send(s.channel, s.a);
    const { message: reply } = await send(s.channel, s.b, { parentId: root.id });
    const { message: foreignRoot } = await send(other.channel, other.a);
    for (const parentId of [reply.id, foreignRoot.id, randomUUID()]) {
      await expect(send(s.channel, s.a, { parentId })).rejects.toBeInstanceOf(InvalidThreadError);
    }
  });

  it('replyToId from another thread → InvalidThreadError', async () => {
    const s = await setup();
    const { message: root1 } = await send(s.channel, s.a);
    const { message: root2 } = await send(s.channel, s.a);
    const { message: inThread2 } = await send(s.channel, s.b, { parentId: root2.id });
    for (const replyToId of [inThread2.id, root2.id, randomUUID()]) {
      await expect(send(s.channel, s.a, { parentId: root1.id, replyToId })).rejects.toBeInstanceOf(
        InvalidThreadError,
      );
    }
  });

  it('repeated clientId returns the existing message, created false, and records nothing', async () => {
    const s = await setup();
    const clientId = randomUUID();
    const first = await send(s.channel, s.a, { body: 'once', clientId });
    const eventsAfterFirst = (await eventsFor(first.message.id)).length;
    const again = await send(s.channel, s.a, { body: 'twice', clientId });
    expect(again.created).toBe(false);
    expect(again.message).toEqual(first.message);
    expect(await messageCount(s.channel.id)).toBe(1);
    expect((await getChannel(deps.db, s.channel.id))!.lastSeq).toBe(first.message.changeSeq);
    expect((await eventsFor(first.message.id)).length).toBe(eventsAfterFirst);
    // Two racing sends with one clientId: one message.
    const racing = randomUUID();
    const results = await Promise.all([
      send(s.channel, s.b, { clientId: racing }),
      send(s.channel, s.b, { clientId: racing }),
    ]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0]!.message.id).toBe(results[1]!.message.id);
  });

  it('notification events: chat.message to all people except the author, chat.mention to the mentioned, @all to everyone but the author, chat.thread_reply to root author and earlier repliers', async () => {
    const s = await setup();
    const c = await newClient(s.group.id, 'Cyril');
    const peopleBefore = new Set((await listGroupPeople(deps.db, s.group.id)).map((p) => p.id));

    const { message: root } = await send(s.channel, s.a, {
      body: `look ${mentionToken(s.b.id)} ${mentionToken(s.a.id)}`,
    });
    const peopleAfter = new Set((await listGroupPeople(deps.db, s.group.id)).map((p) => p.id));
    const rootEvents = await eventsFor(root.id);
    const toAll = recipientsOf(rootEvents, 'chat.message');
    expect(toAll.has(s.a.id)).toBe(false);
    // Admins are global and other suites add and deactivate them in parallel: only people present
    // before and after the send must get it, and no one outside both snapshots may.
    for (const id of peopleBefore)
      if (id !== s.a.id && peopleAfter.has(id)) expect(toAll.has(id)).toBe(true);
    for (const id of toAll) expect(peopleBefore.has(id) || peopleAfter.has(id)).toBe(true);
    expect(recipientsOf(rootEvents, 'chat.mention')).toEqual(new Set([s.b.id]));
    expect(recipientsOf(rootEvents, 'chat.thread_reply').size).toBe(0);

    const { message: everyone } = await send(s.channel, s.b, { body: `${mentionToken('all')}!` });
    const allMentioned = recipientsOf(await eventsFor(everyone.id), 'chat.mention');
    expect(allMentioned.has(s.b.id)).toBe(false);
    for (const id of [s.a.id, c.id, s.admin.id]) expect(allMentioned.has(id)).toBe(true);

    await send(s.channel, s.b, { parentId: root.id });
    await send(s.channel, s.admin, { parentId: root.id });
    const { message: reply } = await send(s.channel, s.b, {
      parentId: root.id,
      body: `thanks ${mentionToken(c.id)}`,
    });
    const replyEvents = await eventsFor(reply.id);
    expect(recipientsOf(replyEvents, 'chat.thread_reply')).toEqual(new Set([s.a.id, s.admin.id]));
    expect(recipientsOf(replyEvents, 'chat.mention')).toEqual(new Set([c.id]));
    expect(recipientsOf(replyEvents, 'chat.message').size).toBe(0);

    const [event] = await deps.db
      .select({ payload: notificationEvents.payload, groupId: notificationEvents.groupId })
      .from(notificationEvents)
      .where(sql`${notificationEvents.payload}->>'messageId' = ${reply.id}`)
      .limit(1);
    expect(event).toEqual({
      groupId: s.group.id,
      payload: {
        channelId: s.channel.id,
        messageId: reply.id,
        groupId: s.group.id,
        authorName: 'Boris',
        excerpt: 'thanks @Cyril',
      },
    });
  });
});

describe('sendMessage notifications for replies', () => {
  it('a mention inside a reply records chat.mention, and no chat.message', async () => {
    const s = await setup();
    const { message: root } = await send(s.channel, s.a);
    const { message: reply } = await send(s.channel, s.b, {
      parentId: root.id,
      body: `see ${mentionToken(s.admin.id)}`,
    });
    const events = await eventsFor(reply.id);
    expect(recipientsOf(events, 'chat.mention')).toEqual(new Set([s.admin.id]));
    expect(recipientsOf(events, 'chat.message').size).toBe(0);
    expect(recipientsOf(events, 'chat.thread_reply')).toEqual(new Set([s.a.id]));
  });

  it("a repeated clientId from another group's chat keeps that message's attachments", async () => {
    const s = await setup();
    const other = await setup();
    const otherChannel = await ensureGroupChannel(deps.db, other.group.id);
    const file = await upload(other.group.id, other.admin.id, 'kept.txt');
    const clientId = randomUUID();
    const first = await send(otherChannel, other.admin, { clientId, fileIds: [file.id] });
    const again = await send(s.channel, other.admin, { clientId });
    expect(again.created).toBe(false);
    expect(again.message.attachments.map((f) => f.id)).toEqual([file.id]);
    expect(again.message).toEqual(first.message);
  });
});

describe('toMessageDtos', () => {
  it('runs a fixed number of queries for 50 messages', async () => {
    const s = await setup();
    // Bulk rows: 50 messages, each with one mention and one attached file.
    const ids = Array.from({ length: 50 }, () => randomUUID());
    const fileIds = Array.from({ length: 50 }, () => randomUUID());
    await deps.db.insert(files).values(
      fileIds.map((id, i) => ({
        id,
        groupId: s.group.id,
        uploadedBy: s.a.id,
        name: `f${i}.txt`,
        mime: 'text/plain',
        size: 1,
        storageKey: `files/${s.group.id}/${id}`,
        attachedAt: new Date(),
      })),
    );
    await deps.db.insert(messages).values(
      ids.map((id, i) => ({
        id,
        channelId: s.channel.id,
        authorId: s.a.id,
        body: `${i} ${mentionToken(s.b.id)}`,
        clientId: randomUUID(),
        changeSeq: i + 1,
        createdAt: new Date(Date.UTC(2026, 2, 1, 10, 0, 0, i)),
      })),
    );
    await deps.db
      .insert(messageMentions)
      .values(ids.map((messageId) => ({ messageId, userId: s.b.id })));
    await deps.db
      .insert(messageAttachments)
      .values(ids.map((messageId, i) => ({ messageId, fileId: fileIds[i]!, position: 0 })));
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      const where = eq(messages.channelId, s.channel.id);
      const rows = await selectMessages(counted, where, [asc(messages.createdAt)]);
      expect(rows).toHaveLength(50);
      statements = 0;
      const dtos = await toMessageDtos(counted, s.group.id, rows);
      const forFifty = statements;
      expect(dtos.every((d) => d.attachments.length === 1 && d.mentions[0] === s.b.id)).toBe(true);
      statements = 0;
      await toMessageDtos(counted, s.group.id, rows.slice(0, 1));
      expect(forFifty).toBe(statements);
      expect(forFifty).toBe(3);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('a deleted message has an empty body, no mentions and no attachments', async () => {
    const s = await setup();
    const file = await upload(s.group.id, s.a.id, 'x.txt');
    const { message } = await send(s.channel, s.a, {
      body: `bye ${mentionToken(s.b.id)} ${mentionToken('all')}`,
      fileIds: [file.id],
    });
    await deps.db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(eq(messages.id, message.id));
    const rows = await selectMessages(deps.db, inArray(messages.id, [message.id]), []);
    const [dto] = await toMessageDtos(deps.db, s.group.id, rows);
    expect(dto).toMatchObject({ body: '', mentions: [], mentionsAll: false, attachments: [] });
    expect(dto!.deletedAt).not.toBeNull();
  });
});

describe('editMessage and deleteMessage', () => {
  const load = async (id: string) => (await getMessage(deps.db, id))!;

  it('edit re-parses mentions (old mention gone, new one stored) and sets edited_at and a higher change_seq', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.a, { body: `hi ${mentionToken(s.b.id)}` });
    const eventsBefore = await eventsFor(message.id);
    const dto = await editMessage(deps, {
      message: await load(message.id),
      channel: s.channel,
      body: `hi ${mentionToken(s.admin.id)} ${mentionToken('all')}`,
    });
    expect(dto.mentions).toEqual([s.admin.id]);
    expect(dto.mentionsAll).toBe(true);
    expect(dto.editedAt).not.toBeNull();
    expect(dto.changeSeq).toBeGreaterThan(message.changeSeq);
    expect((await eventsFor(message.id)).length).toBe(eventsBefore.length);
  });

  it('edit with a foreign mention → InvalidMentionError, nothing changed', async () => {
    const s = await setup();
    const other = await setup();
    const { message } = await send(s.channel, s.a, { body: 'plain' });
    await expect(
      editMessage(deps, {
        message: await load(message.id),
        channel: s.channel,
        body: `x ${mentionToken(other.a.id)}`,
      }),
    ).rejects.toBeInstanceOf(InvalidMentionError);
    const after = await load(message.id);
    expect(after.body).toBe('plain');
    expect(after.editedAt).toBeNull();
    expect(after.changeSeq).toBe(message.changeSeq);
  });

  it('edit keeps a mention already stored on the message even if that person left the group', async () => {
    const s = await setup();
    const gone = await setup();
    const { message } = await send(s.channel, s.a, { body: 'plain' });
    // The stored mention of someone who is no longer one of the group's people.
    await deps.db.insert(messageMentions).values({ messageId: message.id, userId: gone.a.id });
    const dto = await editMessage(deps, {
      message: await load(message.id),
      channel: s.channel,
      body: `hi ${mentionToken(gone.a.id)}`,
    });
    expect(dto.mentions).toEqual([gone.a.id]);
    // A new foreign mention is still refused.
    await expect(
      editMessage(deps, {
        message: await load(message.id),
        channel: s.channel,
        body: `hi ${mentionToken(gone.a.id)} ${mentionToken(gone.b.id)}`,
      }),
    ).rejects.toBeInstanceOf(InvalidMentionError);
  });

  it('edit to an empty body is allowed only with attachments', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.a, { body: 'text' });
    await expect(
      editMessage(deps, { message: await load(message.id), channel: s.channel, body: '  ' }),
    ).rejects.toBeInstanceOf(EmptyMessageError);
    const file = await upload(s.group.id, s.a.id, 'a.txt');
    const withFile = await send(s.channel, s.a, { body: '', fileIds: [file.id] });
    const dto = await editMessage(deps, {
      message: await load(withFile.message.id),
      channel: s.channel,
      body: '',
    });
    expect(dto.body).toBe('');
    expect(dto.attachments).toHaveLength(1);
  });

  it('delete keeps the row as deleted, clears body and mentions, keeps replies', async () => {
    const s = await setup();
    const { message: root } = await send(s.channel, s.a, { body: `hi ${mentionToken(s.b.id)}` });
    const { message: reply } = await send(s.channel, s.b, { parentId: root.id });
    const dto = await deleteMessage(deps, { message: await load(root.id), channel: s.channel });
    expect(dto).toMatchObject({ body: '', mentions: [], mentionsAll: false, replyCount: 1 });
    expect(dto.deletedAt).not.toBeNull();
    expect(dto.changeSeq).toBeGreaterThan(root.changeSeq);
    const stored = await deps.db
      .select()
      .from(messageMentions)
      .where(eq(messageMentions.messageId, root.id));
    expect(stored).toHaveLength(0);
    expect((await load(reply.id)).deletedAt).toBeNull();
  });

  it("delete removes the message's files (getFilesForGroup returns none and storage objects are gone)", async () => {
    const s = await setup();
    const file = await upload(s.group.id, s.a.id, 'gone.txt');
    const [row] = await deps.db.execute<{ storage_key: string }>(
      sql`select storage_key from files where id = ${file.id}`,
    );
    const { message } = await send(s.channel, s.a, { body: '', fileIds: [file.id] });
    const dto = await deleteMessage(deps, { message: await load(message.id), channel: s.channel });
    expect(dto.attachments).toEqual([]);
    expect(await getFilesForGroup(deps.db, s.group.id, [file.id])).toEqual([]);
    expect(await deps.storage.exists(row!.storage_key)).toBe(false);
  });

  it("deleting a reply leaves the root's reply_count unchanged", async () => {
    const s = await setup();
    const { message: root } = await send(s.channel, s.a);
    const { message: reply } = await send(s.channel, s.b, { parentId: root.id });
    await deleteMessage(deps, { message: await load(reply.id), channel: s.channel });
    expect((await load(root.id)).replyCount).toBe(1);
  });

  it('a failing post-commit file removal does not fail the delete and leaves the files unattached', async () => {
    const s = await setup();
    const file = await upload(s.group.id, s.a.id, 'left.txt');
    const { message } = await send(s.channel, s.a, { body: '', fileIds: [file.id] });
    vi.mocked(filesService.deleteFiles).mockRejectedValueOnce(new Error('db down'));
    const onFileCleanupError = vi.fn();
    const dto = await deleteMessage(deps, {
      message: await load(message.id),
      channel: s.channel,
      onFileCleanupError,
    });
    expect(dto.deletedAt).not.toBeNull();
    expect(onFileCleanupError).toHaveBeenCalledOnce();
    expect((await getFile(deps.db, file.id))?.attachedAt).toBeNull();
  });

  it('editing a message deleted in between → MessageDeletedError and the text stays cleared', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.a, { body: 'secret' });
    const stale = await load(message.id);
    await deleteMessage(deps, { message: stale, channel: s.channel });
    await expect(
      editMessage(deps, { message: stale, channel: s.channel, body: 'back again' }),
    ).rejects.toBeInstanceOf(MessageDeletedError);
    expect((await load(message.id)).body).toBe('');
  });

  it('deleting twice is a no-op', async () => {
    const s = await setup();
    const { message } = await send(s.channel, s.a);
    const first = await deleteMessage(deps, {
      message: await load(message.id),
      channel: s.channel,
    });
    const second = await deleteMessage(deps, {
      message: await load(message.id),
      channel: s.channel,
    });
    expect(second.changeSeq).toBe(first.changeSeq);
  });
});
