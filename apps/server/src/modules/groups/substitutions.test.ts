import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { systemActor, userActor } from '../audit/actor.js';
import { getEffectiveGroupMode, setGroupMode } from '../notifications/modes.js';
import { groupNotificationSettings } from '../notifications/schema.js';
import { ticketWatcherIds, watchesTickets } from '../tickets/watch.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { user } from '../users/schema.js';
import {
  addManager,
  isGroupManager,
  listGroupManagers,
  managedGroupIds,
  removeManager,
} from './managers.js';
import { groupsJobHandlers, SUBSTITUTIONS_EXPIRE_JOB } from './jobs.js';
import { createGroup, listGroupPeople } from './service.js';
import {
  activeSubstitutions,
  AlreadySubstitutedError,
  endSubstitution,
  endSubstitutionsOf,
  EndsInPastError,
  expireSubstitutions,
  InvalidSubstituteError,
  startSubstitution,
  SubstitutedNotFoundError,
  SubstituteAwayError,
} from './substitutions.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const TODAY = '2026-10-19';
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
  finance: false,
});
const by = (a: { id: string; name: string }) => userActor(a);

const start = (
  substitutedId: string,
  substituteId: string,
  author: { id: string; name: string },
  endsOn: string | null = null,
) => startSubstitution(db, { substitutedId, substituteId, endsOn }, by(author), TODAY);

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

