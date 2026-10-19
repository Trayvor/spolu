import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the calendar volume of the personal feed's `EXPLAIN` checks (ADR 0051), seeded once
 * into a template database (`test/explain-templates.ts`, ADR 0040) that each explain run clones:
 * 200 client groups and 40 000 calls (`meeting` items, a fifth admins-only) spread evenly over
 * two years around now. Call `i` belongs to group `(i % 200) + 1`.
 */

export type CalendarVolumeIds = { adminId: string; groupIds: string[] };

/** The fixed id prefix: the ids are known without reading the clone. */
const p = 'cvcal0000000';
const adminId = `${p}-admin`;

const GROUPS = 200;
const CALLS = 40_000;

/** The tables the template vacuums and analyzes after the seed. */
export const CALENDAR_VOLUME_TABLES = ['user', 'groups', 'knowledge_items', 'knowledge_meetings'];

export async function seedCalendarVolume(tx: Db): Promise<void> {
  await tx.execute(sql`
    insert into "user" (id, name, email, email_verified, role)
    values (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin')`);
  await tx.execute(sql`
    insert into groups (id, name, egrant_url, invite_token)
    select ${p} || '-g' || i, 'Volume ' || i, 'https://' || ${p} || i || '.egrant.sk',
      ${p} || '-invite-' || i
    from generate_series(1, ${GROUPS}) i`);
  await tx.execute(sql`
    insert into knowledge_items (id, group_id, type, visibility, title, created_by, search_text,
      created_at, updated_at)
    select ${p} || '-k' || i, ${p} || '-g' || (i % ${GROUPS} + 1), 'meeting',
      case when i % 5 = 0 then 'admins' else 'public' end, 'Call ' || i, ${adminId},
      'call ' || i, now() - i * interval '1 minute', now()
    from generate_series(1, ${CALLS}) i`);
  await tx.execute(sql`
    insert into knowledge_meetings (item_id, starts_at)
    select ${p} || '-k' || i,
      now() - interval '365 days' + i * (interval '730 days' / ${CALLS})
    from generate_series(1, ${CALLS}) i`);
}

/** The ids the checks use. */
export function calendarVolumeIds(): CalendarVolumeIds {
  return {
    adminId,
    groupIds: Array.from({ length: GROUPS }, (_, i) => `${p}-g${i + 1}`),
  };
}
