import { afterAll, describe, expect, inject, it } from 'vitest';
import { asc, sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { centreListSql, centreUnreadSql } from '../notifications/centre.js';
import { passWhere } from '../notifications/deliver.js';
import { notificationEvents } from '../notifications/schema.js';
import { taskSummarySql, ticketSummarySql } from '../notifications/unseen.js';
import { boardUnseenSql } from '../tasks/service.js';
import { dashboardTicketsSql, unseenTicketCountSql } from '../tickets/dashboard.js';
import { assignedSql, unseenTaskCountSql } from './assigned.js';
import { bratislavaToday, globalBoardSql } from './global-board.js';
import { allTaskSearchQuery, taskSearchQuery } from '../tasks/attachable.js';
import { mentionsSql } from './mentions.js';
import { sidebarSql } from './sidebar.js';
import { homeVolumeIds } from './test-volume.js';

// This run's clone of the home volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').home);
afterAll(() => close());

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
};

/** Every index read of the plan as `<index>: <condition>`. */
function indexReads(node: PlanNode): string[] {
  const own = node['Index Name'] ? [`${node['Index Name']}: ${node['Index Cond'] ?? ''}`] : [];
  return [...own, ...(node.Plans ?? []).flatMap(indexReads)];
}

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

type Explained = { Plan: PlanNode; 'Execution Time': number };

/**
 * Runs `query` under `explain (analyze, format json)` and asserts that no table of `tables` is
 * read with a sequential scan. That is the deterministic part and always checked. The 50 ms bound
 * is wall time, so it is opt-in (`RUN_BENCH=1`, for a quiet machine): the query runs once to warm
 * the cache and the best of three timed runs counts. `EXPLAIN_DEBUG=1` prints the plan.
 */
async function expectIndexed(tx: Db, query: SQL, tables: string[]): Promise<PlanNode> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const plan = plans[0]!;
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plan, null, 1).slice(0, 20000));
  const scanned = seqScans(plan.Plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH) expect(time).toBeLessThan(50);
  return plan.Plan;
}

const CHAT_TABLES = ['messages', 'message_mentions'];
/** The unseen changes (2026-10-17) read the user's events on the partial indexes only. */
/** The cards' linked-knowledge count reads the links by task and the items by key. */
const KNOWLEDGE_TABLES = ['knowledge_links', 'knowledge_items'];
const UNSEEN_TABLES = ['notification_events'];

/**
 * The volume is seeded once into a template (about 20 s, on its first run only) and every check
 * reads this run's clone of it, in one test. The "my assignments" queries may scan `tasks` and
 * `task_assignees`: with a third of the seeded tasks assigned to the one admin, a hash join over
 * the tables is cheaper than thousands of index lookups, and the planner rightly picks it. They
 * still have to stay under 50 ms.
 *
 * The plan checks do not depend on timing, so there is no retry; the 50 ms bounds run only with
 * `RUN_BENCH=1`.
 */
