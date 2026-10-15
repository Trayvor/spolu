import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { FIXED_POSITIONS, isCustomBucketPosition, keyAfter, keysAfter } from './positions.js';
import { buckets } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(close);

describe('positions', () => {
  it('keyAfter(null, null) is a0', () => {
    expect(keyAfter(null, null)).toBe('a0');
  });

  it('keyAfter sorts strictly between its neighbours', () => {
    const key = keyAfter('a0', 'a3');
    expect(key > 'a0' && key < 'a3').toBe(true);
  });

  it('keysAfter returns ascending keys after prev', () => {
    const keys = keysAfter('a0', 3);
    expect(keys).toHaveLength(3);
    expect(keys[0]! > 'a0').toBe(true);
    expect([...keys].sort()).toEqual(keys);
  });

  it('fixed keys are in order', () => {
    const { todo, egrant_review, client_review, done } = FIXED_POSITIONS;
    expect([todo, egrant_review, client_review, done]).toEqual(
      [todo, egrant_review, client_review, done].sort(),
    );
  });

  it('isCustomBucketPosition accepts only keys strictly between To do and Completed', () => {
    expect(isCustomBucketPosition('a0')).toBe(false);
    expect(isCustomBucketPosition('a9')).toBe(false);
    expect(isCustomBucketPosition('a5')).toBe(true);
    expect(isCustomBucketPosition('a0V')).toBe(true);
    expect(isCustomBucketPosition('a3')).toBe(false);
    expect(isCustomBucketPosition('a6')).toBe(false);
    expect(isCustomBucketPosition('Zz')).toBe(false);
  });

  it('positions sort byte-wise in SQL', async () => {
    const group = await createGroup(db, {
      name: 'Positions',
      egrantUrl: `https://${randomUUID()}.egrant.sk`,
    });
    const groupId = group.id;
    await db.insert(buckets).values([
      { id: randomUUID(), groupId, kind: 'custom', name: 'l', position: 'a0l' },
      { id: randomUUID(), groupId, kind: 'custom', name: 'V', position: 'a0V' },
    ]);
    const rows = await db
      .select({ position: buckets.position })
      .from(buckets)
      .where(eq(buckets.groupId, groupId))
      .orderBy(asc(buckets.position));
    expect(rows.map((r) => r.position)).toEqual(['a0V', 'a0l']);
  });
});
