import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { canUseCalendarFeed } from './policy.js';

const user = (role: SessionUser['role']): SessionUser => ({
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  role,
  finance: false,
});

describe('canUseCalendarFeed', () => {
  it('admins and clients with a group use the feed; a requester-only person does not', () => {
    expect(canUseCalendarFeed(user('admin'), [])).toBe(true);
    expect(canUseCalendarFeed(user('superadmin'), [])).toBe(true);
    expect(canUseCalendarFeed(user('client'), ['g1'])).toBe(true);
    expect(canUseCalendarFeed(user('client'), [])).toBe(false);
  });
});
