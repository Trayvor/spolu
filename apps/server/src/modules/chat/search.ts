import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { MessageSearchPage, SearchMessageHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isQueryCanceled } from '../../infra/db/errors.js';
import {
  escapeLike,
  hasIndexableTerm,
  matchesAllSql,
  type SearchText,
} from '../../infra/text/search.js';
import { clientIdsOf, type GroupAccess } from '../groups/memberships.js';
import { groups } from '../groups/schema.js';
import { getTaskTitles } from '../tasks/task-service.js';
import { readableTicketLabels, requesterTicketIdsSql } from '../tickets/search.js';
import { isAdmin } from '../users/policy.js';
import { user } from '../users/schema.js';
import { canReadChannel } from './policy.js';
import { channels, messageMentions, messages } from './schema.js';
import { messageSnippet } from './snippet.js';

/**
 * Search in chat messages (2026-10-19, ADR 0057): fragments of `messages.search_text` (the body
 * folded, a stored generated column) through `messages_search_text_trgm_idx`, in the channels
 * the actor reads, nothing of a deactivated group (admins included) and no deleted message.
 */

/** Where the next page starts: after this rank, time and id (`rank`, then newest first). */
export type MessageCursor = { rank: number; createdAt: string; id: string };

export type MessageSearchOptions = {
  limit: number;
  cursor?: MessageCursor;
  /** Only this group's channels (a group the actor does not read gives an empty page). */
  groupId?: string;
  /** The statement timeout in ms (default 2000); only tests change it. */
  timeoutMs?: number;
};

/** The search ran into its time limit: the query is too broad. */
export const TOO_BROAD: unique symbol = Symbol('too broad');

const TIMEOUT_MS = 2000;
const EMPTY: MessageSearchPage = { hits: [], nextCursor: null, tooBroad: false };

export function encodeMessageCursor(c: MessageCursor): string {
  return Buffer.from(JSON.stringify([c.rank, c.createdAt, c.id])).toString('base64url');
}

/** The cursor of `encodeMessageCursor`; null for anything malformed. */
export function decodeMessageCursor(s: string): MessageCursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [rank, createdAt, id] = value as unknown[];
    if (rank !== 0 && rank !== 1 && rank !== 2) return null;
    if (typeof createdAt !== 'string' || typeof id !== 'string' || id.length === 0) return null;
    const at = new Date(createdAt);
    if (Number.isNaN(at.getTime()) || at.toISOString() !== createdAt) return null;
    return { rank, createdAt, id };
  } catch {
    return null;
  }
}

/**
 * The rank of a hit: 0 the whole query at a word start, 1 the whole query anywhere, 2 only the
 * terms separately. A cheap `like` on the matching rows' folded column.
 */
export function rankMessageSql(text: SearchText): SQL<number> {
  const key = escapeLike(text.key);
  const col = messages.searchText;
  return sql<number>`(case when ${col} like ${`${key}%`} escape '\\'
    or ${col} like ${`% ${key}%`} escape '\\' then 0
    when ${col} like ${`%${key}%`} escape '\\' then 1 else 2 end)`;
}

/**
 * The channels `actor` reads, as SQL on `channels`: admins every one (undefined); a client every
 * channel of their client groups (group, task and ticket chats); a ziadatel only the chats of
 * the tickets they started in their ziadatel groups (`requesterTicketIdsSql`, the tickets
 * module's own SQL). Null: none.
 */
function readableChannelsSql(actor: SessionUser, access: GroupAccess): SQL | undefined | null {
  if (isAdmin(actor)) return undefined;
  const client: string[] = [];
  const requester: string[] = [];
  for (const [groupId, role] of access.roles) {
    (role === 'client' ? client : requester).push(groupId);
  }
  const parts: SQL[] = [];
  if (client.length > 0) parts.push(inArray(channels.groupId, client));
  if (requester.length > 0) {
    parts.push(
      and(
        eq(channels.kind, 'ticket'),
        sql`${channels.ticketId} in (${requesterTicketIdsSql(actor.id, requester)})`,
      )!,
    );
  }
  return parts.length === 0 ? null : or(...parts)!;
}

/**
 * The message search's one query (exported for the EXPLAIN checks): `limit + 1` rows, best rank
 * first, then newest. Null when the actor reads no channel or no term has 3 characters. Terms
 * shorter than that are checked on a copy of the column the index does not cover (`|| ''`): as an
 * index condition, a pattern without a trigram would read the whole index.
 */
