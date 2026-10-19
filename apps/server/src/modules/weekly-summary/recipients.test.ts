import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { removeMembership } from '../groups/memberships.js';
import { weeklySummaryUnsubscribes } from './schema.js';
import { currentRecipients } from './recipients.js';
import { makeClient, makeGroup, makeManager } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(async () => {
  await close();
  await counting.close();
});

describe('weekly summary recipients', () => {
  it('recipients exclude removed, disabled, unverified, unsubscribed and requesters', async () => {
    const g = await makeGroup(db);
    const valid = await makeClient(db, g.id, { name: 'Platný Klient', language: 'it' });
    const removed = await makeClient(db, g.id);
    await removeMembership(db, g.id, removed.id);
    await makeClient(db, g.id, { disabled: true });
    await makeClient(db, g.id, { verified: false });
    const unsubscribed = await makeClient(db, g.id);
    await db.insert(weeklySummaryUnsubscribes).values({ userId: unsubscribed.id, groupId: g.id });
    await makeClient(db, g.id, { role: 'ziadatel' });
    expect(await currentRecipients(db, g.id)).toEqual([
      { userId: valid.id, name: 'Platný Klient', email: valid.email, language: 'it' },
    ]);
  });

  it('recipients never include admins or managers', async () => {
    const g = await makeGroup(db);
    await makeManager(db, g.id);
    expect(await currentRecipients(db, g.id)).toEqual([]);
  });

  it('recipients of a group are loaded in at most three queries', async () => {
    const g = await makeGroup(db);
    for (let i = 0; i < 5; i++) await makeClient(db, g.id, { name: `Klient ${i}` });
    await currentRecipients(counting.db, g.id); // warms the connections up
    counting.reset();
    const list = await currentRecipients(counting.db, g.id);
    expect(list).toHaveLength(5);
    expect(counting.count()).toBeLessThanOrEqual(3);
  });
});
