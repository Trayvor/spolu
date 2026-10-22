import { afterAll, describe, inject, it } from 'vitest';
import { expectIndexed } from '../../../test/explain.js';
import { createDb } from '../../infra/db/client.js';
import { searchVolumeIds } from '../search/test-volume.js';
import { groupPageSql } from './service.js';

// This run's clone of the search volume's template (test/setup-explain-db.ts, ADR 0040): 3 000
// groups with 50 000 knowledge notes, 100 000 tasks and 100 000 tickets.
const { db, close } = createDb(inject('explainDatabaseUrls').search);
afterAll(() => close());

const TABLES = ['knowledge_items', 'tasks', 'tickets', 'groups', 'user', 'knowledge_attachments'];

/**
 * The Knowledge tab's page (2026-10-22, ticket and task files): the folder view's top level, the
 * automatic file types and a search read the group's indexes; the ticket and task of a row are
 * joined by their keys. Under 30 ms each with `RUN_BENCH=1`.
 */
describe('knowledge list query plans on a seeded volume', () => {
  it('the folder view and the automatic types read indexes', { timeout: 300_000 }, async () => {
    const groupId = searchVolumeIds().groupIds[7]!;
    for (const admin of [true, false]) {
      for (const opts of [
        { folder: null },
        { types: ['ticket_file' as const, 'task_file' as const] },
        { types: ['chat_file' as const] },
        { types: ['chat_file' as const], chats: 'all' as const },
        { q: 'poznamka' },
      ]) {
        await expectIndexed(db, groupPageSql(groupId, admin, opts), TABLES, 30);
      }
    }
  });
});
