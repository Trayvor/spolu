import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { user } from '../users/schema.js';
import { addManager } from './managers.js';
import {
  addMember,
  createGroup,
  EgrantUrlTakenError,
  getGroup,
  getGroupByInviteToken,
  getMembershipGroupId,
  isGroupPerson,
  isPickablePerson,
  listGroupPeople,
  listPickablePeople,
  listGroups,
  listMembers,
  moveUnverified,
  regenerateInvite,
  setLogoKey,
  updateGroup,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const uniqueHost = (): string => `g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const newGroup = (name = 'Firma') =>
  createGroup(db, { name, egrantUrl: `https://${uniqueHost()}/app` });

async function newClient(verified: boolean) {
  const row = await createUnverifiedClient(db, `${randomUUID()}@Example.com `);
  if (verified) await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.id));
  return row;
}

describe('createUnverifiedClient', () => {
  it('lower-cases the email and creates an unverified client with an empty name', async () => {
    const row = await createUnverifiedClient(db, `  ${randomUUID()}@Example.COM `);
    expect(row.email).toBe(row.email.toLowerCase().trim());
    expect(row.role).toBe('client');
    expect(row.name).toBe('');
    expect(row.emailVerified).toBe(false);
  });
});

describe('createGroup', () => {
  it('stores the normalized URL and a 32-character invite token', async () => {
    const host = uniqueHost();
    const group = await createGroup(db, {
      name: 'A',
      egrantUrl: `HTTPS://${host.toUpperCase()}:443/x`,
    });
    expect(group.egrantUrl).toBe(`https://${host}`);
    expect(group.inviteToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(group.logoKey).toBeNull();
  });

  it('rejects a duplicate normalized URL', async () => {
    const host = uniqueHost();
    await createGroup(db, { name: 'A', egrantUrl: `https://${host}/` });
    await expect(
      createGroup(db, { name: 'B', egrantUrl: `https://${host.toUpperCase()}/app/login` }),
    ).rejects.toBeInstanceOf(EgrantUrlTakenError);
  });
});

describe('updateGroup', () => {
  it('updates name and URL, rejects a taken URL and returns null for an unknown id', async () => {
    const a = await newGroup('A');
    const b = await newGroup('B');
    const host = uniqueHost();
    const updated = await updateGroup(db, a.id, { name: 'A2', egrantUrl: `https://${host}` });
    expect(updated?.name).toBe('A2');
    expect(updated?.egrantUrl).toBe(`https://${host}`);
    await expect(
      updateGroup(db, b.id, { name: 'B', egrantUrl: `https://${host}/z` }),
    ).rejects.toBeInstanceOf(EgrantUrlTakenError);
    expect(
      await updateGroup(db, randomUUID(), { name: 'X', egrantUrl: 'https://x.egrant.sk' }),
    ).toBeNull();
  });
});

describe('getGroup', () => {
  it('returns the group or null', async () => {
    const g = await newGroup();
    expect((await getGroup(db, g.id))?.id).toBe(g.id);
    expect(await getGroup(db, randomUUID())).toBeNull();
  });
});

describe('regenerateInvite', () => {
  it('changes the token and the old token no longer resolves', async () => {
    const g = await newGroup();
    const fresh = await regenerateInvite(db, g.id);
    expect(fresh).not.toBe(g.inviteToken);
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await getGroupByInviteToken(db, g.inviteToken)).toBeNull();
    expect((await getGroupByInviteToken(db, fresh))?.id).toBe(g.id);
  });
});

