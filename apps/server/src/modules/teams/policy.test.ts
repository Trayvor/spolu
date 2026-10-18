import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import {
  canLinkTeamsMeeting,
  canManageTeamsLink,
  canPlanTeamsSeries,
  canUseTeams,
} from './policy.js';

const person = (role: Role): SessionUser => ({
  id: `${role}-1`,
  email: `${role}@example.com`,
  name: role,
  role,
  finance: role === 'superadmin',
});
const roles: Role[] = ['superadmin', 'admin', 'client'];

describe('Teams policy (T1)', () => {
  it('only admins see Teams, and only while it is configured', () => {
    const matrix = roles.map((r) => [
      r,
      canUseTeams(person(r), true),
      canUseTeams(person(r), false),
    ]);
    expect(matrix).toEqual([
      ['superadmin', true, false],
      ['admin', true, false],
      ['client', false, false],
    ]);
  });

  it('create and connect: admins who edit the item, while it has no Teams meeting', () => {
    const ok = { configured: true, canEditItem: true, linked: false };
    expect(roles.map((r) => canLinkTeamsMeeting(person(r), ok))).toEqual([true, true, false]);
    // A client who edits their own meeting still cannot connect it (the app's power fetches it).
    expect(canLinkTeamsMeeting(person('client'), ok)).toBe(false);
    expect(canLinkTeamsMeeting(person('admin'), { ...ok, linked: true })).toBe(false);
    expect(canLinkTeamsMeeting(person('admin'), { ...ok, canEditItem: false })).toBe(false);
    expect(canLinkTeamsMeeting(person('admin'), { ...ok, configured: false })).toBe(false);
  });

  it('check, replace and disconnect: admins who edit a connected item', () => {
    const ok = { configured: true, canEditItem: true, linked: true };
    expect(roles.map((r) => canManageTeamsLink(person(r), ok))).toEqual([true, true, false]);
    expect(canManageTeamsLink(person('admin'), { ...ok, linked: false })).toBe(false);
    expect(canManageTeamsLink(person('admin'), { ...ok, configured: false })).toBe(false);
  });

  it('a series plan (ADR 0049): admins who edit a call of a series', () => {
    const ok = { configured: true, canEditItem: true, inSeries: true };
    expect(roles.map((r) => canPlanTeamsSeries(person(r), ok))).toEqual([true, true, false]);
    expect(canPlanTeamsSeries(person('admin'), { ...ok, inSeries: false })).toBe(false);
    expect(canPlanTeamsSeries(person('admin'), { ...ok, canEditItem: false })).toBe(false);
    expect(canPlanTeamsSeries(person('admin'), { ...ok, configured: false })).toBe(false);
  });
});
