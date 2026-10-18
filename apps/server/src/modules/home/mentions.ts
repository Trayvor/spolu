import { sql, type SQL } from 'drizzle-orm';
import {
  HOME_LIMITS,
  plainExcerpt,
  type DescriptionSubjectKind,
  type MentionItem,
  type Mentions,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { managedGroupsSql } from '../groups/managers.js';
import { unreadDescriptionMentionsSql } from '../notifications/description-mentions.js';
import { mentionNotifiesSql } from '../notifications/follows.js';
import { readableTicketIds } from '../tickets/service.js';

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
 * @all is one item. The direct mentions read `message_mentions_user_created_idx` for the last 90
 * days only (each mention row carries its message's `created_at`), so the viewer's older mentions
 * are never looked up. The @all parts start from the managed groups' channels and read
 * `messages_mentions_all_top_idx` / `_reply_idx` from the read mark (or 90 days) on. The newest
 * 100 are counted (the total is capped like other unread counts); the first 20 are returned.
 *
 * Each candidate reads its message by `messages_pkey`, in a `lateral` subquery that `offset 0`
 * keeps from being flattened into a join. As a plain join the planner may instead hash the
 * candidates against a parallel sequential scan of `messages`: with a viewer named in a few per
 * cent of the mention rows and `messages` still small (the seeded volume, a young database), its
 * cost model puts that scan below a thousand index lookups, although the lookups run several
 * times faster on a warm cache, and the scan grows with every message while the lookups grow only
 * with the viewer's mentions.
 *
 * Only mentions that would notify the viewer count (2026-10-17, the dashboard follows the
 * notification settings): `mentionNotifiesSql` (the notifications module's mirror of delivery)
 * drops a chat or task chat whose channel is None or whose group is Off, and a ticket chat whose
 * ticket board channel is None.
 *
 * Mentions in descriptions (2026-10-18, `description.mention`): someone named the viewer in a
 * task description, a ticket text, a project description or a knowledge item body. The
 * notifications module's `unreadDescriptionMentionsSql` gives those that would notify the viewer
 * and are newer than their last open of the subject; each is kept while its subject exists (one
 * primary key lookup of its table) and carries the subject's current title. The newest 100 of
 * them join the chat's 100, the total counts both (capped at 100) and the newest 20 of both are
 * returned.
 */
export function mentionsSql(userId: string): SQL {
  return sql`
    with candidates as (
      select mm.message_id as id
      from message_mentions mm
      where mm.user_id = ${userId} and mm.created_at > ${recent}
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
      cross join lateral (
        select m.id, m.channel_id, m.parent_id, m.author_id, m.body, m.created_at
        from messages m
        where m.id = x.id
          and m.author_id <> ${userId}
          and m.deleted_at is null
          and m.created_at > ${recent}
        offset 0
      ) m
      join channels c on c.id = m.channel_id
      left join read_states rs on rs.channel_id = m.channel_id and rs.user_id = ${userId}
      left join thread_read_states trs on trs.root_id = m.parent_id and trs.user_id = ${userId}
      where ${mentionNotifiesSql(userId, {
        groupId: sql`c.group_id`,
        taskId: sql`c.task_id`,
        ticketId: sql`c.ticket_id`,
      })}
        and m.created_at > case
          when m.parent_id is null then coalesce(rs.last_read_at, '-infinity'::timestamptz)
          else coalesce(trs.last_read_at, rs.last_read_at, '-infinity'::timestamptz)
        end
      order by m.created_at desc, m.id desc
      limit ${HOME_LIMITS.mentionCap}
    ),
    described as (
      select d.id, d.group_id, d.created_at, d.author_name, d.subject_kind, d.subject_id,
        s.title, s.number
      from (${unreadDescriptionMentionsSql(userId, recent)}) d
      cross join lateral (
        select t.title, null::int as number from tasks t
        where d.subject_kind = 'task' and t.id = d.subject_id
        union all
        select coalesce(k.subject, ''), k.number from tickets k
        where d.subject_kind = 'ticket' and k.id = d.subject_id
        union all
        select p.name, null from projects p
        where d.subject_kind = 'project' and p.id = d.subject_id
        union all
        select i.title, null from knowledge_items i
        where d.subject_kind = 'knowledge' and i.id = d.subject_id
      ) s
      order by d.created_at desc, d.id desc
      limit ${HOME_LIMITS.mentionCap}
    ),
    merged as (
      select 'chat' as source, u.id, u.channel_id, u.task_id, u.ticket_id, u.parent_id,
        u.group_id, u.author_id, null::text as author_name, u.body, u.created_at,
        null::text as subject_kind, null::text as subject_id, null::text as title,
        null::int as number
      from unread u
      union all
      select 'description', d.id, null, null, null, null, d.group_id, null, d.author_name, null,
        d.created_at, d.subject_kind, d.subject_id, d.title, d.number
      from described d
    )
    select
      x.source,
      x.id,
      x.channel_id,
      x.task_id,
      x.ticket_id,
      x.parent_id,
      x.group_id,
      g.name as group_name,
      coalesce(a.name, x.author_name, '') as author_name,
      x.body,
      x.created_at,
      x.subject_kind,
      x.subject_id,
      x.title,
      x.number,
      least(count(*) over (), ${HOME_LIMITS.mentionCap})::int as total,
      (
        select json_object_agg(mm.user_id, mu.name)
        from message_mentions mm
        join "user" mu on mu.id = mm.user_id
        where x.source = 'chat' and mm.message_id = x.id
      ) as mention_names
    from merged x
    join groups g on g.id = x.group_id
    left join "user" a on a.id = x.author_id
    order by x.created_at desc, x.id desc
    limit ${HOME_LIMITS.mentions}
  `;
}

type Row = {
  source: 'chat' | 'description';
  id: string;
  channel_id: string | null;
  task_id: string | null;
  ticket_id: string | null;
  parent_id: string | null;
  group_id: string;
  group_name: string;
  author_name: string;
  body: string | null;
  created_at: string | Date;
  subject_kind: DescriptionSubjectKind | null;
  subject_id: string | null;
  title: string | null;
  number: number | null;
  total: number;
  mention_names: Record<string, string> | null;
};

/** The ticket an item opens, if any: a ticket chat's message or a ticket's text. */
const ticketOf = (r: Row): string | null =>
  r.source === 'chat' ? r.ticket_id : r.subject_kind === 'ticket' ? r.subject_id : null;

function toItem(r: Row): MentionItem {
  const common = {
    groupId: r.group_id,
    groupName: r.group_name,
    authorName: r.author_name,
    createdAt: new Date(r.created_at).toISOString(),
  };
  if (r.source === 'description') {
    return {
      source: 'description',
      id: r.id,
      subjectKind: r.subject_kind!,
      subjectId: r.subject_id!,
      title: r.title ?? '',
      ticketNumber: r.number,
      ...common,
    };
  }
  return {
    source: 'chat',
    messageId: r.id,
    channelId: r.channel_id!,
    taskId: r.task_id,
    ticketId: r.ticket_id,
    parentId: r.parent_id,
    ...common,
    excerpt: plainExcerpt(r.body ?? '', (id) => r.mention_names?.[id], HOME_LIMITS.excerpt),
  };
}

/**
 * The viewer's unread mentions. An item of a ticket (a ticket chat's message, a mention in a
 * ticket's text) is dropped when the viewer no longer reads the ticket (the tickets policy,
 * checked for the listed items in one batch), so no item opens a not-found page.
 */
export async function getMentions(db: Db, viewer: SessionUser): Promise<Mentions> {
  const all = [...(await db.execute<Row>(mentionsSql(viewer.id)))];
  const ticketIds = all.flatMap((r) => ticketOf(r) ?? []);
  const readable = await readableTicketIds(db, viewer, ticketIds);
  const rows = all.filter((r) => {
    const ticketId = ticketOf(r);
    return ticketId === null || readable.has(ticketId);
  });
  return {
    total: Math.max((all[0]?.total ?? 0) - (all.length - rows.length), rows.length),
    items: rows.map(toItem),
  };
}
