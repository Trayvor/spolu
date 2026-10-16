import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canDeleteItem, canEditItem, canReadItem, canSetVisibility } from './policy.js';

const actor = (role: Role, id = 'actor'): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
});
const pub = { groupId: 'g1', visibility: 'public' as const, createdBy: 'author' };
const hidden = { ...pub, visibility: 'admins' as const };

describe('knowledge policy', () => {
  it('clients read public items of their group only', () => {
    expect(canReadItem(actor('client'), pub, ['g1'])).toBe(true);
    expect(canReadItem(actor('client'), pub, ['g2'])).toBe(false);
    expect(canReadItem(actor('client'), pub, [])).toBe(false);
    expect(canReadItem(actor('client'), hidden, ['g1'])).toBe(false);
  });

  it('admins read admins-only items', () => {
    expect(canReadItem(actor('admin'), hidden, [])).toBe(true);
    expect(canReadItem(actor('superadmin'), hidden, [])).toBe(true);
  });

  it('author and admins edit; another client cannot', () => {
    expect(canEditItem(actor('client', 'author'), pub, ['g1'])).toBe(true);
    expect(canEditItem(actor('admin'), pub, [])).toBe(true);
    expect(canEditItem(actor('admin'), hidden, [])).toBe(true);
    expect(canEditItem(actor('client', 'other'), pub, ['g1'])).toBe(false);
    // The author in another group (moved out) cannot edit either.
    expect(canEditItem(actor('client', 'author'), pub, ['g2'])).toBe(false);
    expect(canDeleteItem).toBe(canEditItem);
  });

  it('a client cannot set admins', () => {
    expect(canSetVisibility(actor('client'), null, 'admins')).toBe(false);
    expect(canSetVisibility(actor('client'), { authorIsClient: true }, 'admins')).toBe(false);
    expect(canSetVisibility(actor('client'), null, 'public')).toBe(true);
  });

  it("an admin cannot make a client's item admins-only", () => {
    expect(canSetVisibility(actor('admin'), { authorIsClient: true }, 'admins')).toBe(false);
    expect(canSetVisibility(actor('admin'), { authorIsClient: true }, 'public')).toBe(true);
  });

  it("an admin's item can switch either way by any admin", () => {
    expect(canSetVisibility(actor('admin'), null, 'admins')).toBe(true);
    expect(canSetVisibility(actor('admin', 'x'), { authorIsClient: false }, 'admins')).toBe(true);
    expect(canSetVisibility(actor('superadmin'), { authorIsClient: false }, 'public')).toBe(true);
  });
});
