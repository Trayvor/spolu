import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, pingDb } from './client.js';
import { runMigrations } from './migrate.js';
import { appMeta } from './schema.js';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://ehub:ehub@localhost:5432/ehub_test';

describe('database layer', () => {
  const { db, close } = createDb(testUrl);

  beforeAll(async () => {
    await runMigrations(testUrl);
    await db.delete(appMeta);
  });
  afterAll(() => close());

  it('round-trips a row through app_meta after migrations', async () => {
    await db.insert(appMeta).values({ key: 'k', value: 'v' });
    const rows = await db.select().from(appMeta).where(eq(appMeta.key, 'k'));
    expect(rows).toEqual([{ key: 'k', value: 'v' }]);
  });

  it('pingDb is true on a reachable database', async () => {
    expect(await pingDb(db)).toBe(true);
  });

  it('pingDb is false for an unreachable database', async () => {
    const bad = createDb('postgres://x:x@localhost:1/x');
    try {
      expect(await pingDb(bad.db)).toBe(false);
    } finally {
      await bad.close();
    }
  });
});
