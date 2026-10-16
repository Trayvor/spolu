import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canDeleteTask, canManageBuckets, canUseBoard } from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'actor',
  email: 'a@example.com',
  name: 'A',
  role,
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
