import { sql, type SQL } from 'drizzle-orm';
import { HOME_LIMITS, plainExcerpt, type Mentions } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { managedGroupsSql } from '../groups/managers.js';

const recent = sql.raw(`now() - interval '${HOME_LIMITS.mentionDays} days'`);

/**
 * The viewer's unread mentions in one statement: messages that name them, or say @all in a group
 * they manage (Phase 18: @all reaches managers), by someone else, not deleted, from the last 90
 * days, and still unread for them: a top-level message after their read mark of its channel, a
 * reply after their read mark of its thread (the channel's mark when they have no thread row,
 * which is the case for an @all reply). Task and ticket chats count too (`ticketId` links a ticket
 * chat's message to its ticket page).
 *
 * The candidates are a `union` (not `union all`), so a message that names the viewer and also says
 * @all is one item. The @all parts start from the managed groups' channels and read
 * `messages_mentions_all_top_idx` / `_reply_idx` from the read mark (or 90 days) on. The newest
 * 100 are counted (the total is capped like other unread counts); the first 20 are returned.
 */
export function mentionsSql(userId: string): SQL {
  return sql`
    with candidates as (
      select mm.message_id as id
      from message_mentions mm
      where mm.user_id = ${userId}
      union
      select m.id
      from channels c
      left join read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
      join messages m
        on m.channel_id = c.id
        and m.mentions_all
        and m.deleted_at is null
        and m.parent_id is null
        and m.created_at > greatest(coalesce(rs.last_read_at, '-infinity'::timestamptz), ${recent})
      where c.group_id in ${managedGroupsSql(userId)}
      union
      select m.id
      from channels c
      join messages m
        on m.channel_id = c.id
        and m.mentions_all
        and m.deleted_at is null
        and m.parent_id is not null
        and m.created_at > ${recent}
      where c.group_id in ${managedGroupsSql(userId)}
    ),
    unread as (
      select m.id, m.channel_id, m.parent_id, m.author_id, m.body, m.created_at, c.task_id,
        c.ticket_id, c.group_id
      from candidates x
      join messages m on m.id = x.id
      join channels c on c.id = m.channel_id
      left join read_states rs on rs.channel_id = m.channel_id and rs.user_id = ${userId}
      left join thread_read_states trs on trs.root_id = m.parent_id and trs.user_id = ${userId}
      where m.author_id <> ${userId}
        and m.deleted_at is null
        and m.created_at > ${recent}
        and m.created_at > case
          when m.parent_id is null then coalesce(rs.last_read_at, '-infinity'::timestamptz)
          else coalesce(trs.last_read_at, rs.last_read_at, '-infinity'::timestamptz)
        end
      order by m.created_at desc, m.id desc
      limit ${HOME_LIMITS.mentionCap}
    )
    select
      u.id as message_id,
      u.channel_id,
      u.task_id,
      u.ticket_id,
      u.parent_id,
      u.group_id,
      g.name as group_name,
      a.name as author_name,
      u.body,
      u.created_at,
      (count(*) over ())::int as total,
      (
        select json_object_agg(mm.user_id, mu.name)
        from message_mentions mm
        join "user" mu on mu.id = mm.user_id
        where mm.message_id = u.id
      ) as mention_names
    from unread u
    join groups g on g.id = u.group_id
    join "user" a on a.id = u.author_id
    order by u.created_at desc, u.id desc
    limit ${HOME_LIMITS.mentions}
  `;
}

type Row = {
  message_id: string;
  channel_id: string;
  task_id: string | null;
  ticket_id: string | null;
  parent_id: string | null;
  group_id: string;
  group_name: string;
  author_name: string;
  body: string;
  created_at: string | Date;
  total: number;
  mention_names: Record<string, string> | null;
};

export async function getMentions(db: Db, userId: string): Promise<Mentions> {
  const rows = [...(await db.execute<Row>(mentionsSql(userId)))];
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map((r) => ({
      messageId: r.message_id,
      channelId: r.channel_id,
      taskId: r.task_id,
      ticketId: r.ticket_id,
      parentId: r.parent_id,
      groupId: r.group_id,
      groupName: r.group_name,
      authorName: r.author_name,
      excerpt: plainExcerpt(r.body, (id) => r.mention_names?.[id], HOME_LIMITS.excerpt),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}
