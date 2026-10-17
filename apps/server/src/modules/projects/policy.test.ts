import { describe, expect, it } from 'vitest';
import type { MemberRole, Role, SessionUser } from '@spolu/shared';
import {
  canArchiveProject,
  canEditProjects,
  canMergeOrDeleteProject,
  canReadProjects,
  canSetTaskProject,
  canSetTicketProject,
} from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'me',
  email: 'a@x.sk',
  name: 'A',
  role,
  finance: false,
});

/**
 * Every group-scoped rule is the same (decisions 8 and 8a): admins and the group's clients; a
 * žiadateľ never reads the group (`clientGroupIds` leaves their membership out), nor an outsider.
 */
const groupRules = [
  ['canReadProjects', canReadProjects],
  ['canEditProjects', canEditProjects],
  ['canArchiveProject', canArchiveProject],
  ['canMergeOrDeleteProject', canMergeOrDeleteProject],
  ['canSetTaskProject', canSetTaskProject],
] as const;

const groupCases = [
  ['superadmin', actor('superadmin'), [], true],
  ['admin', actor('admin'), [], true],
  ['a client of the group', actor('client'), ['g1'], true],
  ['a žiadateľ of the group (no client membership)', actor('client'), [], false],
  ['a client of another group', actor('client'), ['g2'], false],
] as const;

describe.each(groupRules)('%s', (_, rule) => {
  it.each(groupCases)('%s', (_name, who, groupIds, expected) => {
    expect(rule(who, 'g1', groupIds)).toBe(expected);
  });
});

describe('canSetTicketProject', () => {
  const inGroup = { groupId: 'g1', requesterUserId: 'someone' };
  const own = { groupId: 'g1', requesterUserId: 'me' };
  const noClient = { groupId: null, requesterUserId: null };
  it.each([
    ['admin, on a ticket of a client', actor('admin'), inGroup, null, true],
    ['superadmin, on a ticket of a client', actor('superadmin'), inGroup, null, true],
    ['a client of the ticket’s group', actor('client'), inGroup, 'client', true],
    ['a žiadateľ, even on their own ticket', actor('client'), own, 'ziadatel', false],
    ['an outsider', actor('client'), inGroup, null, false],
    ['admin, on a ticket without a client', actor('admin'), noClient, null, false],
    ['a client, on a ticket without a client', actor('client'), noClient, 'client', false],
  ] as const)('%s', (_, who, ticket, role, expected) => {
    expect(canSetTicketProject(who, ticket, role as MemberRole | null)).toBe(expected);
  });
});
