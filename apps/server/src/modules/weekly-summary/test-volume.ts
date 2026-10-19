import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the weekly summary volume of spec 2026-10-19 §9 for the `EXPLAIN` checks, seeded
 * once into a template database (`test/explain-templates.ts`) that each explain run clones:
 * 3 100 client groups (one verified client each, the five buckets, one project, a group chat),
 * every group managed (the admin the first 100), 62 000 tasks, 62 000 tickets (most resolved
 * over the last year), 124 000 project events, 6 200 task chats and 310 000 messages, and three
 * years of weekly summaries for every group: 3 100 × 156 = 483 600 rows with realistic
 * `search_text`. Group `n` is `<p>-g<n>`; the sample group is group 7.
 */

export type WeeklyVolumeIds = { adminId: string; groupId: string; managedIds: string[] };

const p = 'wvweek000000';
const GROUPS = 3_100;
const MANAGED = 100;
const TASKS = 62_000;
const TICKETS = 62_000;
const EVENTS = 124_000;
const TASK_CHATS = 6_200;
const MESSAGES = 310_000;
const WEEKS = 156;

export function weeklyVolumeIds(): WeeklyVolumeIds {
  return {
    adminId: `${p}-admin`,
    groupId: `${p}-g7`,
    managedIds: Array.from({ length: MANAGED }, (_, i) => `${p}-g${i + 1}`),
  };
}

/** The tables the template vacuums and analyzes after the seed. */
export const WEEKLY_VOLUME_TABLES = [
  'user',
  'groups',
  'group_members',
  'group_managers',
  'buckets',
  'tasks',
  'tickets',
  'projects',
  'project_events',
  'channels',
  'messages',
  'weekly_summaries',
];