describe('members', () => {
  it('addMember sets the membership, once per client', async () => {
    const g = await newGroup();
    const c = await newClient(true);
    expect(await getMembershipGroupId(db, c.id)).toBeNull();
    await addMember(db, g.id, c.id);
    expect(await getMembershipGroupId(db, c.id)).toBe(g.id);
    await addMember(db, g.id, c.id); // idempotent
    expect(await listMembers(db, g.id, { removed: false })).toHaveLength(1);
  });

  it('listGroups counts only verified active clients', async () => {
    const g = await newGroup('Count');
    const active = await newClient(true);
    const unverified = await newClient(false);
    const removed = await newClient(true);
    for (const c of [active, unverified, removed]) await addMember(db, g.id, c.id);
    await deactivateUser(db, removed.id);
    const row = (await listGroups(db)).find((x) => x.id === g.id);
    expect(row).toEqual({
      id: g.id,
      name: 'Count',
      hasLogo: false,
      memberCount: 1,
      updatedAt: g.updatedAt.toISOString(),
    });
  });

  it('listGroups orders by name', async () => {
    // Other test files add groups too: assert only the relative order of ours.
    const z = await newGroup('zzz');
    const a = await newGroup('aaa');
    const ids = (await listGroups(db)).map((g) => g.id);
    expect(ids.indexOf(a.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(z.id));
  });

  it('listGroups gives a group without members memberCount 0', async () => {
    const g = await newGroup('Empty');
    const row = (await listGroups(db)).find((x) => x.id === g.id);
    expect(row).toEqual({
      id: g.id,
      name: 'Empty',
      hasLogo: false,
      memberCount: 0,
      updatedAt: g.updatedAt.toISOString(),
    });
  });

  it('listMembers hides unverified clients and splits removed ones', async () => {
    const g = await newGroup();
    const active = await newClient(true);
    const unverified = await newClient(false);
    const removed = await newClient(true);
    for (const c of [active, unverified, removed]) await addMember(db, g.id, c.id);
    await deactivateUser(db, removed.id);
    const ids = async (r: boolean) =>
      (await listMembers(db, g.id, { removed: r })).map((m) => m.id);
    expect(await ids(false)).toEqual([active.id]);
    expect(await ids(true)).toEqual([removed.id]);
  });
});

describe('setLogoKey', () => {
  it('returns the previous key', async () => {
    const g = await newGroup();
    expect(await setLogoKey(db, g.id, 'k1')).toBeNull();
    expect(await setLogoKey(db, g.id, 'k2')).toBe('k1');
    expect(await setLogoKey(db, g.id, null)).toBe('k2');
    expect((await getGroup(db, g.id))?.logoKey).toBeNull();
  });
});

describe('moveUnverified', () => {
  it('moves an unverified client to the new group', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const client = await newClient(false);
    await addMember(db, a.id, client.id);
    await moveUnverified(db, b.id, client);
    expect(await getMembershipGroupId(db, client.id)).toBe(b.id);
  });

  it('does not move a client who verified after the row was read', async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const stale = await newClient(false); // the stale read: still says unverified
    await addMember(db, a.id, stale.id);
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, stale.id));
    await moveUnverified(db, b.id, stale);
    expect(await getMembershipGroupId(db, stale.id)).toBe(a.id);
  });
});

describe('group people', () => {
  /** A verified client with a name, optionally in `groupId`. */
  async function namedClient(name: string, groupId?: string) {
    const row = await newClient(true);
    await db.update(user).set({ name }).where(eq(user.id, row.id));
    if (groupId) await addMember(db, groupId, row.id);
    return row;
  }
  const newAdmin = (name: string) => addAdmin(db, { email: `${randomUUID()}@example.com`, name });

  async function scenario() {
    const g = await newGroup();
    const other = await newGroup();
    const tag = randomUUID().slice(0, 8);
    const client = await namedClient(`Bb ${tag}`, g.id);
    const admin = await newAdmin(`Aa ${tag}`);
    const removed = await namedClient(`Removed ${tag}`, g.id);
    await deactivateUser(db, removed.id);
    const unnamed = await newClient(false);
    await addMember(db, g.id, unnamed.id);
    const emptyName = await namedClient('', g.id);
    const blankName = await namedClient('   ', g.id);
    const foreign = await namedClient(`Foreign ${tag}`, other.id);
    const deactivatedAdmin = await newAdmin(`Gone ${tag}`);
    await deactivateUser(db, deactivatedAdmin.id);
    return { g, client, admin, removed, unnamed, emptyName, blankName, foreign, deactivatedAdmin };
  }

  it("listGroupPeople lists the group's named active clients and active admins", async () => {
    const s = await scenario();
    const people = await listGroupPeople(db, s.g.id);
    const ids = people.map((p) => p.id);
    expect(people.find((p) => p.id === s.client.id)).toMatchObject({ isAdmin: false });
    expect(people.find((p) => p.id === s.admin.id)).toMatchObject({ isAdmin: true });
    for (const excluded of [
      s.removed,
      s.unnamed,
      s.emptyName,
      s.blankName,
      s.foreign,
      s.deactivatedAdmin,
    ]) {
      expect(ids).not.toContain(excluded.id);
    }
    // Other tests add admins too: assert only the relative order of ours ("Aa" before "Bb").
    expect(ids.indexOf(s.admin.id)).toBeLessThan(ids.indexOf(s.client.id));
  });

  it('isGroupPerson is true for the named client and an admin, false for everyone else', async () => {
    const s = await scenario();
    expect(await isGroupPerson(db, s.g.id, s.client.id)).toBe(true);
    expect(await isGroupPerson(db, s.g.id, s.admin.id)).toBe(true);
    for (const no of [
      s.removed,
      s.unnamed,
      s.emptyName,
      s.blankName,
      s.foreign,
      s.deactivatedAdmin,
    ]) {
      expect(await isGroupPerson(db, s.g.id, no.id)).toBe(false);
    }
    expect(await isGroupPerson(db, s.g.id, randomUUID())).toBe(false);
  });

  it('isGroupPerson agrees with listGroupPeople for every user of the scenario', async () => {
    const s = await scenario();
    const listed = new Set((await listGroupPeople(db, s.g.id)).map((p) => p.id));
    const everyone = [
      s.client,
      s.admin,
      s.removed,
      s.unnamed,
      s.emptyName,
      s.blankName,
      s.foreign,
      s.deactivatedAdmin,
    ];
    for (const u of everyone) {
      expect(await isGroupPerson(db, s.g.id, u.id)).toBe(listed.has(u.id));
    }
  });
});

