import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { verification } from './schema.js';
import { deleteExpiredVerifications } from './service.js';

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

    expect(
      await deleteExpiredVerifications(db, new Date(Date.now() - 5 * 60_000)),
    ).toBeGreaterThanOrEqual(1);

    const left = async (id: string) =>
      (await db.select().from(verification).where(eq(verification.id, id))).length;
    expect(await left(expired)).toBe(0);
    expect(await left(live)).toBe(1);
  });
});
