import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { financeTimeEntries } from './schema.js';
import { weekMinutesByUser } from './workload-time.js';

/** 2026-10-19: the admin workload card's "This week" column, for finance holders. */
const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(async () => {
  await close();
  await counting.close();
});

const range = { from: '2026-10-19', until: '2026-10-26' };

const newAdmin = async (name: string) =>
  (await addAdmin(db, { email: `${randomUUID()}@example.com`, name })).id;

const newGroup = async () =>
  (
    await createGroup(db, {
      name: 'Workload time',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    })
  ).id;

async function entry(input: {
  userId: string;
  groupId: string | null;
  minutes: number | null;
  workedOn: string | null;
  source?: 'manual' | 'ticket';
}) {
  const source = input.source ?? 'manual';
  await db.insert(financeTimeEntries).values({
    id: randomUUID(),
    groupId: input.groupId,
    userId: input.userId,
    source,
    title: source === 'manual' ? null : 'Ticket',
    minutes: input.minutes,
    workedOn: input.workedOn,
    createdBy: input.userId,
    updatedBy: input.userId,
  });
}

describe('weekMinutesByUser', () => {
  it('sums the filled minutes of the week per user, outside the week and open requests not', async () => {
    const [a, b, c] = await Promise.all([newAdmin('A'), newAdmin('B'), newAdmin('C')]);
    const group = await newGroup();
    await entry({ userId: a, groupId: group, minutes: 30, workedOn: '2026-10-19' });
    await entry({ userId: a, groupId: group, minutes: 60, workedOn: '2026-10-25' });
    await entry({ userId: b, groupId: group, minutes: 15, workedOn: '2026-10-21' });
    // Outside: on `until` (exclusive) and the day before `from`.
    await entry({ userId: a, groupId: group, minutes: 45, workedOn: '2026-10-26' });
    await entry({ userId: a, groupId: group, minutes: 20, workedOn: '2026-10-18' });
    // An open request (a ticket entry without minutes).
    await entry({ userId: a, groupId: group, minutes: null, workedOn: null, source: 'ticket' });
    // Not asked for.
    await entry({ userId: c, groupId: group, minutes: 50, workedOn: '2026-10-20' });

    const minutes = await weekMinutesByUser(db, [a, b], range);
    expect(Object.fromEntries(minutes)).toEqual({ [a]: 90, [b]: 15 });
  });

  it('counts time without a client', async () => {
    const a = await newAdmin('A');
    await entry({ userId: a, groupId: null, minutes: 25, workedOn: '2026-10-22' });
    expect((await weekMinutesByUser(db, [a], range)).get(a)).toBe(25);
  });

  it('answers an empty map for no users without a query', async () => {
    counting.reset();
    expect((await weekMinutesByUser(counting.db, [], range)).size).toBe(0);
    expect(counting.count()).toBe(0);
  });
});
