import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { addAdmin } from '../users/service.js';
import { financeItems } from './schema.js';
import {
  monthAfter,
  monthStart,
  monthsOf,
  scopeOfClients,
  scopeSql,
  withoutGroup,
} from './scope.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('months', () => {
  it('bounds and lists a range across a year end', () => {
    expect(monthStart('2026-10')).toBe('2026-10-01');
    expect(monthAfter('2026-10')).toBe('2026-11-01');
    expect(monthAfter('2026-12')).toBe('2027-01-01');
    expect(monthsOf({ from: '2026-11', to: '2027-02' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsOf({ from: '2026-05', to: '2026-05' })).toEqual(['2026-05']);
  });
});

describe('scopeSql', () => {
  it('filters a group_id column by one client, several, none or all', async () => {
    const mk = () =>
      createGroup(db, {
        name: 'S',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
    const [a, b, c] = [await mk(), await mk(), await mk()];
    const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'A' });
    const tag = randomUUID();
    for (const g of [a, b, c]) {
      await db
        .insert(financeItems)
        .values({ id: randomUUID(), groupId: g.id, type: 'note', title: tag, createdBy: admin.id });
    }
    const groupsOf = async (where: ReturnType<typeof scopeSql>) =>
      (
        await db
          .select({ groupId: financeItems.groupId })
          .from(financeItems)
          .where(and(eq(financeItems.title, tag), where))
      )
        .map((r) => r.groupId)
        .sort();

    expect(
      await groupsOf(scopeSql(financeItems.groupId, { kind: 'group', groupId: a.id })),
    ).toEqual([a.id]);
    expect(
      await groupsOf(scopeSql(financeItems.groupId, { kind: 'groups', groupIds: [a.id, c.id] })),
    ).toEqual([a.id, c.id].sort());
    expect(
      await groupsOf(scopeSql(financeItems.groupId, { kind: 'groups', groupIds: [] })),
    ).toEqual([]);
    expect(await groupsOf(scopeSql(financeItems.groupId, { kind: 'all' }))).toEqual(
      [a.id, b.id, c.id].sort(),
    );
    // Every client but one (the admin group, Phase 34 part E).
    expect(await groupsOf(scopeSql(financeItems.groupId, { kind: 'all', except: b.id }))).toEqual(
      [a.id, c.id].sort(),
    );
    expect(scopeOfClients([])).toEqual({ kind: 'all' });
    expect(scopeOfClients([a.id])).toEqual({ kind: 'groups', groupIds: [a.id] });
  });

  it('every client includes the admin group unless unticked; the rankings never take it (Phase 34 E)', () => {
    const off = { id: 'adm', internal: false };
    const on = { id: 'adm', internal: true };
    expect(scopeOfClients([], off)).toEqual({ kind: 'all', except: 'adm' });
    expect(scopeOfClients([], on)).toEqual({ kind: 'all' });
    expect(scopeOfClients(['x'], off)).toEqual({ kind: 'groups', groupIds: ['x'] });
    expect(scopeOfClients(['x'], on)).toEqual({ kind: 'groups', groupIds: ['x'] });
    // Among chosen clients, only when named.
    expect(scopeOfClients(['adm'], off)).toEqual({ kind: 'groups', groupIds: ['adm'] });
    expect(scopeOfClients([], { id: null, internal: false })).toEqual({ kind: 'all' });
    expect(scopeOfClients([])).toEqual({ kind: 'all' });

    expect(withoutGroup({ kind: 'all' }, 'adm')).toEqual({ kind: 'all', except: 'adm' });
    expect(withoutGroup({ kind: 'groups', groupIds: ['x', 'adm'] }, 'adm')).toEqual({
      kind: 'groups',
      groupIds: ['x'],
    });
    expect(withoutGroup({ kind: 'all' }, null)).toEqual({ kind: 'all' });
  });
});
