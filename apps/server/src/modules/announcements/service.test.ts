import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { addAdmin } from '../users/service.js';
import type { AnnouncementDef } from './catalogue.js';
import type { AnnouncementAudience } from './policy.js';
import { currentAnnouncement, markAnnouncementSeen } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('announcements service', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  async function adminAudience(): Promise<AnnouncementAudience> {
    const a = await addAdmin(test.deps.db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    const actor: SessionUser = { ...a, finance: false };
    return { actor, clientGroupIds: [], taskSplitOn: true };
  }

  const catalogue: AnnouncementDef[] = [
    { id: 'new', sections: ['finance', 'snippets'] },
    { id: 'old', sections: ['bulkEmail'] },
  ];

  it('answers the newest announcement with only the sections the person can use', async () => {
    const who = await adminAudience();
    expect(await currentAnnouncement(test.deps.db, who, catalogue)).toEqual({
      id: 'new',
      sections: ['snippets'],
    });
  });

  it('answers nothing once the newest is seen, never an older one', async () => {
    const who = await adminAudience();
    expect(await markAnnouncementSeen(test.deps.db, who.actor.id, 'new', catalogue)).toBe(true);
    expect(await currentAnnouncement(test.deps.db, who, catalogue)).toBeNull();
  });

  it('skips an announcement none of whose sections apply', async () => {
    const who = await adminAudience();
    const onlyFinance: AnnouncementDef[] = [
      { id: 'fin', sections: ['finance'] },
      { id: 'old', sections: ['bulkEmail'] },
    ];
    expect(await currentAnnouncement(test.deps.db, who, onlyFinance)).toEqual({
      id: 'old',
      sections: ['bulkEmail'],
    });
    expect(await currentAnnouncement(test.deps.db, who, [onlyFinance[0]!])).toBeNull();
  });

  it('marks seen once (a repeat changes nothing) and refuses an unknown id', async () => {
    const who = await adminAudience();
    expect(await markAnnouncementSeen(test.deps.db, who.actor.id, 'new', catalogue)).toBe(true);
    expect(await markAnnouncementSeen(test.deps.db, who.actor.id, 'new', catalogue)).toBe(true);
    expect(await markAnnouncementSeen(test.deps.db, who.actor.id, 'nope', catalogue)).toBe(false);
  });
});
