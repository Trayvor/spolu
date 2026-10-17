import { describe, expect, it } from 'vitest';
import type { MemberRole, Role, SessionUser } from '@spolu/shared';
import {
  canAssignTicket,
  canBeTicketAssignee,
  canCreateTicket,
  canEditTicket,
  canReadTicket,
  canSplitTicket,
  canWatchTickets,
} from './policy.js';

const actor = (role: Role, id = 'me'): SessionUser => ({
  id,
  email: 'a@x.sk',
  name: 'A',
  role,
  finance: false,
});
const inGroup = { groupId: 'g1', requesterUserId: 'someone' };
const mine = { groupId: 'g1', requesterUserId: 'me' };
const noClient = { groupId: null, requesterUserId: null };

describe('canReadTicket', () => {
  it.each([
    ['admin reads a ticket of any group', actor('admin'), inGroup, null, true],
    ['superadmin reads a ticket without client', actor('superadmin'), noClient, null, true],
    ['admin reads a ticket without client', actor('admin'), noClient, null, true],
    ['client reads every ticket of the group', actor('client'), inGroup, 'client', true],
    ['ziadatel reads own ticket', actor('client'), mine, 'ziadatel', true],
    ["ziadatel does not read someone else's ticket", actor('client'), inGroup, 'ziadatel', false],
    ['a client of another group reads nothing', actor('client'), mine, null, false],
    ['nobody but admins reads a ticket without client', actor('client'), noClient, 'client', false],
  ] as const)('%s', (_, who, ticket, role, expected) => {
    expect(canReadTicket(who, ticket, role as MemberRole | null)).toBe(expected);
  });
});

describe('canCreateTicket', () => {
  it.each([
    ['admin', actor('admin'), null, true],
    ['client of the group', actor('client'), 'client', true],
    ['ziadatel', actor('client'), 'ziadatel', false],
    ['outsider', actor('client'), null, false],
  ] as const)('%s', (_, who, role, expected) => {
    expect(canCreateTicket(who, role as MemberRole | null)).toBe(expected);
  });
});

describe('canEditTicket', () => {
  it.each([
    ['superadmin', 'superadmin', true],
    ['admin', 'admin', true],
    ['client', 'client', false],
  ] as const)('%s', (_, role, expected) => {
    expect(canEditTicket(actor(role))).toBe(expected);
  });
});

describe('canSplitTicket', () => {
  it.each([
    ['admin', actor('admin'), inGroup, null, true],
    ['client of the group', actor('client'), inGroup, 'client', true],
    ['ziadatel cannot split even own ticket', actor('client'), mine, 'ziadatel', false],
    ['a ticket without client cannot be split', actor('admin'), noClient, null, false],
  ] as const)('%s', (_, who, ticket, role, expected) => {
    expect(canSplitTicket(who, ticket, role as MemberRole | null)).toBe(expected);
  });
});

describe('canAssignTicket', () => {
  it.each([
    ['admin, ticket of a client', actor('admin'), inGroup, null, true],
    ['superadmin, ticket without client', actor('superadmin'), noClient, null, true],
    ['client of the group', actor('client'), inGroup, 'client', true],
    ['ziadatel, even of their own ticket', actor('client'), mine, 'ziadatel', false],
    ['outsider', actor('client'), inGroup, null, false],
    ['client, ticket without client', actor('client'), noClient, null, false],
  ] as const)('%s', (_, who, ticket, role, expected) => {
    expect(canAssignTicket(who, ticket, role as MemberRole | null)).toBe(expected);
  });
});

describe('canBeTicketAssignee', () => {
  it.each([
    ['an admin, ticket of a client', 'admin', inGroup, null, true],
    ['a superadmin, ticket without client', 'superadmin', noClient, null, true],
    ['a client of the group', 'client', inGroup, 'client', true],
    ['a ziadatel of the group', 'client', inGroup, 'ziadatel', false],
    ['a client of another group', 'client', inGroup, null, false],
    ['a client, ticket without client', 'client', noClient, null, false],
  ] as const)('%s', (_, role, ticket, memberRole, expected) => {
    expect(canBeTicketAssignee(role, ticket, memberRole as MemberRole | null)).toBe(expected);
  });
});

describe('canWatchTickets', () => {
  it.each([
    ['admin', actor('admin'), null, true],
    ['client of the group', actor('client'), 'client', true],
    ['ziadatel of the group', actor('client'), 'ziadatel', false],
    ['outsider', actor('client'), null, false],
  ] as const)('%s', (_, who, role, expected) => {
    expect(canWatchTickets(who, role as MemberRole | null)).toBe(expected);
  });
});
