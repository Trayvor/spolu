import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { user } from '../users/schema.js';
import { addMembership } from './memberships.js';
import { createGroup, peopleNamesOfGroups } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(() => Promise.all([close(), counting.close()]));

async function person(groupId: string, name: string, role: 'client' | 'ziadatel') {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    email: `${randomUUID()}@example.com`,
    name,
    role: 'client',
    emailVerified: true,
  });
  await addMembership(db, id, groupId, role);
}
const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://p${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });

describe('peopleNamesOfGroups', () => {
  it('names the people of each group in one query', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    await person(a.id, 'Ján Novák', 'client');
    await person(a.id, 'Eva Malá', 'ziadatel');
    await person(b.id, 'Peter Veľký', 'client');
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    const names = await peopleNamesOfGroups(counting.db, [a.id, b.id]);
    expect(counting.count()).toBe(1);
    expect([...(names.get(a.id) ?? [])].sort()).toEqual(['Eva Malá', 'Ján Novák']);
    expect(names.get(b.id)).toEqual(['Peter Veľký']);
  });
});
