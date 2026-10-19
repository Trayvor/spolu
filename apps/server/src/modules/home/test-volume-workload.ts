import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the volume of the admin workload card's `EXPLAIN` check (2026-10-19), its own
 * template (ADR 0040 allows several) so that seeding many admins does not change the statistics
 * the home volume's checks were tuned on. Seeded once into a template database
 * (`test/explain-templates.ts`); each explain run gets a clone.
 */

export type WorkloadVolumeIds = { adminIds: string[]; disabledId: string; groupIds: string[] };

/** The fixed id prefix: the ids are known without reading the clone. */
const p = 'vwork00000000';

const ADMINS = 10;
const GROUPS = 100;
const TASKS = 20_000;
const TICKETS = 20_000;
const EVENTS = 200_000;

/** The ids of the seeded volume. */
export function workloadVolumeIds(): WorkloadVolumeIds {
  return {
    adminIds: Array.from({ length: ADMINS }, (_, i) => `${p}-admin${i + 1}`),
    disabledId: `${p}-admin-off`,
    groupIds: Array.from({ length: GROUPS }, (_, i) => `${p}-g${i + 1}`),
  };
}

/** The tables vacuumed and analyzed after the seed; the others keep fresh statistics. */
export const WORKLOAD_VOLUME_TABLES = [
  'user',
  'groups',
  'buckets',
  'tasks',
  'task_assignees',
  'tickets',
  'ticket_assignees',
  'notification_events',
  'task_seen',
  'ticket_seen',
];

/**
 * Seeds with `generate_series`: 10 active admins (the first a superadmin) and one disabled, 100
 * clients, 100 groups (the last two deactivated at the end) with their five buckets, 20 000 tasks (a tenth
 * completed, two thirds with a due date, two thirds assigned: `i % 3 = 1` to admin `i % 10`,
 * `i % 3 = 2` to admin `(i + 3) % 10`, every 30th also to the disabled admin), 20 000 tickets (a
 * tenth active, a fiftieth without a client; every seventh with a riešiteľ, an admin by `i % 10`
 * or the group's client), and 200 000 notification events (half the admins', of tasks and tickets
 * and group chats) with seen marks for a sixth of the tasks and a fifth of the tickets per admin.
 */
