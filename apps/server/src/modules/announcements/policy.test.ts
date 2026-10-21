import { describe, expect, it } from 'vitest';
import type { AnnouncementSectionId, SessionUser } from '@spolu/shared';
import { canSeeAnnouncementSection, type AnnouncementAudience } from './policy.js';

const user = (role: SessionUser['role'], finance = false): SessionUser => ({
  id: role,
  email: `${role}@example.com`,
  name: role,
  role,
  finance,
});

const audience = (
  actor: SessionUser,
  opts: Partial<Omit<AnnouncementAudience, 'actor'>> = {},
): AnnouncementAudience => ({ actor, clientGroupIds: [], taskSplitOn: true, ...opts });

const superadmin = audience(user('superadmin'));
const admin = audience(user('admin'));
const financeAdmin = audience(user('admin', true));
const client = audience(user('client'), { clientGroupIds: ['g1'] });
// A ziadatel (or a client whose groups all went) has no client group: no board.
const ziadatel = audience(user('client'));
// A client session can never carry the finance right into a section.
const clientWithFlag = audience(user('client', true), { clientGroupIds: ['g1'] });

describe('announcement sections policy', () => {
  it.each<[string, AnnouncementAudience, AnnouncementSectionId, boolean]>([
    ['superadmin', superadmin, 'taskSplit', true],
    ['superadmin', superadmin, 'snippets', true],
    ['superadmin', superadmin, 'bulkEmail', true],
    ['superadmin', superadmin, 'finance', true],
    ['admin', admin, 'taskSplit', true],
    ['admin', admin, 'snippets', true],
    ['admin', admin, 'bulkEmail', true],
    ['admin', admin, 'finance', false],
    ['finance admin', financeAdmin, 'finance', true],
    ['client', client, 'taskSplit', true],
    ['client', client, 'snippets', false],
    ['client', client, 'bulkEmail', false],
    ['client', client, 'finance', false],
    ['client with a finance flag', clientWithFlag, 'finance', false],
    ['ziadatel', ziadatel, 'taskSplit', false],
    ['ziadatel', ziadatel, 'snippets', false],
    ['ziadatel', ziadatel, 'bulkEmail', false],
    ['ziadatel', ziadatel, 'finance', false],
  ])('%s sees %s: %s', (_label, who, section, expected) => {
    expect(canSeeAnnouncementSection(section, who)).toBe(expected);
  });

  it('hides the task generation while the AI is off', () => {
    expect(canSeeAnnouncementSection('taskSplit', { ...admin, taskSplitOn: false })).toBe(false);
    expect(canSeeAnnouncementSection('taskSplit', { ...client, taskSplitOn: false })).toBe(false);
  });
});
