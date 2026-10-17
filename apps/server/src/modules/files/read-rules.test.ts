import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { readableByRule, registerFileReadRule } from './read-rules.js';

const ziadatel: SessionUser = {
  id: 'z',
  email: 'z@example.com',
  name: 'Z',
  role: 'client',
  finance: false,
};
const db = {} as Db;

describe('readableByRule', () => {
  // A rule that opens every file (like the ticket chat's rule for the files of a ticket's chat).
  registerFileReadRule(async () => true);

  it('a registered rule opens a plain file', async () => {
    const file = { id: 'f', groupId: 'g', adminsOnly: false, financeOnly: false };
    expect(await readableByRule(db, ziadatel, file)).toBe(true);
  });

  it('never opens an admins-only or a finance-only file (Phase 32), whatever the rules say', async () => {
    expect(
      await readableByRule(db, ziadatel, {
        id: 'f',
        groupId: 'g',
        adminsOnly: true,
        financeOnly: false,
      }),
    ).toBe(false);
    expect(
      await readableByRule(db, ziadatel, {
        id: 'f',
        groupId: 'g',
        adminsOnly: false,
        financeOnly: true,
      }),
    ).toBe(false);
  });
});
