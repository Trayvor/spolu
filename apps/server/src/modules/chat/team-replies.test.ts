import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { teamRepliesOfTickets } from './messages.js';
import { messages } from './schema.js';
import { ensureTicketChannel } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(() => Promise.all([close(), counting.close()]));

async function setup() {
  const group = await createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://r${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
  const clientId = randomUUID();
  await db.insert(user).values({
    id: clientId,
    email: `${randomUUID()}@example.com`,
    name: 'Cleo',
    role: 'client',
    emailVerified: true,
  });
  return { group, adminId: admin.id, clientId };
}

async function ticketWithChat(groupId: string) {
  const id = randomUUID();
  const now = new Date();
  await db
    .insert(tickets)
    .values({ id, groupId, status: 'resolved', source: 'manual', createdAt: now, updatedAt: now });
  const channel = await ensureTicketChannel(db, { id, groupId });
  return { id, channelId: channel.id };
}

let seq = 0;
async function say(channelId: string, authorId: string, body: string, deleted = false) {
  seq++;
  await db.insert(messages).values({
    id: randomUUID(),
    channelId,
    authorId,
    body,
    clientId: randomUUID(),
    changeSeq: seq,
    createdAt: new Date(Date.now() + seq * 1000),
    deletedAt: deleted ? new Date() : null,
  });
}

describe('teamRepliesOfTickets', () => {
  it("returns only admins' non-deleted messages, the newest 5 per ticket, oldest first", async () => {
    const { group, adminId, clientId } = await setup();
    const t = await ticketWithChat(group.id);
    await say(t.channelId, clientId, 'Otázka klienta');
    await say(t.channelId, adminId, 'Zmazaná', true);
    for (let i = 1; i <= 7; i++) await say(t.channelId, adminId, `Odpoveď ${i}`);
    const replies = await teamRepliesOfTickets(db, [t.id], 5);
    expect(replies.get(t.id)).toEqual([
      'Odpoveď 3',
      'Odpoveď 4',
      'Odpoveď 5',
      'Odpoveď 6',
      'Odpoveď 7',
    ]);
  });

  it('reads three tickets in one query', async () => {
    const { group, adminId } = await setup();
    const all = [];
    for (let i = 0; i < 3; i++) {
      const t = await ticketWithChat(group.id);
      await say(t.channelId, adminId, `Pre ${i}`);
      all.push(t.id);
    }
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    const replies = await teamRepliesOfTickets(counting.db, all, 5);
    expect(counting.count()).toBe(1);
    expect(all.map((id) => replies.get(id))).toEqual([['Pre 0'], ['Pre 1'], ['Pre 2']]);
  });

  it('runs no query for no tickets', async () => {
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    expect((await teamRepliesOfTickets(counting.db, [], 5)).size).toBe(0);
    expect(counting.count()).toBe(0);
  });
});