export function messageSearchSql(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  opts: MessageSearchOptions,
) {
  if (!hasIndexableTerm(text)) return null;
  const readable = readableChannelsSql(actor, access);
  if (readable === null) return null;
  const long = text.terms.filter((term) => term.length >= 3);
  const short = text.terms.filter((term) => term.length < 3);
  const rank = rankMessageSql(text);
  const after = opts.cursor
    ? sql`(${rank} > ${opts.cursor.rank} or (${rank} = ${opts.cursor.rank} and
        (${messages.createdAt}, ${messages.id}) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id})))`
    : undefined;
  return db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      channelKind: channels.kind,
      taskId: channels.taskId,
      ticketId: channels.ticketId,
      parentId: messages.parentId,
      groupId: channels.groupId,
      groupName: groups.name,
      // Read-only, as in `selectMessages`: the author's and the mentioned people's names.
      authorName: user.name,
      body: messages.body,
      createdAt: messages.createdAt,
      rank,
      mentionNames: sql<Record<string, string>>`coalesce((
        select json_object_agg(mu.id, mu.name)
        from ${messageMentions} join ${user} mu on mu.id = ${messageMentions.userId}
        where ${messageMentions.messageId} = ${messages.id}
      ), '{}'::json)`,
    })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(groups, eq(groups.id, channels.groupId))
    .leftJoin(user, eq(user.id, messages.authorId))
    .where(
      and(
        matchesAllSql(messages.searchText, long),
        short.length > 0 ? matchesAllSql(sql`(${messages.searchText} || '')`, short) : undefined,
        // The index's predicate, repeated so the planner can use it.
        isNull(messages.deletedAt),
        sql`${messages.searchText} <> ''`,
        // Nothing of a deactivated group, for admins too (owner decision).
        isNull(groups.deactivatedAt),
        readable,
        opts.groupId === undefined ? undefined : eq(channels.groupId, opts.groupId),
        after,
      ),
    )
    .orderBy(rank, desc(messages.createdAt), desc(messages.id))
    .limit(opts.limit + 1);
}

/**
 * Runs `run` in a transaction with `statement_timeout` set to `ms` for it alone; a statement
 * cancelled by it resolves to `TOO_BROAD` instead of failing.
 */
export async function withStatementTimeout<T>(
  db: Db,
  ms: number,
  run: (tx: Db) => Promise<T>,
): Promise<T | typeof TOO_BROAD> {
  if (!Number.isInteger(ms) || ms <= 0) throw new Error(`invalid statement timeout ${ms}`);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = ${ms}`));
      return run(tx);
    });
  } catch (error) {
    if (isQueryCanceled(error)) return TOO_BROAD;
    throw error;
  }
}

/**
 * One page of message hits (`GET /api/search/messages`, and the `messages` of `GET /api/search`).
 * The query is scoped by the readable channels; the policy then has the last word on every row:
 * `canReadChannel` for group and task chats, `readableTicketLabels` (`canReadTicket`) for ticket
 * chats. Labels: task titles (tasks module) and ticket numbers, in parallel, each only when such
 * rows exist. At most begin, `set local`, the search, commit, ticket labels and task titles: six
 * statements. Over the 2 s limit: `tooBroad`.
 */
export async function searchMessages(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  opts: MessageSearchOptions,
): Promise<MessageSearchPage> {
  if (messageSearchSql(db, actor, access, text, opts) === null) return EMPTY;
  const rows = await withStatementTimeout(db, opts.timeoutMs ?? TIMEOUT_MS, async (tx) =>
    messageSearchSql(tx, actor, access, text, opts)!,
  );
  if (rows === TOO_BROAD) return { hits: [], nextCursor: null, tooBroad: true };
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  // From the last row read, kept or not, so a dropped row is never read again.
  const nextCursor =
    rows.length > opts.limit && last
      ? encodeMessageCursor({
          rank: Number(last.rank),
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;
  const ticketIds = page.flatMap((r) =>
    r.channelKind === 'ticket' && r.ticketId ? [r.ticketId] : [],
  );
  const taskIds = page.flatMap((r) => (r.channelKind === 'task' && r.taskId ? [r.taskId] : []));
  const [ticketLabels, taskTitles] = await Promise.all([
    readableTicketLabels(db, actor, access, ticketIds),
    getTaskTitles(db, taskIds),
  ]);
  const clientIds = clientIdsOf(access);
  const hits: SearchMessageHit[] = [];
  for (const row of page) {
    const kind = row.channelKind as SearchMessageHit['channelKind'];
    const readable =
      kind === 'ticket'
        ? row.ticketId !== null && ticketLabels.has(row.ticketId)
        : canReadChannel(actor, row, clientIds);
    if (!readable) continue;
    const names = row.mentionNames ?? {};
    hits.push({
      id: row.id,
      channelId: row.channelId,
      channelKind: kind,
      parentId: row.parentId,
      groupId: row.groupId,
      groupName: row.groupName,
      taskId: kind === 'task' ? row.taskId : null,
      taskTitle: kind === 'task' && row.taskId ? (taskTitles.get(row.taskId) ?? null) : null,
      ticketId: kind === 'ticket' ? row.ticketId : null,
      ticketNumber:
        kind === 'ticket' && row.ticketId ? (ticketLabels.get(row.ticketId)?.number ?? null) : null,
      authorName: row.authorName,
      createdAt: row.createdAt.toISOString(),
      ...messageSnippet(row.body, (id) => names[id], text.terms),
    });
  }
  return { hits, nextCursor, tooBroad: false };
}
