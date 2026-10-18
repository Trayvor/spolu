import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { user } from '../users/schema.js';
import { session, verification } from './schema.js';
import { deleteExpiredSessions, deleteExpiredVerifications } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('deleteExpiredVerifications', () => {
  it('deletes only expired rows', async () => {
    const expired = randomUUID();
    const live = randomUUID();
    const row = (id: string, expiresAt: Date) => ({ id, identifier: id, value: 'x', expiresAt });
    await db
      .insert(verification)
      .values([
        row(expired, new Date(Date.now() - 10 * 60_000)),
        row(live, new Date(Date.now() + 60_000)),
      ]);

    // Other test files share this table (and may purge our expired row first), so the
    // returned count is not asserted; only this test's own rows are.
    await deleteExpiredVerifications(db, new Date(Date.now() - 5 * 60_000));

    const left = async (id: string) =>
      (await db.select().from(verification).where(eq(verification.id, id))).length;
    expect(await left(expired)).toBe(0);
    expect(await left(live)).toBe(1);
  });
});

describe('deleteExpiredSessions (2026-10-18)', () => {
  it('deletes only the sessions that expired', async () => {
    const userId = randomUUID();
    await db
      .insert(user)
      .values({ id: userId, email: `${userId}@example.com`, name: 'S', role: 'client' });
    const row = (id: string, expiresAt: Date) => ({ id, token: id, userId, expiresAt });
    const [expired, live] = [randomUUID(), randomUUID()];
    await db
      .insert(session)
      .values([
        row(expired, new Date(Date.now() - 60_000)),
        row(live, new Date(Date.now() + 60_000)),
      ]);

    await deleteExpiredSessions(db);

    const left = async (id: string) =>
      (await db.select().from(session).where(eq(session.id, id))).length;
    expect(await left(expired)).toBe(0);
    expect(await left(live)).toBe(1);
  });
});
