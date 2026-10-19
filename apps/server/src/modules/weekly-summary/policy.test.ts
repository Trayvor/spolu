import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import { canManageWeeklySummary, canReadWeeklySummaries, canSetMyWeeklySummary } from './policy.js';

const actor = (role: Role): SessionUser => ({
  id: 'a',
  email: 'a@example.com',
  name: 'A',
  role,
  finance: false,
});

describe('weekly summary policy', () => {
  it('admins and the superadmin read summaries, clients do not', () => {
    expect(canReadWeeklySummaries(actor('admin'))).toBe(true);
    expect(canReadWeeklySummaries(actor('superadmin'))).toBe(true);
    expect(canReadWeeklySummaries(actor('client'))).toBe(false);
  });

  it('only a managing admin manages', () => {
    expect(canManageWeeklySummary(actor('admin'), true)).toBe(true);
    expect(canManageWeeklySummary(actor('admin'), false)).toBe(false);
    expect(canManageWeeklySummary(actor('superadmin'), false)).toBe(false);
    expect(canManageWeeklySummary(actor('superadmin'), true)).toBe(true);
    expect(canManageWeeklySummary(actor('client'), true)).toBe(false);
  });

  it('a client sets only their own groups', () => {
    expect(canSetMyWeeklySummary(actor('client'), 'g1', ['g1'])).toBe(true);
    expect(canSetMyWeeklySummary(actor('client'), 'g2', ['g1'])).toBe(false);
    expect(canSetMyWeeklySummary(actor('admin'), 'g1', ['g1'])).toBe(false);
  });
});
