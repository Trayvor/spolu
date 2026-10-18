import { describe, expect, it } from 'vitest';
import type { Me } from '@spolu/shared';
import { bottomNavPlan, isFullScreenPath } from './bottom-nav-plan';

const group = (id: string, role: 'client' | 'ziadatel') => ({
  id,
  name: `G ${id}`,
  role,
  hasLogo: false,
  updatedAt: '',
});
const me = (role: Me['role'], groups: Me['groups'] = [], finance = false): Me => ({
  id: 'u1',
  name: 'Eva',
  email: 'eva@example.com',
  role,
  finance,
  groups,
});
const keys = (list: readonly { key: string }[] | undefined) => list?.map((i) => i.key);

describe('bottomNavPlan', () => {
  it('gives an admin Home, Groups, Tasks, Tickets and the rest behind More', () => {
    const plan = bottomNavPlan(me('admin'), '/tasks');
    expect(keys(plan?.items)).toEqual(['home', 'groups', 'tasks', 'tickets']);
    expect(keys(plan?.more)).toEqual(['knowledge', 'admins', 'bulkEmail']);
    expect(plan?.moreCurrent).toBeUndefined();
  });

  it('adds Financie to More for a finance admin and marks More current there', () => {
    const plan = bottomNavPlan(me('admin', [], true), '/finance');
    expect(keys(plan?.more)).toEqual(['knowledge', 'finance', 'admins', 'bulkEmail']);
    expect(plan?.moreCurrent?.key).toBe('finance');
  });

  it('gives a client Chat, Tasks, Tickets and Knowledge of their only group', () => {
    const plan = bottomNavPlan(me('client', [group('g1', 'client')]), '/settings');
    expect(keys(plan?.items)).toEqual(['chat', 'groupTasks', 'groupTickets', 'knowledge']);
    expect(plan?.items.every((i) => 'groupId' in i && i.groupId === 'g1')).toBe(true);
    expect(keys(plan?.more)).toEqual(['overview', 'members']);
  });

  it('follows the group in the URL for a client of several, and remembers it', () => {
    const user = me('client', [group('g1', 'client'), group('g2', 'client')]);
    expect(bottomNavPlan(user, '/my-groups')).toBeNull();
    const plan = bottomNavPlan(user, '/groups/g2/knowledge');
    expect(plan?.items[0]).toMatchObject({ key: 'chat', groupId: 'g2' });
    expect(keys(plan?.more)).toEqual(['overview', 'members', 'myGroups']);
    // On another screen it keeps leading into the last group.
    expect(bottomNavPlan(user, '/settings')?.items[0]).toMatchObject({ groupId: 'g2' });
    expect(bottomNavPlan(user, '/my-groups')?.moreCurrent?.key).toBe('myGroups');
  });

  it('gives a requester who is no client no bar', () => {
    expect(bottomNavPlan(me('client', [group('g1', 'ziadatel')]), '/tickets')).toBeNull();
  });

  it('steps aside on full-screen screens', () => {
    expect(bottomNavPlan(me('admin'), '/tickets/k1')).toBeNull();
    expect(isFullScreenPath('/groups/g1/tasks/t1')).toBe(true);
    expect(isFullScreenPath('/groups/g1/tasks')).toBe(false);
    expect(isFullScreenPath('/tickets')).toBe(false);
  });
});
