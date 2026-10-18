import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

export type UnreadForNotify = { id: string; channelId: string; parentId: string | null };

/**
 * The messages each user has not read yet, for notification delivery, keyed
 * `${userId}:${messageId}`; pairs whose message is read, deleted, the user's own or unknown are
 * absent. A top-level message is unread past the channel read mark (`read_states`), a reply past
 * its thread's read mark (`thread_read_states` of the root); a reply with no thread row counts as
 * unread. One query.
 */
export async function unreadForNotify(
  db: Db,
  pairs: { userId: string; messageId: string }[],
): Promise<Map<string, UnreadForNotify>> {
  const result = new Map<string, UnreadForNotify>();
  if (pairs.length === 0) return result;
  const values = sql.join(
    pairs.map((p) => sql`(${p.userId}::text, ${p.messageId}::text)`),
    sql`, `,
  );
  const rows = await db.execute<{
    user_id: string;
    id: string;
    channel_id: string;
    parent_id: string | null;
  }>(sql`
    select p.user_id, m.id, m.channel_id, m.parent_id
    from (values ${values}) as p(user_id, message_id)
    join messages m on m.id = p.message_id
    left join read_states rs
      on m.parent_id is null and rs.user_id = p.user_id and rs.channel_id = m.channel_id
    left join thread_read_states t
      on m.parent_id is not null and t.root_id = m.parent_id and t.user_id = p.user_id
    where m.deleted_at is null
      and m.author_id <> p.user_id
      and m.created_at > coalesce(
        case when m.parent_id is null then rs.last_read_at else t.last_read_at end,
        '-infinity'::timestamptz
      )
  `);
  for (const r of rows) {
    result.set(`${r.user_id}:${r.id}`, {
      id: r.id,
      channelId: r.channel_id,
      parentId: r.parent_id,
    });
  }
  return result;
}

/**
 * The thread root of each of the given messages that still exist (not deleted), for the
 * notification centre's links; a deleted or unknown message is absent. One primary-key query.
 */
export async function liveMessageParents(
  db: Db,
  messageIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; parent_id: string | null }>(sql`
    select m.id, m.parent_id from messages m
    where m.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) and m.deleted_at is null
  `);
  return new Map([...rows].map((r) => [r.id, r.parent_id]));
}
