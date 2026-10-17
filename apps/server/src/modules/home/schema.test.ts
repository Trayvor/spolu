import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('admin home indexes', () => {
  it('the admin home indexes exist', async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where indexname in (
        'message_mentions_user_created_idx', 'messages_mentions_all_top_idx',
        'messages_mentions_all_reply_idx', 'tasks_open_group_idx'
      )`);
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(Object.keys(byName).sort()).toEqual([
      'message_mentions_user_created_idx',
      'messages_mentions_all_reply_idx',
      'messages_mentions_all_top_idx',
      'tasks_open_group_idx',
    ]);
    expect(byName.message_mentions_user_created_idx).toContain('(user_id, created_at DESC');
    expect(byName.messages_mentions_all_top_idx).toContain('mentions_all');
    expect(byName.messages_mentions_all_top_idx).toContain('parent_id IS NULL');
    expect(byName.messages_mentions_all_reply_idx).toContain('mentions_all');
    expect(byName.messages_mentions_all_reply_idx).toContain('parent_id IS NOT NULL');
    expect(byName.tasks_open_group_idx).toContain('(group_id, completed_at)');
  });
});
