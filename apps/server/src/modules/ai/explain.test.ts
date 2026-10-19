import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { teamRepliesOfTicketsSql } from '../chat/messages.js';
import { homeVolumeIds } from '../home/test-volume.js';
import { draftKnowledgeSql } from '../knowledge/draft-sources.js';
import { searchVolumeIds } from '../search/test-volume.js';
import { similarResolvedTicketsSql } from '../tickets/similar.js';

// "Navrhnúť odpoveď" (2026-10-19): the retrieval of a ticket draft on this run's clones of the
// volumes' templates (test/setup-explain-db.ts, ADR 0040). The knowledge and the similar tickets
// read the search volume (50 000 notes, 100 000 tickets with words of every day, a ninth of them
// accented); the team answers the home volume (200 000 messages).
const search = createDb(inject('explainDatabaseUrls').search);
const home = createDb(inject('explainDatabaseUrls').home);
afterAll(() => Promise.all([search.close(), home.close()]));

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time': number };

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/**
 * Asserts that `query` reads none of `tables` with a sequential scan (always checked). The bound
 * in milliseconds is wall time, so it only runs with `RUN_BENCH=1`: one warm-up, best of three.
 */
async function expectIndexed(tx: Db, query: SQL, tables: string[], ms: number): Promise<void> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plans[0], null, 1));
  const scanned = seqScans(plans[0]!.Plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH) expect(time).toBeLessThan(ms);
}

class Rollback extends Error {}

describe('ticket draft retrieval query plans', () => {
  it(
    'reads knowledge, similar tickets and team answers through indexes',
    { timeout: 300_000 },
    async () => {
      const { groupIds } = searchVolumeIds();
      const terms = ['rozpoc', 'ziados', 'poznam'];
      for (const groupId of [groupIds[0]!, null]) {
        await expectIndexed(
          search.db,
          draftKnowledgeSql({ groupId, terms }),
          ['knowledge_items'],
          20,
        );
      }
      // The similar tickets score every resolved ticket of every client that holds a term: here
      // 25 714 of the 90 000 (each seeded word is in a seventh of the subjects), each folded by
      // `spolu_fold` in the recheck. About 30 ms; even stored folded columns took 20 ms, so the
      // bound is 50 ms, not 20 (docs/architecture/performance.md, 2026-10-19).
      for (const groupId of [groupIds[0]!, null]) {
        await expectIndexed(
          search.db,
          similarResolvedTicketsSql({
            ticketId: 'none',
            groupId,
            terms: ['audit', 'zmluva', 'platba'],
            limit: 3,
          }),
          ['tickets'],
          50,
        );
      }

      // The home volume has group chats only: three of them become ticket chats (2 000 messages
      // each) in a transaction that is rolled back. Its 100 channels are read whole (cheaper than
      // the index at that size); the check is that `messages` is read by channel.
      const { groupIds: homeGroups } = homeVolumeIds();
      const ticketIds = homeGroups.slice(0, 3).map((g) => g.replace(/-g(\d+)$/, '-k$1'));
      await expect(
        home.db.transaction(async (tx) => {
          await tx.execute(sql`
          update channels set kind = 'ticket', ticket_id = replace(group_id, '-g', '-k')
          where group_id in (${sql.join(
            homeGroups.slice(0, 3).map((g) => sql`${g}`),
            sql`, `,
          )}) and kind = 'group'`);
          await expectIndexed(
            tx as unknown as Db,
            teamRepliesOfTicketsSql(ticketIds, 5),
            ['messages'],
            20,
          );
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    },
  );
});