describe('admin home query plans on a seeded volume', () => {
  it(
    'the admin home queries use indexes (under 50 ms with RUN_BENCH=1)',
    { timeout: 300_000 },
    async () => {
      const { adminId, managedIds } = homeVolumeIds();
      const tx = db;
      // sidebar and assigned use indexes under 50 ms
      await expectIndexed(tx, sidebarSql(adminId), [...CHAT_TABLES, ...UNSEEN_TABLES]);
      await expectIndexed(tx, assignedSql(adminId), [...CHAT_TABLES, ...UNSEEN_TABLES]);
      // the header's counts and the group board's marks read the admin's events on the partial
      // indexes; with thousands of seeded unseen tasks, joining them to `tasks` (or `tickets`)
      // by a hash over the table is cheaper than one lookup each, as for "my assignments"
      await expectIndexed(tx, unseenTaskCountSql(adminId), UNSEEN_TABLES);
      await expectIndexed(tx, unseenTicketCountSql(adminId), UNSEEN_TABLES);
      await expectIndexed(tx, boardUnseenSql(adminId, managedIds[0]!), UNSEEN_TABLES);
      // 2026-10-18: a marker's "what changed" reads one item's events of the admin, on the
      // same partial indexes
      const [item] = [
        ...(await tx.execute<{ task_id: string; ticket_id: string }>(sql`
          select
            (select payload ->> 'taskId' from notification_events
              where user_id = ${adminId} and kind = 'task.moved' limit 1) as task_id,
            (select payload ->> 'ticketId' from notification_events
              where user_id = ${adminId} and kind = 'ticket.status' limit 1) as ticket_id
        `)),
      ];
      expect(item?.task_id).toBeTruthy();
      expect(item?.ticket_id).toBeTruthy();
      await expectIndexed(tx, taskSummarySql(adminId, item!.task_id), UNSEEN_TABLES);
      await expectIndexed(tx, ticketSummarySql(adminId, item!.ticket_id), UNSEEN_TABLES);
      // the Tickets card and the header's Tickets count read the tickets indexes; the "no
      // riešiteľ yet" anti-join may hash the small `ticket_assignees` (a few rows per active
      // ticket), which the planner rightly prefers to one index lookup per ticket
      await expectIndexed(tx, dashboardTicketsSql(adminId), ['tickets', ...UNSEEN_TABLES]);
      // mentions uses indexes under 50 ms; the direct mentions are read from the last 90 days
      // only (the seeded volume also names the admin in older messages)
      // 2026-10-18: and so do the mentions in descriptions, from the admin's own events on
      // `notification_events_description_mention_idx`, each subject looked up by its key
      const mentionsPlan = await expectIndexed(tx, mentionsSql(adminId), [
        ...CHAT_TABLES,
        ...UNSEEN_TABLES,
        'tasks',
        'tickets',
      ]);
      const mentionReads = indexReads(mentionsPlan);
      expect(
        mentionReads.some(
          (read) =>
            read.startsWith('message_mentions_user_created_idx:') && read.includes('created_at'),
        ),
      ).toBe(true);
      expect(
        mentionReads.some(
          (read) =>
            read.startsWith('notification_events_description_mention_idx:') &&
            read.includes('created_at'),
        ),
      ).toBe(true);
      // the volume's description mentions are newer than its chat ones: they are listed
      const [listed] = [
        ...(await tx.execute<{ described: number }>(
          sql`select (count(*) filter (where source = 'description'))::int as described
            from (${mentionsSql(adminId)}) x`,
        )),
      ];
      expect(listed!.described).toBeGreaterThan(0);
      // global board uses tasks_open_group_idx under 50 ms, for the 10 managed groups
      // and so does its "only where I take part" filter, and a merged custom column's next page
      const board = {
        clientIds: managedIds,
        viewerId: adminId,
        assignee: 'anyone',
        urgent: false,
        completed: false,
        today: bratislavaToday(new Date()),
      };
      for (const mine of [false, true]) {
        await expectIndexed(tx, globalBoardSql({ ...board, mine }), [
          'tasks',
          ...KNOWLEDGE_TABLES,
          ...CHAT_TABLES,
          ...UNSEEN_TABLES,
        ]);
      }
      const after = Buffer.from(
        JSON.stringify([true, '2026-01-01', 'Volume', '2026-01-01T00:00:00Z', '']),
      ).toString('base64url');
      await expectIndexed(
        tx,
        globalBoardSql({ ...board, mine: false, column: 'custom:step 1', after }),
        ['tasks', ...KNOWLEDGE_TABLES, ...CHAT_TABLES, ...UNSEEN_TABLES],
      );
      // Phase 34, the attachment picker: a group's task search (newest, and by title with the
      // trigram index available), the cards by primary key, and a group's ticket search.
      const groupId = managedIds[0]!;
      for (const q of ['', 'task 1']) {
        await expectIndexed(tx, taskSearchQuery(tx, groupId, { q }).getSQL(), ['tasks']);
      }
      await expectIndexed(
        tx,
        sql`select t.id, t.title from tasks t join buckets b on b.id = t.bucket_id
          where t.id in (${sql.join(
            [1, 2, 3, 4, 5].map((i) => sql`${`${groupId.split('-g')[0]}-t${i}`}`),
            sql`, `,
          )}) and t.group_id = ${groupId}`,
        ['tasks', 'buckets'],
      );
      await expectIndexed(
        tx,
        sql`select id, number, subject from tickets where group_id = ${groupId}
          and (subject ilike ${'%ticket 1%'} or left(body, 200) ilike ${'ticket 1%'})
          order by created_at desc, id desc limit 51`,
        ['tickets'],
      );
      await expectIndexed(tx, sql`select id from tickets where number = 777`, ['tickets']);
      // Phase 33 part P2: the group board and the ticket list filtered by a project and an
      // event read `tasks_group_project_event_idx` / `tickets_group_project_event_idx`, and the
      // global board with a Project filter for one client stays on the indexes.
      const projectId = `${groupId}-p1`;
      const eventId = `${groupId}-e1`;
      for (const event of [sql`and t.event_id = ${eventId}`, sql``]) {
        await expectIndexed(
          tx,
          sql`select t.id from tasks t where t.group_id = ${groupId}
            and t.completed_at is null and t.project_id = ${projectId} ${event}`,
          ['tasks'],
        );
      }
      await expectIndexed(
        tx,
        sql`select id from tickets where group_id = ${groupId} and project_id = ${projectId}
          and event_id = ${eventId} and status in ('new', 'in_progress')
          order by created_at desc, id desc limit 51`,
        ['tickets'],
      );
      await expectIndexed(
        tx,
        globalBoardSql({ ...board, clientIds: [groupId], mine: false, project: projectId }),
        ['tasks', ...CHAT_TABLES, ...UNSEEN_TABLES],
      );
      // Phase 34 part D, the admin group's picker: the task search across every group (newest,
      // and by title) and across the chosen clients, and the global ticket search.
      for (const q of ['', 'task 1']) {
        for (const groupIds of [null, managedIds]) {
          await expectIndexed(tx, allTaskSearchQuery(tx, groupIds, { q }).getSQL(), ['tasks']);
        }
      }
      await expectIndexed(
        tx,
        sql`select id, number, subject from tickets
          where (subject ilike ${'%ticket 1%'} or left(body, 200) ilike ${'ticket 1%'})
          order by created_at desc, id desc limit 51`,
        ['tickets'],
      );
      // 2026-10-18 (migration 0049). A rare term: the search reads both trigram indexes (the
      // body's start included) instead of walking every ticket by date.
      const used = (plan: PlanNode) => indexReads(plan).map((read) => read.split(':')[0]);
      const rare = await expectIndexed(
        tx,
        sql`select id, number, subject from tickets
          where (subject ilike ${'%zqxw%'} or left(body, 200) ilike ${'zqxw%'})
          order by created_at desc, id desc limit 51`,
        ['tickets'],
      );
      expect(used(rare)).toEqual(
        expect.arrayContaining(['tickets_subject_trgm_idx', 'tickets_body_head_trgm_idx']),
      );
      // A group's picker without a term reads its tasks in index order.
      const picker = await expectIndexed(tx, taskSearchQuery(tx, groupId, { q: '' }).getSQL(), [
        'tasks',
      ]);
      expect(used(picker)).toContain('tasks_group_search_order_idx');
      // The hourly urgent reminders read the open urgent tasks only.
      const urgent = await expectIndexed(
        tx,
        sql`select t.id, a.user_id from tasks t join task_assignees a on a.task_id = t.id
          where t.completed_at is null and t.urgent = true order by t.id, a.user_id`,
        ['tasks'],
      );
      expect(used(urgent)).toContain('tasks_urgent_open_idx');
      // The Tickets card's open tickets without a client skip the resolved ones.
      const tickets = await expectIndexed(tx, dashboardTicketsSql(adminId), ['tickets']);
      expect(used(tickets)).toContain('tickets_unassigned_open_created_idx');
      // 2026-10-18, the notification centre (migration 0062): a page of the bell, the next
      // page after a cursor, and the unread count, for the admin (a seventh of all events: the
      // planner may as well walk `created_at` backwards, as fast) and for a client (on the
      // partial index); the two delivery passes read their own partial indexes, also with a
      // thousand events held for a device (inserted in a transaction that is rolled back).
      const clientId = adminId.replace(/-admin$/, '-c1');
      for (const userId of [adminId, clientId]) {
        const first = await expectIndexed(tx, centreListSql(userId, null, 31), UNSEEN_TABLES);
        const [last] = [
          ...(await tx.execute<{ at: string; id: string }>(sql`
            select created_at::text as at, id from notification_events
            where user_id = ${userId} and in_centre order by created_at desc, id desc
            offset 30 limit 1
          `)),
        ];
        const next = await expectIndexed(
          tx,
          centreListSql(userId, { at: last!.at, id: last!.id }, 31),
          UNSEEN_TABLES,
        );
        const unread = await expectIndexed(tx, centreUnreadSql(userId), UNSEEN_TABLES);
        if (userId === clientId) {
          for (const plan of [first, next, unread]) {
            expect(used(plan)).toContain('notification_events_centre_idx');
          }
        }
      }
      class Rollback extends Error {}
      await expect(
        db.transaction(async (held) => {
          await held.execute(sql`
            insert into notification_events (id, user_id, group_id, kind, payload, in_centre)
            select 'held-' || i, ${adminId}, null, 'ticket.status', '{}'::jsonb, true
            from generate_series(1, 1000) i
          `);
          for (const pass of ['fresh', 'held'] as const) {
            const pending = held
              .select({ id: notificationEvents.id })
              .from(notificationEvents)
              .where(passWhere(true, pass))
              .orderBy(asc(notificationEvents.createdAt), asc(notificationEvents.id))
              .limit(200);
            const plan = await expectIndexed(
              held as unknown as Db,
              pending.getSQL(),
              UNSEEN_TABLES,
            );
            expect(used(plan)).toContain(
              pass === 'fresh'
                ? 'notification_events_undelivered_idx'
                : 'notification_events_held_idx',
            );
          }
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    },
  );
});