describe('readers versus pickable people', () => {
  const tag = () => randomUUID().slice(0, 8);
  async function named(name: string, groupId: string) {
    const row = await newClient(true);
    await db.update(user).set({ name }).where(eq(user.id, row.id));
    await addMember(db, groupId, row.id);
    return row;
  }
  const newAdmin = (name: string) => addAdmin(db, { email: `${randomUUID()}@example.com`, name });

  async function scenario() {
    const g = await newGroup();
    const other = await newGroup();
    const t = tag();
    const client = await named(`Bb ${t}`, g.id);
    const m = await newAdmin(`Mm ${t}`);
    const n = await newAdmin(`Nn ${t}`);
    await addManager(db, g.id, m.id);
    const otherClient = await named(`Other ${t}`, other.id);
    const otherManager = await newAdmin(`Om ${t}`);
    await addManager(db, other.id, otherManager.id);
    return { g, client, m, n, otherClient, otherManager };
  }

  it('listGroupPeople returns readers with isManager', async () => {
    const s = await scenario();
    const people = await listGroupPeople(db, s.g.id);
    expect(people.find((p) => p.id === s.client.id)?.isManager).toBe(false);
    expect(people.find((p) => p.id === s.m.id)).toMatchObject({ isAdmin: true, isManager: true });
    expect(people.find((p) => p.id === s.n.id)).toMatchObject({ isAdmin: true, isManager: false });
    expect(people.find((p) => p.id === s.otherManager.id)?.isManager).toBe(false);
  });

  it('listPickablePeople is the clients and the active managers', async () => {
    const s = await scenario();
    const ours = new Set([s.client.id, s.m.id, s.n.id, s.otherManager.id, s.otherClient.id]);
    const ids = async () =>
      (await listPickablePeople(db, s.g.id)).map((p) => p.id).filter((id) => ours.has(id));
    expect((await ids()).sort()).toEqual([s.client.id, s.m.id].sort());
    await deactivateUser(db, s.m.id);
    expect(await ids()).toEqual([s.client.id]);
  });

  it('isPickablePerson', async () => {
    const s = await scenario();
    expect(await isPickablePerson(db, s.g.id, s.client.id)).toBe(true);
    expect(await isPickablePerson(db, s.g.id, s.m.id)).toBe(true);
    expect(await isPickablePerson(db, s.g.id, s.n.id)).toBe(false);
    expect(await isPickablePerson(db, s.g.id, s.otherClient.id)).toBe(false);
    expect(await isPickablePerson(db, s.g.id, randomUUID())).toBe(false);
    await deactivateUser(db, s.m.id);
    expect(await isPickablePerson(db, s.g.id, s.m.id)).toBe(false);
  });

  it('a manager of another group is not pickable here', async () => {
    const s = await scenario();
    expect(await isPickablePerson(db, s.g.id, s.otherManager.id)).toBe(false);
    expect((await listPickablePeople(db, s.g.id)).some((p) => p.id === s.otherManager.id)).toBe(
      false,
    );
  });

  it('a removed client is not pickable', async () => {
    const s = await scenario();
    const removed = await named(`Removed ${tag()}`, s.g.id);
    await deactivateUser(db, removed.id);
    expect((await listPickablePeople(db, s.g.id)).some((p) => p.id === removed.id)).toBe(false);
    expect(await isPickablePerson(db, s.g.id, removed.id)).toBe(false);
    const reader = (await listGroupPeople(db, s.g.id)).find((p) => p.id === removed.id);
    expect(reader?.isManager ?? false).toBe(false);
  });
});
