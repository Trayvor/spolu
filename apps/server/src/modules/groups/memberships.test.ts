import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addAdmin, createUnverifiedClient, getUserById } from '../users/service.js';
import {
  addMembership,
  applyPendingInvite,
  clientGroupIds,
  getMembership,
  isRequesterOnly,
  listMemberships,
  removeMembership,
  restoreMembership,
  setPendingInvite,
} from './memberships.js';
import { groupMembers } from './schema.js';
import { createGroup } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = (name = 'Firma') =>
  createGroup(db, { name, egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk` });
const newClient = () => createUnverifiedClient(db, `${randomUUID()}@example.com`);
const asSession = (u: { id: string; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role }) as SessionUser;

async function rowOf(userId: string, groupId: string) {
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)));
  return row ?? null;
}

describe('addMembership', () => {
  it('adds a client', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    expect(await addMembership(db, c.id, g.id, 'client')).toBe('added');
    expect(await getMembership(db, c.id, g.id)).toEqual({ role: 'client', removedAt: null });
  });

  it('adds a ziadatel beside a client membership of another group', async () => {
    const [a, b, c] = await Promise.all([newGroup(), newGroup(), newClient()]);
    await addMembership(db, c.id, a.id, 'client');
    expect(await addMembership(db, c.id, b.id, 'ziadatel')).toBe('added');
    expect((await getMembership(db, c.id, a.id))?.role).toBe('client');
    expect((await getMembership(db, c.id, b.id))?.role).toBe('ziadatel');
  });

  it('promotes a ziadatel to client in the same group', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'ziadatel');
    expect(await addMembership(db, c.id, g.id, 'client')).toBe('promoted');
    expect((await getMembership(db, c.id, g.id))?.role).toBe('client');
  });

  it('never demotes a client to ziadatel', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'client');
    expect(await addMembership(db, c.id, g.id, 'ziadatel')).toBe('unchanged');
    expect((await getMembership(db, c.id, g.id))?.role).toBe('client');
  });

  it('keeps a removed membership removed', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'ziadatel');
    await removeMembership(db, g.id, c.id);
    expect(await addMembership(db, c.id, g.id, 'client')).toBe('removed');
    const row = await rowOf(c.id, g.id);
    expect(row?.role).toBe('ziadatel');
    expect(row?.removedAt).not.toBeNull();
  });
});

describe('listMemberships and clientGroupIds', () => {
  it('list the active memberships by group name and only client groups', async () => {
    const [a, b, z, gone, c] = await Promise.all([
      newGroup('Beta'),
      newGroup('Alfa'),
      newGroup('Zeta'),
      newGroup('Preč'),
      newClient(),
    ]);
    await addMembership(db, c.id, a.id, 'client');
    await addMembership(db, c.id, b.id, 'client');
    await addMembership(db, c.id, z.id, 'ziadatel');
    await addMembership(db, c.id, gone.id, 'client');
    await removeMembership(db, gone.id, c.id);
    const summary = (await listMemberships(db, c.id)).map(({ groupId, name, role }) => ({
      groupId,
      name,
      role,
    }));
    expect(summary).toEqual([
      { groupId: b.id, name: 'Alfa', role: 'client' },
      { groupId: a.id, name: 'Beta', role: 'client' },
      { groupId: z.id, name: 'Zeta', role: 'ziadatel' },
    ]);
    expect((await clientGroupIds(db, c.id)).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('removeMembership and restoreMembership', () => {
  it('reports lastActive only for the last active membership', async () => {
    const [a, b, c] = await Promise.all([newGroup(), newGroup(), newClient()]);
    await addMembership(db, c.id, a.id, 'client');
    await addMembership(db, c.id, b.id, 'ziadatel');
    expect(await removeMembership(db, a.id, c.id)).toEqual({ lastActive: false });
    expect(await removeMembership(db, b.id, c.id)).toEqual({ lastActive: true });
  });

  it('restore brings the membership back', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'client');
    await removeMembership(db, g.id, c.id);
    await restoreMembership(db, g.id, c.id);
    expect(await getMembership(db, c.id, g.id)).toEqual({ role: 'client', removedAt: null });
  });
});

describe('pending invites', () => {
  it('the latest invite wins and becomes a client membership on sign-in', async () => {
    const [a, b, c] = await Promise.all([newGroup(), newGroup(), newClient()]);
    await setPendingInvite(db, c.id, a.id);
    await setPendingInvite(db, c.id, b.id);
    expect(await getMembership(db, c.id, b.id)).toBeNull();
    expect(await applyPendingInvite(db, c.id)).toBe(b.id);
    expect((await getMembership(db, c.id, b.id))?.role).toBe('client');
    expect(await getMembership(db, c.id, a.id)).toBeNull();
    expect(await applyPendingInvite(db, c.id)).toBeNull();
  });

  it('turns a ziadatel membership into client', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'ziadatel');
    await setPendingInvite(db, c.id, g.id);
    await applyPendingInvite(db, c.id);
    expect((await getMembership(db, c.id, g.id))?.role).toBe('client');
  });

  it('never restores a membership an admin removed', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'client');
    await removeMembership(db, g.id, c.id);
    await setPendingInvite(db, c.id, g.id);
    expect(await applyPendingInvite(db, c.id)).toBeNull();
    expect((await getMembership(db, c.id, g.id))?.removedAt).not.toBeNull();
  });
});

describe('isRequesterOnly', () => {
  it('is true with only ziadatel memberships', async () => {
    const [g, c] = await Promise.all([newGroup(), newClient()]);
    await addMembership(db, c.id, g.id, 'ziadatel');
    expect(await isRequesterOnly(db, asSession((await getUserById(db, c.id))!))).toBe(true);
  });

  it('is false with any active client membership', async () => {
    const [a, b, c] = await Promise.all([newGroup(), newGroup(), newClient()]);
    await addMembership(db, c.id, a.id, 'ziadatel');
    await addMembership(db, c.id, b.id, 'client');
    expect(await isRequesterOnly(db, asSession((await getUserById(db, c.id))!))).toBe(false);
  });

  it('is false for admins', async () => {
    const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'A' });
    expect(await isRequesterOnly(db, asSession({ ...admin, role: 'admin' }))).toBe(false);
  });
});
