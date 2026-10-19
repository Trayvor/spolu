import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mentionToken, type MessageSearchPage, type SessionUser } from '@spolu/shared';
import { createCountingDb } from '../../../test/query-counter.js';
import { insertTask } from '../../../test/tasks.js';
import { buildTestApp } from '../../../test/test-app.js';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { prepareSearch } from '../../infra/text/search.js';
import {
  addMembership,
  groupAccessOf,
  removeMembership,
  type GroupAccess,
} from '../groups/memberships.js';
import { createGroup, setGroupDeactivated } from '../groups/service.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { messageMentions, messages } from './schema.js';
import {
  decodeMessageCursor,
  encodeMessageCursor,
  searchMessages,
  TOO_BROAD,
  withStatementTimeout,
  type MessageSearchOptions,
} from './search.js';
import { ensureGroupChannel, ensureTaskChannel, ensureTicketChannel } from './service.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

const db = () => deps.db;
const NO_ACCESS: GroupAccess = { roles: new Map() };
/** A word no other test writes. */
const word = () =>
  `zq${Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;

async function person(name: string, role: 'admin' | 'client' = 'client'): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await db().insert(user).values({ id, email, name, role, emailVerified: true });
  return { id, email, name, role, finance: false };
}

async function group(name: string) {
  return createGroup(db(), {
    name,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
}

async function ticket(groupId: string, requesterUserId: string | null) {
  const now = new Date();
  const [row] = await db()
    .insert(tickets)
    .values({
      id: randomUUID(),
      groupId,
      source: 'manual',
      subject: 'Predmet',
      requesterUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tickets.id, number: tickets.number });
  return row!;
}

let seq = 1;
/** A message straight into the table (the column is generated, so no service is needed). */
async function post(
  channelId: string,
  authorId: string,
  body: string,
  opts: { parentId?: string; createdAt?: Date; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await db()
    .insert(messages)
    .values({
      id,
      channelId,
      authorId,
      body: opts.deleted ? '' : body,
      clientId: randomUUID(),
      changeSeq: seq++,
      parentId: opts.parentId ?? null,
      deletedAt: opts.deleted ? new Date() : null,
      createdAt: opts.createdAt ?? new Date(),
    });
  return id;
}

const find = async (
  actor: SessionUser,
  q: string,
  opts: Partial<MessageSearchOptions> = {},
  database: Db = db(),
): Promise<MessageSearchPage> => {
  const access = actor.role === 'client' ? await groupAccessOf(db(), actor.id) : NO_ACCESS;
  return searchMessages(database, actor, access, prepareSearch(q), { limit: 20, ...opts });
};
const ids = (page: MessageSearchPage) => page.hits.map((h) => h.id).sort();

/** Search in chat messages (2026-10-19): what each person finds, labels, rank, pages. */
describe('searchMessages', () => {
  const w = word();
  let admin: SessionUser;
  let clientA: SessionUser;
  let clientB: SessionUser;
  let z: SessionUser;
  let other: SessionUser;
  let removed: SessionUser;
  let a: { id: string };
  let b: { id: string };
  let d: { id: string };
  let taskA: string;
  let t1: { id: string; number: number };
  let t2: { id: string; number: number };
  let m: Record<string, string>;

  beforeAll(async () => {
    admin = await person('Ad Min', 'admin');
    clientA = await person('Klient A');
    clientB = await person('Klient B');
    z = await person('Žiadateľ Z');
    other = await person('Iný O');
    removed = await person('Odišiel R');
    a = await group('A');
    b = await group('B');
    d = await group('D');
    await addMembership(db(), clientA.id, a.id, 'client');
    await addMembership(db(), removed.id, a.id, 'client');
    await addMembership(db(), clientB.id, b.id, 'client');
    await addMembership(db(), z.id, a.id, 'ziadatel');
    await addMembership(db(), other.id, a.id, 'ziadatel');
    await addMembership(db(), clientB.id, d.id, 'client');
    taskA = await insertTask(db(), { groupId: a.id, createdBy: admin.id, title: 'Úloha X' });
    t1 = await ticket(a.id, z.id);
    t2 = await ticket(a.id, other.id);
    const chatA = await ensureGroupChannel(db(), a.id);
    const taskChat = await ensureTaskChannel(db(), { id: taskA, groupId: a.id });
    const t1Chat = await ensureTicketChannel(db(), { id: t1.id, groupId: a.id });
    const t2Chat = await ensureTicketChannel(db(), { id: t2.id, groupId: a.id });
    const chatB = await ensureGroupChannel(db(), b.id);
    const chatD = await ensureGroupChannel(db(), d.id);
    const taskD = await insertTask(db(), { groupId: d.id, createdBy: admin.id, title: 'Úloha D' });
    const taskChatD = await ensureTaskChannel(db(), { id: taskD, groupId: d.id });
    const tD = await ticket(d.id, null);
    const tDChat = await ensureTicketChannel(db(), { id: tD.id, groupId: d.id });
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    const root = await post(chatA.id, clientA.id, `Skupina ${w} koreň`, { createdAt: t(10) });
    m = {
      group: root,
      reply: await post(chatA.id, admin.id, `Odpoveď ${w} vo vlákne`, {
        parentId: root,
        createdAt: t(9),
      }),
      task: await post(taskChat.id, clientA.id, `Úloha ${w} chat`, { createdAt: t(8) }),
      t1: await post(t1Chat.id, z.id, `Tiket ${w} môj ${mentionToken(admin.id)}`, {
        createdAt: t(7),
      }),
      t2: await post(t2Chat.id, other.id, `Tiket ${w} cudzí`, { createdAt: t(6) }),
      b: await post(chatB.id, clientB.id, `Iná ${w} skupina`, { createdAt: t(5) }),
      deleted: await post(chatA.id, clientA.id, `Vymazaná ${w}`, { deleted: true }),
    };
    await db()
      .insert(messageMentions)
      .values({ messageId: m.t1!, userId: admin.id, createdAt: t(7) });
    const rootD = await post(chatD.id, clientB.id, `Zavretá ${w} skupina`);
    m.d = rootD;
    m.dReply = await post(chatD.id, admin.id, `Zavretá ${w} odpoveď`, { parentId: rootD });
    m.dTask = await post(taskChatD.id, admin.id, `Zavretá ${w} úloha`);
    m.dTicket = await post(tDChat.id, admin.id, `Zavretá ${w} tiket`);
    // Seeded before the deactivation: the database refuses new rows in it afterwards.
    await setGroupDeactivated(db(), d.id, true);
  });

  const live = () => [m.group!, m.reply!, m.task!, m.t1!, m.t2!, m.b!].sort();

  it('admin finds every live channel kind and the reply, newest first within a rank', async () => {
    const page = await find(admin, w);
    expect(ids(page)).toEqual(live());
    expect(new Set(page.hits.map((h) => h.channelKind))).toEqual(
      new Set(['group', 'task', 'ticket']),
    );
    expect(page.hits.find((h) => h.id === m.reply)?.parentId).toBe(m.group);
    // Same rank (a word starts with the term): newest first.
    const times = page.hits.map((h) => h.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(page).toMatchObject({ nextCursor: null, tooBroad: false });
  });

  it("client of A finds A's group, task and ticket chats, never B", async () => {
    expect(ids(await find(clientA, w))).toEqual([m.group!, m.reply!, m.task!, m.t1!, m.t2!].sort());
    expect(ids(await find(clientB, w))).toEqual([m.b]);
  });

  it('ziadatel finds only their own ticket chat', async () => {
    const page = await find(z, w);
    expect(page.hits.map((h) => h.ticketId)).toEqual([t1.id]);
    expect(ids(await find(other, w))).toEqual([m.t2]);
  });

  it('nothing of a deactivated group, for admins too', async () => {
    const found = ids(await find(admin, `zavreta ${w}`));
    expect(found).toEqual([]);
    expect(ids(await find(clientB, `zavreta ${w}`))).toEqual([]);
    expect(await find(admin, w, { groupId: d.id })).toEqual({
      hits: [],
      nextCursor: null,
      tooBroad: false,
    });
  });

  it("a reactivated group's messages are found again", async () => {
    await setGroupDeactivated(db(), d.id, false);
    try {
      expect(ids(await find(admin, `zavreta ${w}`))).toEqual(
        [m.d!, m.dReply!, m.dTask!, m.dTicket!].sort(),
      );
    } finally {
      await setGroupDeactivated(db(), d.id, true);
    }
  });

  it('a removed member finds nothing of the group', async () => {
    expect(ids(await find(removed, w)).length).toBeGreaterThan(0);
    await removeMembership(db(), a.id, removed.id);
    expect(await find(removed, w)).toEqual({ hits: [], nextCursor: null, tooBroad: false });
  });

  it('never a deleted message; an edited one by its new text only', async () => {
    expect(ids(await find(admin, `vymazana ${w}`))).toEqual([]);
    const chat = await ensureGroupChannel(db(), b.id);
    const v = word();
    const id = await post(chat.id, clientB.id, `Staré ${v}`);
    await db()
      .update(messages)
      .set({ body: `Nové ${v}`, editedAt: new Date() })
      .where(eq(messages.id, id));
    expect(ids(await find(clientB, `stare ${v}`))).toEqual([]);
    expect(ids(await find(clientB, `nove ${v}`))).toEqual([id]);
  });

  it('labels: task title, ticket number, author name, group name; mentions as names', async () => {
    const page = await find(admin, w);
    const byId = new Map(page.hits.map((h) => [h.id, h]));
    expect(byId.get(m.task!)).toMatchObject({
      channelKind: 'task',
      taskId: taskA,
      taskTitle: 'Úloha X',
      ticketId: null,
      ticketNumber: null,
      authorName: 'Klient A',
      groupId: a.id,
      groupName: 'A',
    });
    expect(byId.get(m.t1!)).toMatchObject({
      channelKind: 'ticket',
      ticketId: t1.id,
      ticketNumber: t1.number,
      taskId: null,
      authorName: 'Žiadateľ Z',
    });
    expect(byId.get(m.t1!)?.snippet).toBe(`Tiket ${w} môj @Ad Min`);
    const hit = byId.get(m.group!)!;
    expect(hit.snippet.slice(...hit.highlights[0]!)).toBe(w);
  });

  it('ranks a word start before a fragment, then newest', async () => {
    const v = word();
    const chat = await ensureGroupChannel(db(), b.id);
    const older = await post(chat.id, clientB.id, `${v}xx na začiatku`, {
      createdAt: new Date(Date.now() - 60_000),
    });
    const newer = await post(chat.id, clientB.id, `pre${v}xx uprostred`);
    const page = await find(clientB, `${v}xx`);
    expect(page.hits.map((h) => h.id)).toEqual([older, newer]);
  });

  it('pages without repeats on equal timestamps', async () => {
    const v = word();
    const chat = await ensureGroupChannel(db(), b.id);
    const at = new Date(Date.now() - 120_000);
    const all: string[] = [];
    for (let i = 0; i < 7; i++)
      all.push(await post(chat.id, clientB.id, `${v} ${i}`, { createdAt: at }));
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const page: MessageSearchPage = await find(clientB, v, {
        limit: 3,
        cursor: cursor === null ? undefined : (decodeMessageCursor(cursor) ?? undefined),
      });
      sizes.push(page.hits.length);
      seen.push(...page.hits.map((h) => h.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(sizes).toEqual([3, 3, 1]);
    expect(new Set(seen).size).toBe(7);
    expect(seen.sort()).toEqual(all.sort());
  });

  it('cursors round-trip; anything malformed is null', () => {
    const c = { rank: 1, createdAt: '2026-10-19T10:00:00.123Z', id: 'm1' };
    expect(decodeMessageCursor(encodeMessageCursor(c))).toEqual(c);
    for (const bad of ['abc', '', encodeMessageCursor({ ...c, rank: 7 }), 'W1sxXV0']) {
      expect(decodeMessageCursor(bad)).toBeNull();
    }
    const raw = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    expect(decodeMessageCursor(raw([0, 'not a date', 'x']))).toBeNull();
    expect(decodeMessageCursor(raw([0, c.createdAt, 5]))).toBeNull();
    expect(decodeMessageCursor(raw({ rank: 0 }))).toBeNull();
  });

  it('treats % and _ as text', async () => {
    const v = word();
    const chat = await ensureGroupChannel(db(), b.id);
    const pct = await post(chat.id, clientB.id, `${v} zľava 50%`);
    await post(chat.id, clientB.id, `${v} zľava 500 eur`);
    const under = await post(chat.id, clientB.id, `${v} súbor a_b`);
    await post(chat.id, clientB.id, `${v} súbor axb`);
    expect(ids(await find(clientB, `${v} 50%`))).toEqual([pct]);
    expect(ids(await find(clientB, `${v} a_b`))).toEqual([under]);
  });

  it('no query without a term of 3 characters', async () => {
    const counting = createCountingDb();
    try {
      const page = await find(admin, 'ab cd', {}, counting.db);
      expect(page).toEqual({ hits: [], nextCursor: null, tooBroad: false });
      expect(counting.count()).toBe(0);
    } finally {
      await counting.close();
    }
  });

  it('groupId narrows; an unread group gives an empty page', async () => {
    expect(ids(await find(admin, w, { groupId: b.id }))).toEqual([m.b]);
    expect(ids(await find(clientA, w, { groupId: a.id }))).toEqual(
      [m.group!, m.reply!, m.task!, m.t1!, m.t2!].sort(),
    );
    expect(await find(clientA, w, { groupId: b.id })).toEqual({
      hits: [],
      nextCursor: null,
      tooBroad: false,
    });
  });

  it('a statement over the timeout resolves to TOO_BROAD', async () => {
    await expect(
      withStatementTimeout(db(), 10, (tx) => tx.execute(sql`select pg_sleep(0.2)`)),
    ).resolves.toBe(TOO_BROAD);
    await expect(withStatementTimeout(db(), 1000, async () => 'ok')).resolves.toBe('ok');
  });

  it('one message search is at most six statements', async () => {
    const counting = createCountingDb();
    try {
      // A warm-up: a new pooled connection reads the array types once (postgres-js).
      await find(admin, w, {}, counting.db);
      counting.reset();
      const page = await find(admin, w, {}, counting.db);
      expect(new Set(page.hits.map((h) => h.channelKind)).size).toBe(3);
      expect(counting.count()).toBeLessThanOrEqual(6);
    } finally {
      await counting.close();
    }
  });
});