export async function seedWeeklyVolume(tx: Db): Promise<void> {
  const { adminId } = weeklyVolumeIds();
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role) values
      (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin'),
      (${`${p}-admin2`}, 'Second Admin', ${`${p}-admin2@example.com`}, true, 'admin')`);
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    select ${p} || '-c' || i, 'Client ' || i, ${p} || '-c' || i || '@example.com', true, 'client'
    from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into groups (id, name, egrant_url, invite_token)
    select ${p} || '-g' || i, 'Weekly ' || lpad(i::text, 4, '0'),
      'https://' || ${p} || i || '.egrant.sk', ${p} || '-invite-' || i
    from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into group_members (user_id, group_id)
    select ${p} || '-c' || i, ${p} || '-g' || i from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into group_managers (group_id, user_id)
    select ${p} || '-g' || i, case when i <= ${MANAGED} then ${adminId} else ${`${p}-admin2`} end
    from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into buckets (id, group_id, kind, name, position)
    select ${p} || '-b' || i || '-' || k.kind, ${p} || '-g' || i, k.kind, null, k.pos
    from generate_series(1, ${GROUPS}) i
    cross join (values ('todo', 'a0'), ('egrant_review', 'a3'), ('client_review', 'a6'),
      ('done', 'a9')) as k(kind, pos)`);
  // Task i is in group (i % 3100) + 1: a fifth completed over the last 90 days, the rest spread
  // over the open buckets, two thirds with a due date within ±60 days.
  await tx.execute(sql`
    insert into tasks (id, group_id, bucket_id, position, title, created_by, due_date,
      completed_at, created_at, updated_at)
    select ${p} || '-t' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
      ${p} || '-b' || (i % ${GROUPS} + 1) || '-' || case when i % 5 = 0 then 'done'
        else (array['todo', 'egrant_review', 'client_review'])[i % 3 + 1] end,
      'p' || lpad(i::text, 6, '0'), 'Task ' || i, ${adminId},
      case when i % 3 = 0 then null else current_date + (i % 120 - 60) end,
      case when i % 5 = 0 then now() - (i % 90) * interval '1 day' end,
      now() - i * interval '1 minute', now()
    from generate_series(1, ${TASKS}) i`);
  // Nine in ten tickets resolved over the last year, a fiftieth without a client.
  await tx.execute(sql`
    insert into tickets (id, group_id, status, source, subject, created_at, updated_at,
      resolved_at)
    select ${p} || '-k' || i,
      case when i % 50 = 0 then null else ${p} || '-g' || (i % ${GROUPS} + 1) end,
      case when i % 10 = 1 then 'new' else 'resolved' end, 'api', 'Ticket ' || i,
      now() - i * interval '10 minutes', now(),
      case when i % 10 = 1 then null else now() - (i % 365) * interval '1 day' end
    from generate_series(1, ${TICKETS}) i`);
  await tx.execute(sql`
    insert into projects (id, group_id, name, name_key, status)
    select ${p} || '-p' || i, ${p} || '-g' || i, 'Project ' || i, 'project ' || i,
      case when i % 7 = 0 then 'archived' else 'active' end
    from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into project_events (id, project_id, group_id, name, name_key, occurs_on)
    select ${p} || '-e' || i, ${p} || '-p' || (i % ${GROUPS} + 1), ${p} || '-g' || (i % ${GROUPS} + 1),
      'Event ' || i, 'event ' || i, current_date + (i % 730 - 365)
    from generate_series(1, ${EVENTS}) i`);
  await tx.execute(sql`
    insert into channels (id, group_id, kind)
    select ${p} || '-ch' || i, ${p} || '-g' || i, 'group' from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into channels (id, group_id, kind, task_id)
    select ${p} || '-tc' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'task', ${p} || '-t' || i
    from generate_series(1, ${TASK_CHATS}) i`);
  // Messages over the last 60 days: half in the group chats, half in the task chats.
  await tx.execute(sql`
    insert into messages (id, channel_id, author_id, body, client_id, change_seq, created_at)
    select ${p} || '-m' || i,
      case when i % 2 = 0 then ${p} || '-ch' || (i % ${GROUPS} + 1)
        else ${p} || '-tc' || (i % ${TASK_CHATS} + 1) end,
      ${p} || '-c' || (i % ${GROUPS} + 1), 'Message ' || i, ${p} || '-m' || i, i,
      now() - (i % 86400) * interval '1 minute'
    from generate_series(1, ${MESSAGES}) i`);
  // Week k of group n ends k weeks ago; older weeks sent, every ninth skipped, every 31st a
  // draft never sent; the content has one done item and realistic searchable text.
  await tx.execute(sql`
    insert into weekly_summaries (id, group_id, week, window_start, window_end, status,
      skip_reason, source, content, search_text, sent_at, created_at, updated_at)
    select ${p} || '-s' || n || '-' || k, ${p} || '-g' || n,
      to_char((now() - k * interval '7 days') at time zone 'Europe/Bratislava', 'IYYY-"W"IW'),
      now() - (k + 1) * interval '7 days', now() - k * interval '7 days',
      case when k % 9 = 0 then 'skipped' when (n + k) % 31 = 0 then 'draft' else 'sent' end,
      case when k % 9 = 0 then 'manager' end, 'facts',
      jsonb_build_object('intro', 'Dobrý deň', 'done', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'ref', null, 'text', 'Podali sme žiadosť o platbu ' || n || '/' || k)),
        'waiting', '[]'::jsonb, 'upcoming', '[]'::jsonb, 'closing', 'S pozdravom'),
      'Dobrý deň' || chr(10) || 'Podali sme žiadosť o platbu ' || n || '/' || k || chr(10)
        || (array['Rozpočet projektu schválený', 'Monitorovacia správa odoslaná',
          'Verejné obstarávanie ukončené', 'Zmluva o NFP podpísaná'])[(n + k) % 4 + 1]
        || chr(10) || 'S pozdravom',
      case when k % 9 <> 0 and (n + k) % 31 <> 0 then now() - k * interval '7 days' end,
      now() - k * interval '7 days', now() - k * interval '7 days'
    from generate_series(1, ${GROUPS}) n cross join generate_series(1, ${WEEKS}) k`);
}
