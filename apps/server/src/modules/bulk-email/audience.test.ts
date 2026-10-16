import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { BulkAudienceSchema, type BulkAudience, type MemberRole } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addManager } from '../groups/managers.js';
import { addMembership, removeMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import {
  countAudience,
  listAudience,
  lookupPeople,
  resolveAudience,
  searchPeople,
} from './audience.js';
import { bulkSubscriptions } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
// A new connection first reads the types: warm it up so the counts see only the query.
beforeAll(() => counting.db.execute(sql`select 1`));
afterAll(async () => {
  await close();
  await counting.close();
});

const audience = (over: Partial<BulkAudience> = {}): BulkAudience =>
  BulkAudienceSchema.parse(over);

const newGroup = (name = 'Firma') =>
  createGroup(db, { name, egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk` });

async function newPerson(
  opts: { name?: string; verified?: boolean; language?: 'sk' | 'en' } = {},
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await db.insert(user).values({
    id,
    email,
    name: opts.name ?? 'Person',
    role: 'client',
    emailVerified: opts.verified ?? true,
    language: opts.language ?? 'sk',
  });
  return { id, email };
}

async function member(groupId: string, role: MemberRole = 'client', name?: string) {
  const person = await newPerson({ name });
  await addMembership(db, person.id, groupId, role);
  return person;
}

async function newAdmin(name = 'Ada') {
  return addAdmin(db, { email: `${randomUUID()}@example.com`, name });
}

const idsOf = async (a: BulkAudience) => new Set((await resolveAudience(db, a)).map((r) => r.userId));

async function unsubscribe(userId: string, subscribed = false) {
  await db.insert(bulkSubscriptions).values({
    userId,
    subscribed,
    email: 'x@example.com',
    source: 'profile',
    changedAt: new Date(),
  });
}

describe('audience', () => {
  it('group filter takes active clients of the group, not removed memberships', async () => {
    const g = await newGroup();
    const other = await newGroup();
    const active = await member(g.id);
    const removed = await member(g.id);
    await removeMembership(db, g.id, removed.id);
    const outside = await member(other.id);

    const ids = await idsOf(audience({ groupIds: [g.id], roles: ['client'] }));
    expect(ids).toEqual(new Set([active.id]));
    expect(ids.has(outside.id)).toBe(false);
  });

  it('roles ziadatel takes only ziadatel memberships', async () => {
    const g = await newGroup();
    const client = await member(g.id, 'client');
    const ziadatel = await member(g.id, 'ziadatel');
    expect(await idsOf(audience({ groupIds: [g.id], roles: ['ziadatel'] }))).toEqual(
      new Set([ziadatel.id]),
    );
    expect(await idsOf(audience({ groupIds: [g.id], roles: ['client', 'ziadatel'] }))).toEqual(
      new Set([client.id, ziadatel.id]),
    );
  });

  it('no roles and no people = nobody', async () => {
    const g = await newGroup();
    await member(g.id);
    expect(await countAudience(db, audience({ groupIds: [g.id] }))).toEqual({
      count: 0,
      leftOut: { unsubscribed: 0, disabled: 0 },
    });
  });

  it('empty groups and managers = every group', async () => {
    const a = await member((await newGroup()).id);
    const b = await member((await newGroup()).id);
    const ids = await idsOf(audience({ roles: ['client'] }));
    expect(ids.has(a.id) && ids.has(b.id)).toBe(true);
  });

  it('managerIds adds the groups that admin manages', async () => {
    const managed = await newGroup();
    const picked = await newGroup();
    const neither = await newGroup();
    const admin = await newAdmin();
    await addManager(db, managed.id, admin.id);
    const inManaged = await member(managed.id);
    const inPicked = await member(picked.id);
    await member(neither.id);

    expect(await idsOf(audience({ managerIds: [admin.id], roles: ['client'] }))).toEqual(
      new Set([inManaged.id]),
    );
    expect(
      await idsOf(audience({ groupIds: [picked.id], managerIds: [admin.id], roles: ['client'] })),
    ).toEqual(new Set([inManaged.id, inPicked.id]));
  });

  it('a manager who manages nothing narrows the scope to no group', async () => {
    const admin = await newAdmin();
    await member((await newGroup()).id);
    expect((await countAudience(db, audience({ managerIds: [admin.id], roles: ['client'] }))).count).toBe(0);
  });

  it('admin role adds every active admin, ignoring the group scope', async () => {
    const g = await newGroup();
    const admin = await newAdmin();
    const client = await member(g.id);
    const ids = await idsOf(audience({ groupIds: [g.id], roles: ['client', 'admin'] }));
    expect(ids.has(admin.id)).toBe(true);
    expect(ids.has(client.id)).toBe(true);
    // Admins have no memberships: the scope does not narrow them.
    expect((await idsOf(audience({ groupIds: [g.id], roles: ['admin'] }))).has(admin.id)).toBe(
      true,
    );
  });

  it('includeUserIds adds a person outside the filters', async () => {
    const g = await newGroup();
    const inGroup = await member(g.id);
    const loner = await newPerson();
    expect(
      await idsOf(audience({ groupIds: [g.id], roles: ['client'], includeUserIds: [loner.id] })),
    ).toEqual(new Set([inGroup.id, loner.id]));
    expect(await idsOf(audience({ includeUserIds: [loner.id] }))).toEqual(new Set([loner.id]));
  });

  it('excludeUserIds removes a person, also one included by hand', async () => {
    const g = await newGroup();
    const a = await member(g.id);
    const b = await member(g.id);
    expect(
      await idsOf(
        audience({
          groupIds: [g.id],
          roles: ['client'],
          includeUserIds: [b.id],
          excludeUserIds: [b.id],
        }),
      ),
    ).toEqual(new Set([a.id]));
  });

  it('a person in two groups, included by hand and admin is counted once', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup();
    const admin = await newAdmin();
    await addMembership(db, admin.id, g1.id, 'client');
    await addMembership(db, admin.id, g2.id, 'client');
    const a = audience({
      groupIds: [g1.id, g2.id],
      roles: ['client'],
      includeUserIds: [admin.id],
    });
    expect((await countAudience(db, a)).count).toBe(1);
    expect(await resolveAudience(db, a)).toHaveLength(1);

    const withAdmins = audience({ ...a, roles: ['client', 'admin'] });
    const rows = await resolveAudience(db, withAdmins);
    expect(rows.filter((r) => r.userId === admin.id)).toHaveLength(1);
    const people = await listAudience(db, withAdmins);
    expect(people.items.filter((p) => p.id === admin.id)).toHaveLength(1);
  });

  it('disabled and unsubscribed people are left out and counted per reason', async () => {
    const g = await newGroup();
    const ok = await member(g.id);
    const disabled = await member(g.id);
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, disabled.id));
    const unsubscribed = await member(g.id);
    await unsubscribe(unsubscribed.id);
    const both = await member(g.id);
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, both.id));
    await unsubscribe(both.id);

    const a = audience({ groupIds: [g.id], roles: ['client'] });
    expect(await countAudience(db, a)).toEqual({
      count: 1,
      leftOut: { unsubscribed: 1, disabled: 2 },
    });
    expect(await idsOf(a)).toEqual(new Set([ok.id]));
    expect((await listAudience(db, a)).items.map((p) => p.id)).toEqual([ok.id]);
  });

  it('a person who never signed in is included (P1)', async () => {
    const g = await newGroup();
    const invited = await newPerson({ verified: false });
    await addMembership(db, invited.id, g.id, 'client');
    expect(await idsOf(audience({ groupIds: [g.id], roles: ['client'] }))).toEqual(
      new Set([invited.id]),
    );
  });

  it('a person who re-subscribed (row with subscribed true) is included', async () => {
    const g = await newGroup();
    const back = await member(g.id);
    await unsubscribe(back.id, true);
    const a = audience({ groupIds: [g.id], roles: ['client'] });
    expect(await countAudience(db, a)).toEqual({
      count: 1,
      leftOut: { unsubscribed: 0, disabled: 0 },
    });
  });

  it('resolveAudience returns the address, name and language of each person', async () => {
    const g = await newGroup();
    const person = await newPerson({ name: 'Eva', language: 'en' });
    await addMembership(db, person.id, g.id, 'client');
    expect(await resolveAudience(db, audience({ groupIds: [g.id], roles: ['client'] }))).toEqual([
      { userId: person.id, email: person.email, name: 'Eva', language: 'en' },
    ]);
  });

  it('count runs one SQL statement', async () => {
    const g = await newGroup();
    await member(g.id);
    const a = audience({ groupIds: [g.id], managerIds: [randomUUID()], roles: ['client', 'admin'] });
    counting.reset();
    await countAudience(counting.db, a);
    expect(counting.count()).toBe(1);
  });

  it('lists people by name, 50 a page, with role and group names', async () => {
    const g = await newGroup('Alfa');
    const g2 = await newGroup('Beta');
    const names = Array.from({ length: 52 }, (_, i) => `P${String(i).padStart(2, '0')}`);
    for (const name of names) await member(g.id, 'client', name);
    const zia = await member(g2.id, 'ziadatel', 'P99');
    const a = audience({ groupIds: [g.id, g2.id], roles: ['client', 'ziadatel'] });

    counting.reset();
    const first = await listAudience(counting.db, a);
    expect(counting.count()).toBe(1);
    expect(first.items.map((p) => p.name)).toEqual(names.slice(0, 50));
    expect(first.items[0]).toMatchObject({ role: 'client', groups: ['Alfa'] });
    expect(first.nextCursor).not.toBeNull();

    const second = await listAudience(db, a, first.nextCursor!);
    expect(second.items.map((p) => p.name)).toEqual([...names.slice(50), 'P99']);
    expect(second.items.at(-1)).toMatchObject({ id: zia.id, role: 'ziadatel', groups: ['Beta'] });
    expect(second.nextCursor).toBeNull();
  });

  it('a malformed cursor is rejected', async () => {
    await expect(listAudience(db, audience(), 'not-a-cursor')).rejects.toThrow();
  });

  it('searches active people by name or email, 20 at most', async () => {
    const tag = randomUUID().slice(0, 8);
    const g = await newGroup('Gama');
    const found = await member(g.id, 'client', `Zora ${tag}`);
    const disabled = await newPerson({ name: `Zora ${tag} off` });
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, disabled.id));

    const byName = await searchPeople(db, tag);
    expect(byName.map((p) => p.id)).toEqual([found.id]);
    expect(byName[0]).toMatchObject({ role: 'client', groups: ['Gama'], email: found.email });
    expect((await searchPeople(db, found.email.slice(0, 12))).map((p) => p.id)).toEqual([
      found.id,
    ]);
    // LIKE wildcards are matched literally.
    expect(await searchPeople(db, `%_${tag}`)).toEqual([]);
  });

  it('looks people up by id, unknown ids left out', async () => {
    const admin = await newAdmin('Lookup Admin');
    const person = await newPerson({ name: 'Lu' });
    const found = await lookupPeople(db, [person.id, admin.id, randomUUID()]);
    expect(new Set(found.map((p) => p.id))).toEqual(new Set([person.id, admin.id]));
    expect(found.find((p) => p.id === admin.id)).toMatchObject({ role: 'admin', groups: [] });
  });
});
