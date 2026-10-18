import { describe, expect, it } from 'vitest';
import { taskLink, ticketLink } from './workload-links';

describe('taskLink', () => {
  it('opens the board for the admin and the client', () => {
    expect(taskLink({ userId: 'u2', self: false, groupId: 'g1' }, false)).toEqual({
      to: '/tasks',
      search: { clients: 'g1', assignee: 'u2' },
    });
  });
  it('uses me on the viewer’s own row, due=overdue for overdue, clients=all for an admin row', () => {
    expect(taskLink({ userId: 'u1', self: true, groupId: 'all' }, true)).toEqual({
      to: '/tasks',
      search: { clients: 'all', assignee: 'me', due: 'overdue' },
    });
  });
  it('has no link for the tickets without a client', () => {
    expect(taskLink({ userId: 'u2', self: false, groupId: null }, false)).toBeNull();
  });
});

describe('ticketLink', () => {
  it('links only on the viewer’s own rows', () => {
    expect(ticketLink({ self: false, groupId: 'g1' })).toBeNull();
    expect(ticketLink({ self: true, groupId: 'g1' })).toEqual({
      to: '/tickets',
      search: { assignee: 'me', clients: 'g1' },
    });
    expect(ticketLink({ self: true, groupId: 'all' })).toEqual({
      to: '/tickets',
      search: { assignee: 'me', clients: 'all' },
    });
    expect(ticketLink({ self: true, groupId: null })).toBeNull();
  });
});
