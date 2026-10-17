import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createDb } from './client.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

/**
 * Foreign keys to `"user"` need no index: users are disabled, never deleted, so the referencing
 * rows are never looked up through them.
 */
const NEVER_DELETED = ['user'];

describe('foreign key indexes', () => {
  it('every foreign key leads an index, so a delete of the parent never scans the child table', async () => {
    // Without one, every deleted parent row makes PostgreSQL check (cascade, set null or
    // no action) the child table with a sequential scan: deleting a chat channel with 2 000
    // messages took 95 s on 500 000 messages through `messages.parent_id` and `reply_to_id`.
    const rows = await db.execute<{ child: string; columns: string; parent: string }>(sql`
      select c.conrelid::regclass::text as child,
        (select string_agg(a.attname, ',' order by k.n)
          from unnest(c.conkey) with ordinality k(attnum, n)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
        c.confrelid::regclass::text as parent
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
        )
      order by 1, 2
    `);
    const missing = [...rows]
      .filter((r) => !NEVER_DELETED.includes(r.parent.replaceAll('"', '')))
      .map((r) => `${r.child}(${r.columns}) -> ${r.parent}`);
    expect(missing).toEqual([]);
  });
});