describe('admin substitution', () => {
  it('makes B a manager of every group A manages, and only those', async () => {
    const [g1, g2, other] = [await newGroup(), await newGroup(), await newGroup()];
    const a = await newAdmin('Anna');
    const b = await newAdmin('Boris');
    await addManager(db, g1.id, a.id);
    await addManager(db, g2.id, a.id);

    const { substitution, changedGroupIds } = await start(a.id, b.id, a);
    expect(substitution).toMatchObject({
      substitutedId: a.id,
      substituteId: b.id,
      substituteName: 'Boris',
      endsOn: null,
    });
    expect(changedGroupIds.sort()).toEqual([g1.id, g2.id].sort());
    expect(await isGroupManager(db, g1.id, b.id)).toBe(true);
    expect(await isGroupManager(db, g2.id, b.id)).toBe(true);
    expect(await isGroupManager(db, other.id, b.id)).toBe(false);
    expect((await managedGroupIds(db, b.id)).sort()).toEqual([g1.id, g2.id].sort());
    // A stays a manager; B is listed next to A.
    expect(await listGroupManagers(db, g1.id)).toEqual([
      { id: a.id, name: 'Anna' },
      { id: b.id, name: 'Boris' },
    ]);
  });

  it('labels B as "substitutes A" in the group people, and only B', async () => {
    const g = await newGroup();
    const a = await newAdmin('Anna');
    const b = await newAdmin('Boris');
    await addManager(db, g.id, a.id);
    await start(a.id, b.id, a);
    const people = await listGroupPeople(db, g.id);
    expect(people.find((p) => p.id === b.id)).toEqual({
      id: b.id,
      name: 'Boris',
      isAdmin: true,
      isManager: true,
      substitutesFor: 'Anna',
    });
    expect(people.find((p) => p.id === a.id)).toEqual({
      id: a.id,
      name: 'Anna',
      isAdmin: true,
      isManager: true,
    });
  });

  it('gives B the manager notification mode and the ticket watch, and takes both back', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g.id, a.id);
    expect(await getEffectiveGroupMode(db, asActor(b), g.id)).toBe('mentions');
    expect(await ticketWatcherIds(db, g.id)).not.toContain(b.id);

    await start(a.id, b.id, a);
    expect(await settingsRow(b.id, g.id)).toEqual({ mode: 'all', origin: 'manager' });
    expect(await getEffectiveGroupMode(db, asActor(b), g.id)).toBe('all');
    expect(await watchesTickets(db, asActor(b), g.id)).toBe(true);
    expect(await ticketWatcherIds(db, g.id)).toContain(b.id);

    await endSubstitution(db, a.id, by(a));
    expect(await settingsRow(b.id, g.id)).toBeNull();
    expect(await getEffectiveGroupMode(db, asActor(b), g.id)).toBe('mentions');
    expect(await ticketWatcherIds(db, g.id)).not.toContain(b.id);
  });

  it("keeps B's own mode choice through the start and the end", async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g.id, a.id);
    await setGroupMode(db, b.id, g.id, 'off');
    await start(a.id, b.id, a);
    expect(await settingsRow(b.id, g.id)).toEqual({ mode: 'off', origin: 'user' });
    await endSubstitution(db, a.id, by(a));
    expect(await settingsRow(b.id, g.id)).toEqual({ mode: 'off', origin: 'user' });
  });

  it('the end removes only what the substitution added', async () => {
    const [before, derived, during] = [await newGroup(), await newGroup(), await newGroup()];
    const a = await newAdmin('Anna');
    const b = await newAdmin('Boris');
    for (const g of [before, derived, during]) await addManager(db, g.id, a.id);
    await addManager(db, before.id, b.id); // B managed it already
    await start(a.id, b.id, a);
    // B's own row stays own: no label.
    const people = await listGroupPeople(db, before.id);
    expect(people.find((p) => p.id === b.id)?.substitutesFor).toBeUndefined();
    // Someone makes B a manager of `during` on their own during the substitution.
    await addManager(db, during.id, b.id, by(a));
    expect(
      (await listGroupPeople(db, during.id)).find((p) => p.id === b.id)?.substitutesFor,
    ).toBeUndefined();

    const { ended, changedGroupIds } = await endSubstitution(db, a.id, by(a));
    expect(ended).toBe(true);
    expect(changedGroupIds).toEqual([derived.id]);
    expect((await managedGroupIds(db, b.id)).sort()).toEqual([before.id, during.id].sort());
    expect((await managedGroupIds(db, a.id)).sort()).toEqual(
      [before.id, derived.id, during.id].sort(),
    );
    expect(await settingsRow(b.id, before.id)).toEqual({ mode: 'all', origin: 'manager' });
  });

  it('covers a group A starts managing during it, and drops one A stops managing', async () => {
    const [g1, g2] = [await newGroup(), await newGroup()];
    const a = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g1.id, a.id);
    await start(a.id, b.id, a);

    const added = await addManager(db, g2.id, a.id, by(a));
    expect(added.managers.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(await isGroupManager(db, g2.id, b.id)).toBe(true);

    const removed = await removeManager(db, g1.id, a.id, by(a));
    expect(removed.managers).toEqual([]);
    expect(await isGroupManager(db, g1.id, b.id)).toBe(false);
    expect(await settingsRow(b.id, g1.id)).toBeNull();
  });

  it('B covering two admins of the same group stays its manager until both end', async () => {
    const g = await newGroup();
    const a1 = await newAdmin();
    const a2 = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g.id, a1.id);
    await addManager(db, g.id, a2.id);
    await start(a1.id, b.id, a1);
    await start(a2.id, b.id, a2);
    expect((await endSubstitution(db, a1.id, by(a1))).changedGroupIds).toEqual([]);
    expect(await isGroupManager(db, g.id, b.id)).toBe(true);
    expect((await endSubstitution(db, a2.id, by(a2))).changedGroupIds).toEqual([g.id]);
    expect(await isGroupManager(db, g.id, b.id)).toBe(false);
  });

  it('is not transitive: B covers only the groups A manages on their own', async () => {
    const [own, covered] = [await newGroup(), await newGroup()];
    const a = await newAdmin();
    const b = await newAdmin();
    const c = await newAdmin();
    await addManager(db, own.id, a.id);
    await addManager(db, covered.id, c.id);
    await start(c.id, a.id, c); // A substitutes C
    expect(await isGroupManager(db, covered.id, a.id)).toBe(true);
    await start(a.id, b.id, a); // B substitutes A
    expect(await managedGroupIds(db, b.id)).toEqual([own.id]);
  });

  it('refuses chains, self, inactive people, a second one and a past end date', async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const c = await newAdmin();
    await expect(start(a.id, a.id, a)).rejects.toBeInstanceOf(InvalidSubstituteError);
    await expect(start(a.id, randomUUID(), a)).rejects.toBeInstanceOf(InvalidSubstituteError);
    await expect(start(randomUUID(), b.id, a)).rejects.toBeInstanceOf(SubstitutedNotFoundError);
    const off = await newAdmin();
    await deactivateUser(db, off.id);
    await expect(start(a.id, off.id, a)).rejects.toBeInstanceOf(InvalidSubstituteError);
    await expect(start(off.id, b.id, a)).rejects.toBeInstanceOf(SubstitutedNotFoundError);
    await expect(start(a.id, b.id, a, '2026-10-18')).rejects.toBeInstanceOf(EndsInPastError);

    await start(a.id, b.id, a, TODAY);
    await expect(start(a.id, c.id, a)).rejects.toBeInstanceOf(AlreadySubstitutedError);
    // A is away: A cannot substitute anyone.
    await expect(start(c.id, a.id, c)).rejects.toBeInstanceOf(SubstituteAwayError);
    // B substitutes A and may be substituted too (by C, for B's own groups).
    await expect(start(b.id, c.id, b)).resolves.toBeTruthy();
  });

  it('writes started and ended to the audit log with the author', async () => {
    const a = await newAdmin('Anna');
    const b = await newAdmin('Boris');
    const author = await newAdmin('Cyril');
    const { substitution } = await start(a.id, b.id, author, '2026-10-30');
    await endSubstitution(db, a.id, by(author));
    const rows = await auditRowsOf(db, substitution.id);
    expect(rows.map((r) => r.action)).toEqual(['started', 'ended']);
    expect(rows[0]).toMatchObject({
      entityType: 'substitution',
      entityLabel: 'Anna',
      actorUserId: author.id,
      groupId: null,
      changes: {
        substituted: { to: { id: a.id, label: 'Anna' } },
        substitute: { to: { id: b.id, label: 'Boris' } },
        endsOn: { to: '2026-10-30' },
      },
    });
    expect(rows[1]).toMatchObject({ entityType: 'substitution', actorUserId: author.id });
  });

  it('ending is idempotent', async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    await start(a.id, b.id, a);
    expect((await endSubstitution(db, a.id, by(a))).ended).toBe(true);
    expect(await endSubstitution(db, a.id, by(a))).toEqual({ ended: false, changedGroupIds: [] });
    // A new one can start after the end.
    await expect(start(a.id, b.id, a)).resolves.toBeTruthy();
  });

  it('expires the day after its end date, once, with the system as author', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g.id, a.id);
    const { substitution } = await start(a.id, b.id, a, TODAY);
    expect(await expireSubstitutions(db, TODAY)).toBe(0); // the last day still counts
    expect(await isGroupManager(db, g.id, b.id)).toBe(true);
    expect(await expireSubstitutions(db, '2026-10-20')).toBeGreaterThanOrEqual(1);
    expect(await isGroupManager(db, g.id, b.id)).toBe(false);
    expect((await activeSubstitutions(db)).has(a.id)).toBe(false);
    const ended = await auditRowsOf(db, substitution.id);
    expect(ended.at(-1)).toMatchObject({ action: 'ended', actorKind: 'system' });
    // A second run finds nothing more of this one.
    const count = ended.length;
    await expireSubstitutions(db, '2026-10-21');
    expect(await auditRowsOf(db, substitution.id)).toHaveLength(count);
  });

  it('the scheduled job ends a substitution past its last day (real clock)', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    await addManager(db, g.id, a.id);
    await startSubstitution(
      db,
      { substitutedId: a.id, substituteId: b.id, endsOn: '2020-01-01' },
      by(a),
      '2020-01-01',
    );
    expect(await isGroupManager(db, g.id, b.id)).toBe(true);
    const run = groupsJobHandlers(db)[SUBSTITUTIONS_EXPIRE_JOB]!;
    await run({});
    await run({}); // idempotent
    expect(await isGroupManager(db, g.id, b.id)).toBe(false);
    expect((await activeSubstitutions(db)).has(a.id)).toBe(false);
  });

  it('an open-ended one never expires', async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    await start(a.id, b.id, a, null);
    await expireSubstitutions(db, '2099-01-01');
    expect((await activeSubstitutions(db)).get(a.id)?.substituteId).toBe(b.id);
  });

  it('deactivating either admin ends their substitutions', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    const c = await newAdmin();
    await addManager(db, g.id, a.id);
    await start(c.id, a.id, c); // A substitutes C
    await start(a.id, b.id, a); // and is substituted by B
    const changed = await endSubstitutionsOf(db, a.id, systemActor('test'));
    expect(changed).toContain(g.id);
    const active = await activeSubstitutions(db);
    expect(active.has(a.id)).toBe(false);
    expect(active.has(c.id)).toBe(false);
    expect(await isGroupManager(db, g.id, b.id)).toBe(false);
  });

  it('never touches the finance right', async () => {
    const g = await newGroup();
    const a = await newAdmin();
    const b = await newAdmin();
    await db.update(user).set({ financeAccessAt: new Date() }).where(eq(user.id, a.id));
    await addManager(db, g.id, a.id);
    await start(a.id, b.id, a);
    const [row] = await db
      .select({ financeAccessAt: user.financeAccessAt })
      .from(user)
      .where(eq(user.id, b.id));
    expect(row?.financeAccessAt).toBeNull();
  });
});
