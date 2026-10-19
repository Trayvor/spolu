import { afterAll, describe, inject, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { expectIndexed } from '../../../test/explain.js';
import { createDb, type Db } from '../../infra/db/client.js';
import { prepareSearch } from '../../infra/text/search.js';
import { groupAccessOf, type GroupAccess } from '../groups/memberships.js';
import { groupSearchSql } from '../groups/search.js';
import { knowledgeSearchSql } from '../knowledge/search.js';
import { projectSearchSql } from '../projects/search.js';
import { taskSearchSql } from '../tasks/search.js';
import { ticketSearchSql } from '../tickets/search.js';
import { peopleSearchSql } from '../users/search.js';
import { searchVolumeIds } from './test-volume.js';

// This run's clone of the search volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').search);
afterAll(() => close());

const TABLES = [
  'groups',
  'tasks',
  'tickets',
  'knowledge_items',
  'projects',
  'project_events',
  'user',
];
const LIMIT = 5;

/**
 * The global search on a seeded volume (3 000 groups, 100 000 tasks and tickets, 50 000 notes,
 * 20 000 projects, 100 000 events): every type's query reads its trigram index, for an admin
 * (every group) and for a client of five groups, under 30 ms each with `RUN_BENCH=1`.
 */
describe('global search query plans on a seeded volume (2026-10-18)', () => {
  it('every type reads its index', { timeout: 300_000 }, async () => {
    const { adminId, clientId } = searchVolumeIds();
    const tx: Db = db;
    const admin: SessionUser = {
      id: adminId,
      email: 'a@x',
      name: 'A',
      role: 'admin',
      finance: false,
    };
    const client: SessionUser = {
      id: clientId,
      email: 'c@x',
      name: 'C',
      role: 'client',
      finance: false,
    };
    const none: GroupAccess = { roles: new Map() };
    const access = await groupAccessOf(tx, clientId);
    for (const q of ['luky 4821', 'kontrola 4821', 'rozpocet 1234', '#4821']) {
      const text = prepareSearch(q);
      for (const [actor, scope] of [
        [admin, none],
        [client, access],
      ] as const) {
        await expectIndexed(tx, groupSearchSql(tx, actor, scope, text, LIMIT).getSQL(), TABLES, 30);
        await expectIndexed(tx, taskSearchSql(tx, actor, scope, text, LIMIT)!.getSQL(), TABLES, 30);
        await expectIndexed(
          tx,
          ticketSearchSql(tx, actor, scope, text, LIMIT)!.getSQL(),
          TABLES,
          30,
        );
        await expectIndexed(
          tx,
          knowledgeSearchSql(tx, actor, scope, text, LIMIT)!.getSQL(),
          TABLES,
          30,
        );
        await expectIndexed(tx, projectSearchSql(actor, scope, text, LIMIT)!, TABLES, 30);
      }
      await expectIndexed(tx, peopleSearchSql(tx, text, LIMIT).getSQL(), TABLES, 30);
    }
  });
});
