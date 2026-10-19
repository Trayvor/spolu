import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { mentionToken } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { insertTask } from '../../../test/tasks.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { tickets } from '../tickets/schema.js';
import { makeAdmin, makeClient, makeGroup } from '../weekly-summary/test-fixtures.js';
import { messages } from './schema.js';
import { ensureGroupChannel, ensureTaskChannel, ensureTicketChannel } from './service.js';
import { clientVisibleMessagesOf } from './weekly-facts.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const HOUR = 3_600_000;
let seq = 0;

async function post(channelId: string, authorId: string, body: string, at: Date, deleted = false) {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    channelId,
    authorId,
    body,
    clientId: id,
    changeSeq: ++seq,
    createdAt: at,
    deletedAt: deleted ? at : null,
  });
  return id;
}

describe('chat: weekly summary messages', () => {
  it("clientVisibleMessagesOf reads the group chat and the group's task chats only", async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const client = await makeClient(db, g.id, { name: 'Jana Klientka' });
    const a = await makeAdmin(db);
    const taskId = await insertTask(db, { groupId: g.id, createdBy: a.id });
    const chat = await ensureGroupChannel(db, g.id);
    const taskChat = await ensureTaskChannel(db, { id: taskId, groupId: g.id });
    const ticketId = randomUUID();
    const at = new Date();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: g.id,
      source: 'manual',
      createdAt: at,
      updatedAt: at,
    });
    const ticketChat = await ensureTicketChannel(db, { id: ticketId, groupId: g.id });
    const otherChat = await ensureGroupChannel(db, other.id);
    const to = new Date(Date.now() + HOUR);
    const from = new Date(Date.now() - 24 * HOUR);
    await post(chat.id, client.id, 'Hello group', new Date(Date.now() - 3 * HOUR));
    await post(taskChat.id, a.id, 'Task note', new Date(Date.now() - 2 * HOUR));
    await post(ticketChat.id, client.id, 'Secret ticket', new Date(Date.now() - HOUR));
    await post(chat.id, client.id, 'Deleted', new Date(Date.now() - HOUR), true);
    await post(otherChat.id, client.id, 'Other group', new Date(Date.now() - HOUR));
    await post(chat.id, client.id, 'Too old', new Date(Date.now() - 48 * HOUR));
    const rows = await clientVisibleMessagesOf(db, g.id, from, to);
    expect(rows.map((r) => [r.author, r.text, r.taskId])).toEqual([
      ['Jana Klientka', 'Hello group', null],
      ['Jana Manažérka', 'Task note', taskId],
    ]);
  });

  it('clientVisibleMessagesOf cuts each text to 500 characters and the total to 40 000', async () => {
    const g = await makeGroup(db);
    const client = await makeClient(db, g.id);
    const chat = await ensureGroupChannel(db, g.id);
    for (let i = 0; i < 100; i++) {
      await post(
        chat.id,
        client.id,
        `${i}`.padEnd(900, 'x'),
        new Date(Date.now() - (i + 1) * 60_000),
      );
    }
    const rows = await clientVisibleMessagesOf(
      db,
      g.id,
      new Date(Date.now() - 24 * HOUR),
      new Date(Date.now() + HOUR),
    );
    expect(rows.every((r) => r.text.length <= 500)).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.text.length, 0)).toBeLessThanOrEqual(40_000);
    expect(rows).toHaveLength(80);
    // the newest are kept, oldest first
    expect(rows.at(-1)!.text.startsWith('0x')).toBe(true);
  });

  it('clientVisibleMessagesOf writes @? for a mentioned person who is no person of the group', async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const client = await makeClient(db, g.id, { name: 'Jana Klientka' });
    const stranger = await makeClient(db, other.id, { name: 'Cudzí Človek' });
    const chat = await ensureGroupChannel(db, g.id);
    await post(
      chat.id,
      client.id,
      `Hi ${mentionToken(client.id)} and ${mentionToken(stranger.id)}`,
      new Date(Date.now() - HOUR),
    );
    const rows = await clientVisibleMessagesOf(
      db,
      g.id,
      new Date(Date.now() - 24 * HOUR),
      new Date(Date.now() + HOUR),
    );
    expect(rows.map((r) => r.text)).toEqual(['Hi @Jana Klientka and @?']);
  });
});
