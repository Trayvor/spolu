import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/** Test-only: a realistic volume for the `EXPLAIN` checks, seeded and rolled back. */

export type VolumeIds = { adminId: string; groupIds: string[]; managedIds: string[] };

class Rollback extends Error {}

const GROUPS = 100;
const TASKS = 20_000;
const TICKETS = 20_000;
const MESSAGES = 200_000;
const MESSAGES_PER_CHANNEL = MESSAGES / GROUPS;

/**
 * Opens a transaction and seeds it with `generate_series`: 100 groups (a group chat and the five
 * buckets each, one client each; the custom one named "Step <group % 15>"), 20 000 tasks (a third assigned to the admin, a tenth completed),
 * 20 000 tickets (a tenth active, a fiftieth without a client),
 * 200 000 messages (a quarter name someone, 0.5 % the admin; 1 % @all; 10 % replies), the admin's read marks and
 * the admin managing 10 groups. Runs `analyze`, calls `fn`, then rolls everything back.
 */
export async function withVolume(
  db: Db,
  fn: (tx: Db, ids: VolumeIds) => Promise<void>,
): Promise<void> {
  const p = `v${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const adminId = `${p}-admin`;
  const groupIds = Array.from({ length: GROUPS }, (_, i) => `${p}-g${i + 1}`);
  const managedIds = groupIds.slice(0, 10);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into "user" (id, name, email, email_verified, role)
        values (${adminId}, 'Volume Admin', ${`${p}-admin@example.com`}, true, 'admin')
      `);
      await tx.execute(sql`
        insert into "user" (id, name, email, email_verified, role)
        select ${p} || '-c' || i, 'Client ' || i, ${p} || '-c' || i || '@example.com', true, 'client'
        from generate_series(1, ${GROUPS}) i
      `);
      await tx.execute(sql`
        insert into groups (id, name, egrant_url, invite_token)
        select ${p} || '-g' || i, 'Volume ' || lpad(i::text, 3, '0'),
          'https://' || ${p} || i || '.egrant.sk', ${p} || '-invite-' || i
        from generate_series(1, ${GROUPS}) i
      `);
      await tx.execute(sql`
        insert into group_members (user_id, group_id)
        select ${p} || '-c' || i, ${p} || '-g' || i from generate_series(1, ${GROUPS}) i
      `);
      await tx.execute(sql`
        insert into group_managers (group_id, user_id)
        select ${p} || '-g' || i, ${adminId} from generate_series(1, 10) i
      `);
      await tx.execute(sql`
        insert into channels (id, group_id, kind)
        select ${p} || '-ch' || i, ${p} || '-g' || i, 'group' from generate_series(1, ${GROUPS}) i
      `);
      await tx.execute(sql`
        insert into buckets (id, group_id, kind, name, position)
        select ${p} || '-b' || i || '-' || k.kind, ${p} || '-g' || i, k.kind,
          case when k.kind = 'custom' then 'Step ' || (i % 15) end, k.pos
        from generate_series(1, ${GROUPS}) i
        cross join (values ('todo', 'a0'), ('custom', 'a1'), ('egrant_review', 'a3'),
          ('client_review', 'a6'), ('done', 'a9')) as k(kind, pos)
      `);
      // Task i is in group (i % 100) + 1; every tenth is completed, the rest spread over buckets.
      await tx.execute(sql`
        insert into tasks (id, group_id, bucket_id, position, title, created_by, due_date, urgent,
          completed_at, created_at, updated_at)
        select ${p} || '-t' || i, ${p} || '-g' || (i % ${GROUPS} + 1),
          ${p} || '-b' || (i % ${GROUPS} + 1) || '-' || case
            when i % 10 = 0 then 'done'
            else (array['todo', 'custom', 'egrant_review', 'client_review'])[i % 4 + 1] end,
          'p' || lpad(i::text, 6, '0'), 'Task ' || i, ${adminId},
          case when i % 3 = 0 then null else current_date + (i % 60 - 20) end,
          i % 17 = 0,
          case when i % 10 = 0 then now() - (i % 60) * interval '1 day' end,
          now() - i * interval '1 minute', now()
        from generate_series(1, ${TASKS}) i
      `);
      await tx.execute(sql`
        insert into task_assignees (task_id, user_id)
        select ${p} || '-t' || i, ${adminId} from generate_series(1, ${TASKS}) i where i % 3 = 1
      `);
      // Ticket i is in group (i % 100) + 1, every fiftieth has no client; nine in ten are resolved,
      // the rest New or In progress.
      await tx.execute(sql`
        insert into tickets (id, group_id, status, source, subject, body, created_at, updated_at)
        select ${p} || '-k' || i,
          case when i % 50 = 0 then null else ${p} || '-g' || (i % ${GROUPS} + 1) end,
          case when i % 10 = 1 then 'new' when i % 10 = 2 then 'in_progress' else 'resolved' end,
          'api', 'Ticket ' || i, 'Text of ticket ' || i,
          now() - i * interval '5 minutes', now()
        from generate_series(1, ${TICKETS}) i
      `);
      // Message i is in channel ((i - 1) / 2000) + 1; every tenth replies to the one before it.
      await tx.execute(sql`
        insert into messages (id, channel_id, author_id, parent_id, body, mentions_all, client_id,
          change_seq, created_at)
        select ${p} || '-m' || i,
          ${p} || '-ch' || ((i - 1) / ${MESSAGES_PER_CHANNEL} + 1),
          ${p} || '-c' || ((i - 1) / ${MESSAGES_PER_CHANNEL} + 1),
          case when i % 10 = 0 then ${p} || '-m' || (i - 1) end,
          'Message ' || i, i % 100 = 5, ${p} || '-m' || i, i,
          now() - (${MESSAGES} - i) * interval '20 seconds'
        from generate_series(1, ${MESSAGES}) i
      `);
      // A quarter of the messages name someone: 0.5 % of all messages name the admin (1 000, about
      // 22 a day over the seeded 46 days), the rest name the group's client. A user's share of the
      // mention rows stays small, as with many users in production.
      await tx.execute(sql`
        insert into message_mentions (message_id, user_id)
        select ${p} || '-m' || i,
          case when i % 200 = 3 then ${adminId}
            else ${p} || '-c' || ((i - 1) / ${MESSAGES_PER_CHANNEL} + 1) end
        from generate_series(1, ${MESSAGES}) i where i % 4 = 3
      `);
      await tx.execute(sql`
        insert into read_states (user_id, channel_id, last_read_at)
        select ${adminId}, ${p} || '-ch' || i, now() - interval '10 days'
        from generate_series(1, ${GROUPS}) i
      `);
      await tx.execute(sql`
        insert into thread_read_states (user_id, root_id, channel_id, last_read_at, last_reply_at)
        select ${adminId}, ${p} || '-m' || (i - 1), ${p} || '-ch' || ((i - 1) / ${MESSAGES_PER_CHANNEL} + 1),
          now() - interval '10 days', now() - (${MESSAGES} - i) * interval '20 seconds'
        from generate_series(1, ${MESSAGES}) i where i % 200 = 0
      `);
      for (const table of [
        'user',
        'groups',
        'group_managers',
        'channels',
        'buckets',
        'tasks',
        'task_assignees',
        'tickets',
        'messages',
        'message_mentions',
        'read_states',
        'thread_read_states',
      ]) {
        await tx.execute(sql.raw(`analyze "${table}"`));
      }
      await fn(tx as unknown as Db, { adminId, groupIds, managedIds });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
