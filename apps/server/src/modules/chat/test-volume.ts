import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: a production-like chat volume for the message search's `EXPLAIN` checks
 * (2026-10-19), seeded once into a template database (`test/explain-templates.ts`, ADR 0040):
 * 3 000 client groups with a group chat (one client each, the first also a client of groups 2
 * to 5; a ziadatel in group 1), 6 000 tasks and 10 000 tickets with their chats (two of group
 * 1's three tickets started by the ziadatel), and 400 000 messages: 60 % in group chats, 25 % in
 * task chats, 15 % in ticket chats; 10 % replies, 2 % deleted, 5 % with a mention, 30 % opening
 * with "Dobrý deň", each with a common word and its number.
 */

export type MessageVolume = {
  adminId: string;
  clientId: string;
  ziadatelId: string;
  groupIds: string[];
};

/** The fixed id prefix: the ids are known without reading the clone. */
const p = 'svmsg0000';
const adminId = `${p}-admin`;
const ziadatelId = `${p}-z`;

const GROUPS = 3_000;
const TASKS = 6_000;
const TICKETS = 10_000;
const MESSAGES = 400_000;
/** A multiple of the channel counts: message `i` and `i - k * PERIOD` share their channel. */
const PERIOD = 30_000;

const WORDS = sql`array['rozpočet', 'žiadosť', 'kontrola', 'zmluva', 'faktúra', 'výzva', 'audit']`;

/** The tables the template vacuums and analyzes after the seed. */
export const MESSAGE_VOLUME_TABLES = [
  'user',
  'groups',
  'group_members',
  'buckets',
  'tasks',
  'tickets',
  'channels',
  'messages',
];

export async function seedMessageVolume(tx: Db): Promise<void> {
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    values (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin'),
      (${ziadatelId}, 'Žiadateľ Volume', ${`${p}-z@example.com`}, true, 'client')
  `);
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    select ${p} || '-c' || i, 'Klient Číslo ' || i, ${p} || '-c' || i || '@example.com', true, 'client'
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into groups (id, name, egrant_url, invite_token)
    select ${p} || '-g' || i, 'Obec ' || i || ' Lúky',
      'https://' || ${p} || i || '.egrant.sk', ${p} || '-invite-' || i
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into group_members (user_id, group_id, role)
    select ${p} || '-c' || i, ${p} || '-g' || i, 'client' from generate_series(1, ${GROUPS}) i
    union all
    select ${p} || '-c1', ${p} || '-g' || i, 'client' from generate_series(2, 5) i
    union all
    select ${ziadatelId}, ${`${p}-g1`}, 'ziadatel'
  `);
  await tx.execute(sql`
    insert into buckets (id, group_id, kind, name, position)
    select ${p} || '-b' || i, ${p} || '-g' || i, 'todo', null, 'a0'
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into tasks (id, group_id, bucket_id, position, title, created_by, created_at, updated_at)
    select ${p} || '-t' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
      ${p} || '-b' || (i % ${GROUPS} + 1), 'p' || lpad(i::text, 6, '0'),
      initcap((${WORDS})[i % 7 + 1]) || ' ' || i, ${adminId},
      now() - i * interval '1 minute', now()
    from generate_series(1, ${TASKS}) i
  `);
  await tx.execute(sql`
    insert into tickets (id, group_id, status, source, subject, body, requester_user_id,
      created_at, updated_at)
    select ${p} || '-k' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'new', 'api',
      initcap((${WORDS})[i % 7 + 1]) || ' ' || i, 'Text ' || i,
      case when i % ${GROUPS} = 0 and (i / ${GROUPS}) % 2 = 1 then ${ziadatelId}
        else ${p} || '-c' || (i % ${GROUPS} + 1) end,
      now() - i * interval '5 minutes', now()
    from generate_series(1, ${TICKETS}) i
  `);
  await tx.execute(sql`
    insert into channels (id, group_id, kind, task_id, ticket_id)
    select ${p} || '-hg' || i, ${p} || '-g' || i, 'group', null, null
    from generate_series(1, ${GROUPS}) i
    union all
    select ${p} || '-ht' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'task', ${p} || '-t' || i, null
    from generate_series(1, ${TASKS}) i
    union all
    select ${p} || '-hk' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'ticket', null, ${p} || '-k' || i
    from generate_series(1, ${TICKETS}) i
  `);
  // i % 20: 0–11 a group chat, 12–16 a task chat, 17–19 a ticket chat. A reply (i % 10 = 9,
  // after the first PERIOD) answers message ((i - 1) % PERIOD + 1), a top-level message of the
  // same channel. Message 1 is the newest.
  await tx.execute(sql`
    insert into messages (id, channel_id, author_id, parent_id, body, deleted_at, client_id,
      change_seq, created_at)
    select ${p} || '-m' || i,
      case when i % 20 < 12 then ${p} || '-hg' || (i % ${GROUPS} + 1)
        when i % 20 < 17 then ${p} || '-ht' || (i % ${TASKS} + 1)
        else ${p} || '-hk' || (i % ${TICKETS} + 1) end,
      case when i % 3 = 0 then ${adminId} else ${p} || '-c' || (i % ${GROUPS} + 1) end,
      case when i > ${PERIOD} and i % 10 = 9 then ${p} || '-m' || ((i - 1) % ${PERIOD} + 1) end,
      case when i % 50 = 7 then ''
        else (case when i % 10 < 3 then 'Dobrý deň, ' else '' end)
          || initcap((${WORDS})[i % 7 + 1]) || ' ' || i || ' je v prílohe správy'
          || (case when i % 20 = 3 then ' <@' || ${adminId} || '>' else '' end) end,
      case when i % 50 = 7 then now() end,
      'v' || i, i, now() - i * interval '10 seconds'
    from generate_series(1, ${MESSAGES}) i
  `);
}

/** The ids the checks use. */
export function messageVolumeIds(): MessageVolume {
  return {
    adminId,
    clientId: `${p}-c1`,
    ziadatelId,
    groupIds: Array.from({ length: GROUPS }, (_, i) => `${p}-g${i + 1}`),
  };
}
