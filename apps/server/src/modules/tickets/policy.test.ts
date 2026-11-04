import { describe, expect, it } from 'vitest';
import type { MemberRole, Role, SessionUser } from '@spolu/shared';
import {
  canAssignTicket,
  canBeTicketAssignee,
  canCreateTicket,
  canDraftTicketReply,
  canEditTicket,
  canReadTicket,
  canSplitTicket,
  canConfirmTicket,
  canMarkTicketDone,
  canRateTicket,
  canSeeTicketRatings,
  canSeeRequesterAccount,
  canSetRequester,
  ratingEditableUntil,
  ratingOpen,
  startsTicketOnOpen,
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

describe('canSetRequester (a ticket on behalf of another person, 2026-10-23)', () => {
  it.each([
    ['admin, any client', actor('admin'), null, true],
    ['superadmin', actor('superadmin'), null, true],
    ['manager (client role) of the group', actor('client'), 'client', true],
    ['ziadatel of the group', actor('client'), 'ziadatel', false],
    // roleIn answers null for a manager of another group, a removed membership and a
    // deactivated group alike.
    ['manager of another group, removed member or deactivated group', actor('client'), null, false],
  ] as const)('%s', (_, who, role, expected) => {
    expect(canSetRequester(who, role as MemberRole | null)).toBe(expected);
  });
});

describe('canSeeRequesterAccount (requester.userId in the ticket DTO)', () => {
  it.each([
    ['admin', actor('admin'), inGroup, true],
    ['superadmin, ticket without client', actor('superadmin'), noClient, true],
    ['the requester themself', actor('client'), mine, true],
    ['a manager of the group', actor('client'), inGroup, false],
    ['a client on a ticket without requester account', actor('client'), noClient, false],
  ] as const)('%s', (_, who, ticket, expected) => {
    expect(canSeeRequesterAccount(who, ticket)).toBe(expected);
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

describe('canRateTicket (2026-10-19)', () => {
  const ticket = { groupId: 'g1', requesterUserId: 'me' };
  it('the initiator who reads the ticket rates it, as a ziadatel or a client', () => {
    expect(canRateTicket(actor('client'), ticket, 'ziadatel')).toBe(true);
    expect(canRateTicket(actor('client'), ticket, 'client')).toBe(true);
  });

  it('nobody else: another client, an admin initiator, a removed initiator', () => {
    expect(canRateTicket(actor('client', 'other'), ticket, 'client')).toBe(false);
    expect(canRateTicket(actor('admin'), ticket, null)).toBe(false);
    expect(canRateTicket(actor('superadmin'), ticket, null)).toBe(false);
    expect(canRateTicket(actor('client'), ticket, null)).toBe(false);
    expect(canRateTicket(actor('client'), { groupId: null, requesterUserId: 'me' }, null)).toBe(
      false,
    );
  });
});

describe('ratingOpen (2026-10-19)', () => {
  const at = new Date('2026-10-01T10:00:00Z');
  it('is open while resolved and up to 14 days after resolving', () => {
    expect(
      ratingOpen({ status: 'resolved', resolvedAt: at }, new Date('2026-10-15T10:00:00Z')),
    ).toBe(true);
    expect(
      ratingOpen({ status: 'resolved', resolvedAt: at }, new Date('2026-10-15T10:00:01Z')),
    ).toBe(false);
  });

  it('is closed while the ticket is open', () => {
    expect(ratingOpen({ status: 'in_progress', resolvedAt: null }, at)).toBe(false);
    expect(ratingOpen({ status: 'new', resolvedAt: at }, at)).toBe(false);
  });
});

it('ratingEditableUntil adds 14 days', () => {
  expect(ratingEditableUntil(new Date('2026-10-01T10:00:00Z')).toISOString()).toBe(
    '2026-10-15T10:00:00.000Z',
  );
});

it('canSeeTicketRatings: every admin, nobody else (owner decision 2026-10-19)', () => {
  expect(canSeeTicketRatings(actor('admin'))).toBe(true);
  expect(canSeeTicketRatings({ ...actor('admin'), finance: true })).toBe(true);
  expect(canSeeTicketRatings(actor('superadmin'))).toBe(true);
  expect(canSeeTicketRatings(actor('client'))).toBe(false);
});

describe('canDraftTicketReply', () => {
  it('admins only', () => {
    expect(canDraftTicketReply(actor('admin'))).toBe(true);
    expect(canDraftTicketReply(actor('superadmin'))).toBe(true);
    expect(canDraftTicketReply(actor('client'))).toBe(false);
  });
});

describe('canConfirmTicket (2026-11-04): the same people as canRateTicket', () => {
  const ticket = { groupId: 'g1', requesterUserId: 'me' };
  it.each([
    ['a ziadatel initiator', actor('client'), ticket, 'ziadatel'],
    ['a client initiator', actor('client'), ticket, 'client'],
    ['another client', actor('client', 'other'), ticket, 'client'],
    ['an admin initiator', actor('admin'), ticket, null],
    ['a superadmin initiator', actor('superadmin'), ticket, null],
    ['a removed initiator', actor('client'), ticket, null],
    ['a ticket without a client', actor('client'), { groupId: null, requesterUserId: 'me' }, null],
    ['a ziadatel on someone else’s ticket', actor('client'), inGroup, 'ziadatel'],
  ] as const)('%s', (_, who, t, role) => {
    expect(canConfirmTicket(who, t, role as MemberRole | null)).toBe(
      canRateTicket(who, t, role as MemberRole | null),
    );
  });
});

describe('canMarkTicketDone (2026-11-04)', () => {
  it('admins only', () => {
    expect(canMarkTicketDone(actor('admin'))).toBe(true);
    expect(canMarkTicketDone(actor('superadmin'))).toBe(true);
    expect(canMarkTicketDone(actor('client'))).toBe(false);
  });
});

describe('startsTicketOnOpen (2026-11-04)', () => {
  const fresh = { groupId: 'g1', requesterUserId: 'z', status: 'new', createdBy: 'other' } as const;
  it('a riešiteľ admin opens a new ticket with a client', () => {
    expect(startsTicketOnOpen(actor('admin'), fresh, true, true)).toBe(true);
  });
  it('any admin, while the ticket has no riešitelia', () => {
    expect(startsTicketOnOpen(actor('admin'), fresh, false, false)).toBe(true);
    expect(startsTicketOnOpen(actor('superadmin'), fresh, false, false)).toBe(true);
  });
  it.each([
    ['a non-riešiteľ admin when it has riešitelia', actor('admin'), fresh, false, true],
    ['a client', actor('client'), fresh, true, true],
    ['a ticket in progress', actor('admin'), { ...fresh, status: 'in_progress' }, true, true],
    ['a resolved ticket', actor('admin'), { ...fresh, status: 'resolved' }, true, true],
    ['a ticket without a client', actor('admin'), { ...fresh, groupId: null }, false, false],
    ['the admin who created it', actor('admin', 'other'), fresh, true, true],
  ] as const)('not: %s', (_, who, t, isAssignee, hasAssignees) => {
    expect(startsTicketOnOpen(who, t, isAssignee, hasAssignees)).toBe(false);
  });
});
