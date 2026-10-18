import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { GroupMode } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, getNotificationProfiles } from '../users/service.js';
import { groupModeSql } from './follows.js';
import { getEffectiveModes, setDefaultMode, setGroupMode } from './modes.js';

const { db, close } = createDb(testConfig().databaseUrl);
afterAll(close);

const email = () => `${randomUUID()}@example.com`;

async function sqlMode(userId: string, groupId: string): Promise<GroupMode> {
  const rows = await db.execute<{ mode: GroupMode }>(
    sql`select ${groupModeSql(userId, sql`${groupId}`)} as mode`,
  );
  return rows[0]!.mode;
}

/**
 * `groupModeSql` (dashboard and unseen) must give the same answer as `effectiveGroupMode`
 * (delivery, through `getEffectiveModes`), or the dashboard hides what a push announced.
 */
describe('groupModeSql agrees with effectiveGroupMode', () => {
  it('in the admin group, a client group, with and without defaults and overrides', async () => {
    const adminGroup = await ensureAdminGroup(db);
    const client = await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const plain = await addAdmin(db, { email: email(), name: 'A' });
    const quiet = await addAdmin(db, { email: email(), name: 'B' });
    await setDefaultMode(db, quiet.id, 'off');
    const overridden = await addAdmin(db, { email: email(), name: 'C' });
    await setGroupMode(db, overridden.id, adminGroup, 'mentions');
    const customer = await createUnverifiedClient(db, email());

    const users = [plain.id, quiet.id, overridden.id, customer.id];
    const pairs = users.flatMap((userId) => [
      { userId, groupId: adminGroup },
      { userId, groupId: client.id },
    ]);
    const expected = await getEffectiveModes(db, pairs, await getNotificationProfiles(db, users));
    for (const { userId, groupId } of pairs) {
      expect(await sqlMode(userId, groupId), `${userId}:${groupId}`).toBe(
        expected.get(`${userId}:${groupId}`),
      );
    }
    expect(await sqlMode(plain.id, adminGroup)).toBe('all');
  });
});
