import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the projects volume of spec §12 for the `EXPLAIN` checks, seeded and rolled back:
 * 3 100 groups (one client each, the five buckets), 40 000 projects (a seventh archived),
 * 400 000 events (dates spread over ten years around today), and the tasks and tickets volumes
 * of `home/test-volume.ts` (20 000 each in the first 100 groups) with 30 % on an event of their
 * client. Project `j` belongs to group `(j % 3100) + 1`; event `i` to project `(i % 40000) + 1`.
 */

export type ProjectVolumeIds = {
  adminId: string;
  /** Group 2: about 13 projects and 130 events, tasks and tickets on them. */
  groupId: string;
  /** An active project of `groupId` with ten events. */
  projectId: string;
  /** Events of `groupId`, for the rows queries. */
  eventIds: string[];
};

class Rollback extends Error {}

const GROUPS = 3_100;
const PROJECTS = 40_000;
const EVENTS = 400_000;
const TASK_GROUPS = 100;
const TASKS = 20_000;
const TICKETS = 20_000;

export async function withProjectVolume(
  db: Db,
  fn: (tx: Db, ids: ProjectVolumeIds) => Promise<void>,
): Promise<void> {
  const p = `pv${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const adminId = `${p}-admin`;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into "user" (id, name, email, email_verified, role)
        values (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin')`);
      await tx.execute(sql`
        insert into "user" (id, name, email, email_verified, role)
        select ${p} || '-c' || i, 'Client ' || i, ${p} || '-c' || i || '@example.com', true, 'client'
        from generate_series(1, ${GROUPS}) i`);
      await tx.execute(sql`
        insert into groups (id, name, egrant_url, invite_token)
        select ${p} || '-g' || i, 'Volume ' || i, 'https://' || ${p} || i || '.egrant.sk',
          ${p} || '-invite-' || i
        from generate_series(1, ${GROUPS}) i`);
      await tx.execute(sql`
        insert into group_members (user_id, group_id)
        select ${p} || '-c' || i, ${p} || '-g' || i from generate_series(1, ${GROUPS}) i`);
      await tx.execute(sql`
        insert into buckets (id, group_id, kind, name, position)
        select ${p} || '-b' || i || '-' || k.kind, ${p} || '-g' || i, k.kind, null, k.pos
        from generate_series(1, ${TASK_GROUPS}) i
        cross join (values ('todo', 'a0'), ('done', 'a9')) as k(kind, pos)`);
      await tx.execute(sql`
        insert into projects (id, group_id, name, name_key, status, source, created_at, updated_at)
        select ${p} || '-p' || j, ${p} || '-g' || (j % ${GROUPS} + 1), 'Project ' || j,
          'project ' || j, case when j % 7 = 0 then 'archived' else 'active' end,
          case when j % 3 = 0 then 'egrant' else 'manual' end, now(), now()
        from generate_series(1, ${PROJECTS}) j`);
      await tx.execute(sql`
        insert into project_events (id, project_id, group_id, name, name_key, occurs_on,
          created_at, updated_at)
        select ${p} || '-e' || i, ${p} || '-p' || (i % ${PROJECTS} + 1),
          ${p} || '-g' || ((i % ${PROJECTS} + 1) % ${GROUPS} + 1), 'Event ' || i, 'event ' || i,
          current_date + (i % 3650 - 1825), now() - i * interval '1 second', now()
        from generate_series(1, ${EVENTS}) i`);
      // Task i is in group g = (i % 100) + 1; 30 % of them on an event of a project of g:
      // project j = g - 1 + 3100 * (i % 12 + 1), event (j - 1) + 40000 * (i % 10).
      await tx.execute(sql`
        insert into tasks (id, group_id, bucket_id, position, title, created_by, due_date, urgent,
          completed_at, project_id, event_id, created_at, updated_at)
        select ${p} || '-t' || i, ${p} || '-g' || g,
          ${p} || '-b' || g || '-' || case when i % 10 = 0 then 'done' else 'todo' end,
          'p' || lpad(i::text, 6, '0'), 'Task ' || i, ${adminId},
          case when i % 3 = 0 then null else current_date + (i % 60 - 20) end, i % 17 = 0,
          case when i % 10 = 0 then now() - (i % 60) * interval '1 day' end,
          case when i % 10 < 3 then ${p} || '-p' || j end,
          case when i % 10 < 3 then ${p} || '-e' || (j - 1 + ${PROJECTS} * (i % 10)) end,
          now() - i * interval '1 minute', now()
        from (select i, i % ${TASK_GROUPS} + 1 as g,
                (i % ${TASK_GROUPS}) + ${GROUPS} * (i % 12 + 1) as j
              from generate_series(1, ${TASKS}) i) s`);
      await tx.execute(sql`
        insert into task_assignees (task_id, user_id)
        select ${p} || '-t' || i, ${adminId} from generate_series(1, ${TASKS}) i where i % 3 = 1`);
      await tx.execute(sql`
        insert into tickets (id, group_id, status, source, subject, body, project_id, event_id,
          created_at, updated_at, resolved_at)
        select ${p} || '-k' || i, ${p} || '-g' || g,
          case when i % 10 = 1 then 'new' when i % 10 = 2 then 'in_progress' else 'resolved' end,
          'api', 'Ticket ' || i, 'Text ' || i,
          case when i % 10 in (1, 4, 7) then ${p} || '-p' || j end,
          case when i % 10 in (1, 4, 7) then ${p} || '-e' || (j - 1 + ${PROJECTS} * (i % 10)) end,
          now() - i * interval '5 minutes', now(),
          case when i % 10 > 2 then now() - i * interval '4 minutes' end
        from (select i, i % ${TASK_GROUPS} + 1 as g,
                (i % ${TASK_GROUPS}) + ${GROUPS} * (i % 12 + 1) as j
              from generate_series(1, ${TICKETS}) i) s`);
      await tx.execute(sql`
        insert into ticket_assignees (ticket_id, user_id)
        select ${p} || '-k' || i, ${adminId} from generate_series(1, ${TICKETS}) i where i % 7 = 1`);
      for (const table of [
        'user',
        'groups',
        'group_members',
        'buckets',
        'projects',
        'project_events',
        'tasks',
        'task_assignees',
        'tickets',
        'ticket_assignees',
      ]) {
        await tx.execute(sql.raw(`analyze "${table}"`));
      }
      const groupId = `${p}-g2`;
      const events = await tx.execute<{ id: string }>(sql`
        select id from project_events where group_id = ${groupId} order by occurs_on, id limit 30`);
      // Project 9301 = 1 + 3100 * 3 is in group 2 and active (9301 % 7 = 5).
      await fn(tx as unknown as Db, {
        adminId,
        groupId,
        projectId: `${p}-p${1 + GROUPS * 3}`,
        eventIds: [...events].map((e) => e.id),
      });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
