import { sql, type SQL } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listGroupPeople } from '../groups/service.js';

/**
 * The chat module's messages for the weekly client summary (spec 2026-10-19 §4): live messages
 * of the group chat and the group's task chats written in `[from, to)`, which the group's
 * clients read. Ticket chats are never read (they hold requesters' personal data). The AI
 * picks highlights from them; only text and names leave the server.
 */

export type WeeklyMessageOptions = { limit: number; maxChars: number; totalChars: number };
export const WEEKLY_MESSAGE_LIMITS: WeeklyMessageOptions = {
  limit: 150,
  maxChars: 500,
  totalChars: 40_000,
};

/**
 * The newest `limit` messages: the group's channels by `channels_group_id_idx`, then one lateral
 * range per channel on `messages_channel_parent_created_idx (channel_id, …, created_at)`.
 */
export function clientVisibleMessagesOfSql(
  groupId: string,
  from: Date,
  to: Date,
  limit: number,
): SQL {
  return sql`select m.id, m.body, m.created_at, u.name as author, c.task_id
    from channels c
    cross join lateral (
      select x.id, x.body, x.created_at, x.author_id from messages x
      where x.channel_id = c.id and x.deleted_at is null
        and x.created_at >= ${from.toISOString()}::timestamptz
        and x.created_at < ${to.toISOString()}::timestamptz
      order by x.created_at desc limit ${limit}
    ) m
    join "user" u on u.id = m.author_id
    where c.group_id = ${groupId} and c.kind in ('group', 'task')
    order by m.created_at desc, m.id desc limit ${limit}`;
}

export type WeeklyMessage = { author: string; text: string; at: Date; taskId: string | null };

/**
 * Oldest first after taking the newest `limit`; each text as plain text (a mention of a person
 * of the group by name, anyone else `@?`), cut to `maxChars`, and no more than `totalChars` in
 * all (the newest kept).
 */
export async function clientVisibleMessagesOf(
  db: Db,
  groupId: string,
  from: Date,
  to: Date,
  opts: WeeklyMessageOptions = WEEKLY_MESSAGE_LIMITS,
): Promise<WeeklyMessage[]> {
  const rows = [
    ...(await db.execute<{
      id: string;
      body: string;
      created_at: string | Date;
      author: string;
      task_id: string | null;
    }>(clientVisibleMessagesOfSql(groupId, from, to, opts.limit))),
  ];
  if (rows.length === 0) return [];
  const people = new Map((await listGroupPeople(db, groupId)).map((p) => [p.id, p.name]));
  const out: WeeklyMessage[] = [];
  let total = 0;
  for (const r of rows) {
    const text = cutText(
      plainExcerpt(r.body, (id) => people.get(id), Number.POSITIVE_INFINITY),
      opts.maxChars,
    );
    if (text === '') continue;
    if (total + text.length > opts.totalChars) break;
    total += text.length;
    out.push({ author: r.author, text, at: new Date(r.created_at), taskId: r.task_id });
  }
  return out.reverse();
}

const cutText = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
