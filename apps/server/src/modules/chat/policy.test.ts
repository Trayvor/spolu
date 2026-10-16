import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canDeleteMessage, canEditMessage, canReadChannel } from './policy.js';

const actor = (role: Role, id = 'actor'): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
});

describe('canReadChannel', () => {
  it.each([
    ['superadmin', [], true],
    ['admin', [], true],
    ['client', ['g1'], true],
    ['client', ['g2'], false],
    ['client', [], false],
    ['client', ['g2', 'g1'], true],
  ] as const)('%s with membership %s -> %s', (role, membership, expected) => {
    expect(canReadChannel(actor(role), { groupId: 'g1' }, membership)).toBe(expected);
  });
});

describe.each([
  ['canEditMessage', canEditMessage],
  ['canDeleteMessage', canDeleteMessage],
])('%s', (_name, can) => {
  it.each([
    ['author', 'client', 'actor', null, true],
    ['admin author', 'admin', 'actor', null, true],
    ['another client', 'client', 'someone', null, false],
    ['superadmin who is not the author', 'superadmin', 'someone', null, false],
    ['author of a deleted message', 'client', 'actor', new Date(), false],
  ] as const)('%s -> %s', (_label, role, authorId, deletedAt, expected) => {
    expect(can(actor(role), { authorId, deletedAt })).toBe(expected);
  });
});