export async function seedWorkloadVolume(tx: Db): Promise<void> {
  /** The id of admin `i % 10 + 1`. */
  const admin = (i: SQL) => sql`${p} || '-admin' || (${i} % ${ADMINS} + 1)`;
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    select ${p} || '-admin' || i, 'Admin ' || lpad(i::text, 2, '0'),
      ${p} || '-admin' || i || '@example.com', true,
      case when i = 1 then 'superadmin' else 'admin' end
    from generate_series(1, ${ADMINS}) i
  `);
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role, disabled_at)
    values (${`${p}-admin-off`}, 'Off', ${`${p}-admin-off@example.com`}, true, 'admin', now())
  `);
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    select ${p} || '-c' || i, 'Client ' || i, ${p} || '-c' || i || '@example.com', true, 'client'
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into groups (id, name, egrant_url, invite_token)
    select ${p} || '-g' || i, 'Workload ' || lpad(i::text, 3, '0'),
      'https://' || ${p} || i || '.egrant.sk', ${p} || '-invite-' || i
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into buckets (id, group_id, kind, name, position)
    select ${p} || '-b' || i || '-' || k.kind, ${p} || '-g' || i, k.kind,
      case when k.kind = 'custom' then 'Step' end, k.pos
    from generate_series(1, ${GROUPS}) i
    cross join (values ('todo', 'a0'), ('custom', 'a1'), ('egrant_review', 'a3'),
      ('client_review', 'a6'), ('done', 'a9')) as k(kind, pos)
  `);
  await tx.execute(sql`
    insert into tasks (id, group_id, bucket_id, position, title, created_by, due_date,
      completed_at, created_at, updated_at)
    select ${p} || '-t' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
      ${p} || '-b' || (i % ${GROUPS} + 1) || '-' || case when i % 10 = 0 then 'done' else 'todo' end,
      'p' || lpad(i::text, 6, '0'), 'Task ' || i, ${`${p}-admin1`},
      case when i % 3 = 0 then null else current_date + (i % 60 - 20) end,
      case when i % 10 = 0 then now() - (i % 60) * interval '1 day' end,
      now() - i * interval '1 minute', now()
    from generate_series(1, ${TASKS}) i
  `);
  await tx.execute(sql`
    insert into task_assignees (task_id, user_id)
    select ${p} || '-t' || i, ${admin(sql`i`)} from generate_series(1, ${TASKS}) i where i % 3 = 1
    union all
    select ${p} || '-t' || i, ${admin(sql`(i + 3)`)} from generate_series(1, ${TASKS}) i
    where i % 3 = 2
    union all
    select ${p} || '-t' || i, ${`${p}-admin-off`} from generate_series(1, ${TASKS}) i
    where i % 30 = 0
  `);
  await tx.execute(sql`
    insert into tickets (id, group_id, status, source, subject, body, created_at, updated_at)
    select ${p} || '-k' || i,
      case when i % 50 = 0 then null else ${p} || '-g' || (i % ${GROUPS} + 1) end,
      case when i % 10 = 1 then 'new' when i % 10 = 2 then 'in_progress' else 'resolved' end,
      'api', 'Ticket ' || i, 'Text of ticket ' || i,
      now() - i * interval '5 minutes', now()
    from generate_series(1, ${TICKETS}) i
  `);
  await tx.execute(sql`
    insert into ticket_assignees (ticket_id, user_id)
    select ${p} || '-k' || i,
      case when i % 2 = 1 then ${admin(sql`i`)} else ${p} || '-c' || (i % ${GROUPS} + 1) end
    from generate_series(1, ${TICKETS}) i where i % 7 = 1
  `);
  // Event i is an admin's (by i % 10) when i is even, else a client's; by i % 5 a task move, an
  // urgent reminder, a task chat message, a ticket status change or a group chat message.
  await tx.execute(sql`
    insert into notification_events (id, user_id, group_id, kind, payload, created_at,
      delivered_at, in_centre)
    select ${p} || '-e' || i,
      case when i % 2 = 0 then ${admin(sql`(i / 2)`)} else ${p} || '-c' || (i % ${GROUPS} + 1) end,
      ${p} || '-g' || ((i % ${TASKS} + 1) % ${GROUPS} + 1),
      (array['task.moved', 'task.urgent', 'chat.message', 'ticket.status', 'chat.message'])[i % 5 + 1],
      case
        when i % 5 = 3 then jsonb_build_object('ticketId', ${p} || '-k' || (i % ${TICKETS} + 1))
        when i % 5 = 4 then jsonb_build_object('taskId', null)
        else jsonb_build_object('taskId', ${p} || '-t' || (i % ${TASKS} + 1))
      end,
      now() - i * interval '10 seconds', now(), i % 3 = 0
    from generate_series(1, ${EVENTS}) i
  `);
  await tx.execute(sql`
    insert into task_seen (user_id, task_id, seen_at)
    select ${p} || '-admin' || a, ${p} || '-t' || i, now() - interval '5 days'
    from generate_series(1, ${ADMINS}) a cross join generate_series(1, ${TASKS}) i
    where i % 6 = a % 6
  `);
  await tx.execute(sql`
    insert into ticket_seen (user_id, ticket_id, seen_at)
    select ${p} || '-admin' || a, ${p} || '-k' || i, now() - interval '5 days'
    from generate_series(1, ${ADMINS}) a cross join generate_series(1, ${TICKETS}) i
    where i % 5 = a % 5
  `);
  // Last: a deactivated group refuses new rows (its trigger), so the two leave after the seed.
  await tx.execute(sql`
    update groups set deactivated_at = now()
    where id in (${`${p}-g${GROUPS - 1}`}, ${`${p}-g${GROUPS}`})
  `);
}
