import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addManager } from '../groups/managers.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { managedGroupIdsOf } from './scope.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
const newAdmin = () => addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Admin' });

describe('managedGroupIdsOf', () => {
  it('returns the groups the admin manages (Phase 18)', async () => {
    const [admin, g1, g2] = await Promise.all([newAdmin(), newGroup(), newGroup()]);
    await addManager(db, g1.id, admin.id);
    expect(await managedGroupIdsOf(db, admin.id)).toEqual([g1.id]);
    expect(g2.id).not.toBe(g1.id);
  });

  it('is empty for an admin who manages no client', async () => {
    const admin = await newAdmin();
    expect(await managedGroupIdsOf(db, admin.id)).toEqual([]);
  });
});
