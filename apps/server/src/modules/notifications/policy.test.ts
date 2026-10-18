import { describe, expect, it } from 'vitest';
import type { MemberRole, SessionUser } from '@spolu/shared';
import { canSeeCentreItem } from './policy.js';

const admin = { id: 'a', email: 'a@x', name: 'A', role: 'admin', finance: false } as SessionUser;
const financeAdmin = { ...admin, finance: true } as SessionUser;
const client = { id: 'c', email: 'c@x', name: 'C', role: 'client', finance: false } as SessionUser;
const roles = new Map<string, MemberRole>([
  ['g1', 'client'],
  ['g2', 'ziadatel'],
]);
const none = new Map<string, MemberRole>();

describe('canSeeCentreItem (the notification centre)', () => {
  it('an admin sees every item except finance without the right', () => {
    expect(canSeeCentreItem(admin, { groupId: 'gx', category: 'chat' }, none)).toBe(true);
    expect(canSeeCentreItem(admin, { groupId: null, category: 'tickets' }, none)).toBe(true);
    expect(canSeeCentreItem(admin, { groupId: 'gx', category: 'finance' }, none)).toBe(false);
    expect(canSeeCentreItem(financeAdmin, { groupId: null, category: 'finance' }, none)).toBe(true);
  });

  it('a client sees the items of the groups they are still a client of', () => {
    expect(canSeeCentreItem(client, { groupId: 'g1', category: 'chat' }, roles)).toBe(true);
    expect(canSeeCentreItem(client, { groupId: 'g1', category: 'tasks' }, roles)).toBe(true);
    // Removed from the group since: its chat excerpts are not theirs to read any more.
    expect(canSeeCentreItem(client, { groupId: 'g9', category: 'chat' }, roles)).toBe(false);
    // A requester membership opens only ticket items.
    expect(canSeeCentreItem(client, { groupId: 'g2', category: 'chat' }, roles)).toBe(false);
    expect(canSeeCentreItem(client, { groupId: 'g2', category: 'tickets' }, roles)).toBe(true);
    expect(canSeeCentreItem(client, { groupId: 'g9', category: 'tickets' }, roles)).toBe(false);
    // A ticket without a client: its recorder chose the person (its initiator).
    expect(canSeeCentreItem(client, { groupId: null, category: 'tickets' }, roles)).toBe(true);
    expect(canSeeCentreItem(client, { groupId: null, category: 'chat' }, roles)).toBe(false);
  });

  it('never an unknown kind or a finance item for a client', () => {
    expect(canSeeCentreItem(admin, { groupId: 'g1', category: null }, none)).toBe(false);
    expect(canSeeCentreItem(client, { groupId: 'g1', category: 'finance' }, roles)).toBe(false);
  });
});
