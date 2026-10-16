import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import {
  getEffectiveGroupMode,
  getModeSettings,
  setDefaultMode,
  setGroupMode,
} from '../notifications/modes.js';
import { groupNotificationSettings } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  reactivateUser,
} from '../users/service.js';
import {
  addManager,
  GroupNotFoundError,
  isGroupManager,
  listGroupManagers,
  managedGroupIds,
  managedGroupsSql,
  NotAnAdminError,
  removeManager,
} from './managers.js';
import { groupManagers, groups } from './schema.js';
import { createGroup } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
const newAdmin = (name = 'Admin') => addAdmin(db, { email: `${randomUUID()}@example.com`, name });
const asActor = (a: { id: string; email: string; name: string }): SessionUser => ({
  id: a.id,
  email: a.email,
  name: a.name,
  role: 'admin',
});

async function settingsRow(userId: string, groupId: string) {
  const [row] = await db
    .select({ mode: groupNotificationSettings.mode, origin: groupNotificationSettings.origin })
    .from(groupNotificationSettings)
    .where(
      and(
        eq(groupNotificationSettings.userId, userId),
        eq(groupNotificationSettings.groupId, groupId),
      ),
    );
  return row ?? null;
}

describe('group managers', () => {
  it('addManager is idempotent', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const first = await addManager(db, g.id, a.id);
    expect(first).toEqual({ changed: true, managers: [{ id: a.id, name: 'Admin' }] });
    const second = await addManager(db, g.id, a.id);
    expect(second).toEqual({ changed: false, managers: first.managers });
  });

  it('removeManager is idempotent', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    await addManager(db, g.id, a.id);
    expect(await removeManager(db, g.id, a.id)).toEqual({ changed: true, managers: [] });
    expect(await removeManager(db, g.id, a.id)).toEqual({ changed: false, managers: [] });
  });

  it('a group has many managers and an admin manages many groups', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    const zed = await newAdmin('Zed');
    const amy = await newAdmin('Amy');
    await addManager(db, g1.id, zed.id);
    await addManager(db, g2.id, zed.id);
    await addManager(db, g1.id, amy.id);
    expect((await managedGroupIds(db, zed.id)).sort()).toEqual([g1.id, g2.id].sort());
    expect(await listGroupManagers(db, g1.id)).toEqual([
      { id: amy.id, name: 'Amy' },
      { id: zed.id, name: 'Zed' },
    ]);
  });

  it('addManager refuses a client, a disabled admin and an unknown id', async () => {
    const g = await newGroup();
    const client = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    await expect(addManager(db, g.id, client.id)).rejects.toBeInstanceOf(NotAnAdminError);
    const disabled = await newAdmin();
    await deactivateUser(db, disabled.id);
    await expect(addManager(db, g.id, disabled.id)).rejects.toBeInstanceOf(NotAnAdminError);
    await expect(addManager(db, g.id, randomUUID())).rejects.toBeInstanceOf(NotAnAdminError);
    const rows = await db.select().from(groupManagers).where(eq(groupManagers.groupId, g.id));
    expect(rows).toEqual([]);
    expect(await settingsRow(client.id, g.id)).toBeNull();
  });

  it('addManager answers GroupNotFoundError for an unknown group', async () => {
    const a = await newAdmin();
    await expect(addManager(db, randomUUID(), a.id)).rejects.toBeInstanceOf(GroupNotFoundError);
    expect(await managedGroupIds(db, a.id)).toEqual([]);
  });

  it('a superadmin can become a manager and counts as one', async () => {
    const g = await newGroup();
    const s = await newAdmin('Super');
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, s.id));
    expect((await addManager(db, g.id, s.id)).changed).toBe(true);
    expect(await isGroupManager(db, g.id, s.id)).toBe(true);
    expect(await managedGroupIds(db, s.id)).toEqual([g.id]);
  });

  it('managedGroupIds and isGroupManager ignore a disabled admin and see them again when re-enabled', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    await addManager(db, g.id, a.id);
    await deactivateUser(db, a.id);
    expect(await managedGroupIds(db, a.id)).toEqual([]);
    expect(await isGroupManager(db, g.id, a.id)).toBe(false);
    expect(await listGroupManagers(db, g.id)).toEqual([]);
    await reactivateUser(db, a.id);
    expect(await managedGroupIds(db, a.id)).toEqual([g.id]);
    expect(await isGroupManager(db, g.id, a.id)).toBe(true);
  });

  it('managedGroupsSql matches managedGroupIds', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    await newGroup();
    const a = await newAdmin();
    await addManager(db, g1.id, a.id);
    await addManager(db, g2.id, a.id);
    const rows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(sql`${groups.id} in ${managedGroupsSql(a.id)}`);
    expect(rows.map((r) => r.id).sort()).toEqual((await managedGroupIds(db, a.id)).sort());
    expect(rows).toHaveLength(2);
  });

  describe('the notification rule', () => {
    it('no row: becoming manager inserts all/manager', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await addManager(db, g.id, a.id);
      expect(await settingsRow(a.id, g.id)).toEqual({ mode: 'all', origin: 'manager' });
    });

    it('an existing user row (mentions) is kept', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await setGroupMode(db, a.id, g.id, 'mentions');
      await addManager(db, g.id, a.id);
      expect(await settingsRow(a.id, g.id)).toEqual({ mode: 'mentions', origin: 'user' });
    });

    it('stopping deletes a manager row', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await addManager(db, g.id, a.id);
      await removeManager(db, g.id, a.id);
      const settings = await getModeSettings(db, asActor(a));
      expect(settings.overrides).toEqual({});
      expect(settings.managerSet).not.toContain(g.id);
    });

    it('stopping keeps a user row', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await setGroupMode(db, a.id, g.id, 'mentions');
      await addManager(db, g.id, a.id);
      await removeManager(db, g.id, a.id);
      expect(await settingsRow(a.id, g.id)).toEqual({ mode: 'mentions', origin: 'user' });
    });

    it('a bell change after becoming manager flips origin to user and survives stopping', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await addManager(db, g.id, a.id);
      await setGroupMode(db, a.id, g.id, 'off');
      expect(await settingsRow(a.id, g.id)).toEqual({ mode: 'off', origin: 'user' });
      await removeManager(db, g.id, a.id);
      expect((await getModeSettings(db, asActor(a))).overrides).toEqual({ [g.id]: 'off' });
    });

    it('setDefaultMode removes manager rows, and becoming manager again re-inserts all', async () => {
      const g = await newGroup();
      const a = await newAdmin();
      await addManager(db, g.id, a.id);
      await setDefaultMode(db, a.id, 'off');
      expect(await settingsRow(a.id, g.id)).toBeNull();
      await removeManager(db, g.id, a.id);
      await addManager(db, g.id, a.id);
      expect(await settingsRow(a.id, g.id)).toEqual({ mode: 'all', origin: 'manager' });
    });

    it('a manager with an all-groups default of off gets all for that group', async () => {
      const g = await newGroup();
      const other = await newGroup();
      const a = await newAdmin();
      await setDefaultMode(db, a.id, 'off');
      await addManager(db, g.id, a.id);
      expect(await getEffectiveGroupMode(db, asActor(a), g.id)).toBe('all');
      expect(await getEffectiveGroupMode(db, asActor(a), other.id)).toBe('off');
    });
  });
});
