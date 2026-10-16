import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { addMember, createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, getNotificationProfiles } from '../users/service.js';
import {
  getEffectiveModes,
  getModeSettings,
  setDefaultMode,
  setGroupMode,
  startManagerMode,
} from './modes.js';

const { db, close } = createDb(testConfig().databaseUrl);
afterAll(close);

const email = () => `${randomUUID()}@example.com`;
const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });

describe('notification modes', () => {
  it('setGroupMode upserts and setDefaultMode clears the overrides', async () => {
    const group = await newGroup();
    const client = await createUnverifiedClient(db, email());
    await addMember(db, group.id, client.id);
    const actor = { id: client.id, email: client.email, name: 'C', role: 'client' as const };

    await setGroupMode(db, client.id, group.id, 'off');
    await setGroupMode(db, client.id, group.id, 'mentions');
    expect((await getModeSettings(db, actor)).overrides).toEqual({ [group.id]: 'mentions' });

    await setDefaultMode(db, client.id, 'off');
    expect(await getModeSettings(db, actor)).toEqual({
      defaultMode: 'off',
      roleDefault: 'all',
      overrides: {},
      managerSet: [],
    });
  });

  it('getEffectiveModes resolves override, default and role default', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const other = await addAdmin(db, { email: email(), name: 'B' });
    await setGroupMode(db, admin.id, g1.id, 'all');
    await setDefaultMode(db, other.id, 'off');
    const profiles = await getNotificationProfiles(db, [admin.id, other.id]);
    const modes = await getEffectiveModes(
      db,
      [
        { userId: admin.id, groupId: g1.id },
        { userId: admin.id, groupId: g2.id },
        { userId: other.id, groupId: g1.id },
      ],
      profiles,
    );
    expect(modes.get(`${admin.id}:${g1.id}`)).toBe('all');
    expect(modes.get(`${admin.id}:${g2.id}`)).toBe('mentions');
    expect(modes.get(`${other.id}:${g1.id}`)).toBe('off');
    expect((await getEffectiveModes(db, [], profiles)).size).toBe(0);
  });

  it('getModeSettings returns managerSet with only manager-origin groups', async () => {
    const managed = await newGroup();
    const own = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const actor = { id: admin.id, email: admin.email, name: 'A', role: 'admin' as const };
    await startManagerMode(db, admin.id, managed.id);
    await setGroupMode(db, admin.id, own.id, 'off');
    const settings = await getModeSettings(db, actor);
    expect(settings.managerSet).toEqual([managed.id]);
    expect(settings.overrides).toEqual({ [managed.id]: 'all', [own.id]: 'off' });
  });
});
