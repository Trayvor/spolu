import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canAssignTaskTo, canDeleteTask, canManageBuckets, canUseBoard } from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'actor',
  email: 'a@example.com',
  name: 'A',
  role,
  finance: false,
});

describe('canUseBoard', () => {
  it.each([
    ['superadmin', [], true],
    ['admin', [], true],
    ['client', ['g1'], true],
    ['client', ['g2'], false],
    ['client', [], false],
    ['client', ['g2', 'g1'], true],
  ] as const)('%s with membership %s -> %s', (role, membership, expected) => {
    expect(canUseBoard(actor(role), 'g1', membership)).toBe(expected);
  });
});

describe('canManageBuckets', () => {
  it.each([
    ['superadmin', true],
    ['admin', true],
    ['client', false],
  ] as const)('%s -> %s', (role, expected) => {
    expect(canManageBuckets(actor(role))).toBe(expected);
  });
});

describe('canDeleteTask', () => {
  it.each([
    ['superadmin', 'actor', true],
    ['superadmin', 'other', true],
    ['admin', 'actor', true],
    ['admin', 'other', true],
    ['client', 'actor', true],
    ['client', 'other', false],
  ] as const)('%s deleting a task created by %s -> %s', (role, createdBy, expected) => {
    expect(canDeleteTask(actor(role), { createdBy })).toBe(expected);
  });
});

describe('canAssignTaskTo', () => {
  const client = { isAdmin: false, isManager: false };
  const manager = { isAdmin: true, isManager: true };
  const otherAdmin = { isAdmin: true, isManager: false };
  it.each([
    ['superadmin', 'a client of the group', true, client],
    ['superadmin', 'a manager', true, manager],
    ['superadmin', 'an admin who is not a manager', true, otherAdmin],
    ['superadmin', 'no person of the group', false, undefined],
    ['admin', 'a client of the group', true, client],
    ['admin', 'a manager', true, manager],
    ['admin', 'an admin who is not a manager', true, otherAdmin],
    ['admin', 'no person of the group', false, undefined],
    ['client', 'a client of the group', true, client],
    ['client', 'a manager', true, manager],
    ['client', 'an admin who is not a manager', false, otherAdmin],
    ['client', 'no person of the group', false, undefined],
  ] as const)('%s assigning %s -> %s', (role, _label, expected, person) => {
    expect(canAssignTaskTo(actor(role), person)).toBe(expected);
  });
});
