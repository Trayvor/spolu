import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: a production-like volume for the global search's `EXPLAIN` checks, seeded once into
 * a template database (`test/explain-templates.ts`, ADR 0040) that each explain run clones:
 * 3 000 client groups ("Obec <i> Lúky"), one client each (the first also a client of groups 2 to
 * 5), 100 000 tasks, 100 000 tickets, 50 000 knowledge notes (a tenth admins-only), 20 000
 * projects and 100 000 events, each titled with a common word and its number.
 */

export type SearchVolume = { adminId: string; clientId: string; groupIds: string[] };

/** The fixed id prefix: the ids are known without reading the clone. */
const p = 'svsearch0000';
const adminId = `${p}-admin`;

const GROUPS = 3_000;
const TASKS = 100_000;
const TICKETS = 100_000;
const KNOWLEDGE = 50_000;
const PROJECTS = 20_000;
const EVENTS = 100_000;

const WORDS = sql`array['rozpočet', 'žiadosť', 'kontrola', 'zmluva', 'faktúra', 'výzva', 'audit']`;

/** The tables the template vacuums and analyzes after the seed. */
export const SEARCH_VOLUME_TABLES = [
  'user',
  'groups',
  'group_members',
  'buckets',
  'tasks',
  'tickets',
  'knowledge_items',
  'projects',
  'project_events',
];

export async function seedSearchVolume(tx: Db): Promise<void> {
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    values (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin')
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
    insert into group_members (user_id, group_id)
    select ${p} || '-c' || i, ${p} || '-g' || i from generate_series(1, ${GROUPS}) i
    union all
    select ${p} || '-c1', ${p} || '-g' || i from generate_series(2, 5) i
  `);
  await tx.execute(sql`
    insert into buckets (id, group_id, kind, name, position)
    select ${p} || '-b' || i, ${p} || '-g' || i, 'todo', null, 'a0'
    from generate_series(1, ${GROUPS}) i
  `);
  await tx.execute(sql`
    insert into tasks (id, group_id, bucket_id, position, title, created_by, completed_at,
      created_at, updated_at)
    select ${p} || '-t' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
      ${p} || '-b' || (i % ${GROUPS} + 1), 'p' || lpad(i::text, 6, '0'),
      initcap((${WORDS})[i % 7 + 1]) || ' ' || i, ${adminId},
      case when i % 10 = 0 then now() end, now() - i * interval '1 minute', now()
    from generate_series(1, ${TASKS}) i
  `);
  await tx.execute(sql`
    insert into tickets (id, group_id, status, source, subject, body, requester_user_id,
      created_at, updated_at)
    select ${p} || '-k' || i,
      case when i % 50 = 0 then null else ${p} || '-g' || (i % ${GROUPS} + 1) end,
      case when i % 10 = 1 then 'new' else 'resolved' end, 'api',
      initcap((${WORDS})[i % 7 + 1]) || ' ' || i, 'Text ' || i,
      ${p} || '-c' || (i % ${GROUPS} + 1), now() - i * interval '5 minutes', now()
    from generate_series(1, ${TICKETS}) i
  `);
  await tx.execute(sql`
    insert into knowledge_items (id, group_id, type, visibility, title, created_by, search_text)
    select ${p} || '-n' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'note',
      case when i % 10 = 0 then 'admins' else 'public' end,
      initcap((${WORDS})[i % 7 + 1]) || ' ' || i, ${adminId},
      'poznamka ' || i || ' text o veci ' || (i * 7)
    from generate_series(1, ${KNOWLEDGE}) i
  `);
  await tx.execute(sql`
    insert into projects (id, group_id, name, name_key)
    select ${p} || '-p' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
      'Projekt ' || i, 'projekt ' || i
    from generate_series(1, ${PROJECTS}) i
  `);
  await tx.execute(sql`
    insert into project_events (id, project_id, group_id, name, name_key, occurs_on)
    select ${p} || '-e' || i, ${p} || '-p' || (i % ${PROJECTS} + 1),
      ${p} || '-g' || ((i % ${PROJECTS} + 1) % ${GROUPS} + 1),
      'Kontrola ' || i, 'kontrola ' || i, current_date + (i % 400 - 200)
    from generate_series(1, ${EVENTS}) i
  `);
}

/** The ids the checks use. */
export function searchVolumeIds(): SearchVolume {
  return {
    adminId,
    clientId: `${p}-c1`,
    groupIds: Array.from({ length: GROUPS }, (_, i) => `${p}-g${i + 1}`),
  };
}
