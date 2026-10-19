import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { SearchTicketHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import type { GroupAccess } from '../groups/memberships.js';
import { groups } from '../groups/schema.js';
import { isAdmin } from '../users/policy.js';
import { canReadTicket } from './policy.js';
import { tickets } from './schema.js';

/**
 * What `actor` reads (`canReadTicket`) as SQL: admins every ticket; otherwise every ticket of a
 * group where they are a client, and their own ones where they are a ziadatel. Null: nothing.
 */
function readableSql(actor: SessionUser, access: GroupAccess): SQL | undefined | null {
  if (isAdmin(actor)) return undefined;
  const client: string[] = [];
  const requester: string[] = [];
  for (const [groupId, role] of access.roles)
    (role === 'client' ? client : requester).push(groupId);
  const parts: SQL[] = [];
  if (client.length > 0) parts.push(inArray(tickets.groupId, client));
  if (requester.length > 0) {
    parts.push(and(inArray(tickets.groupId, requester), eq(tickets.requesterUserId, actor.id))!);
  }
  return parts.length === 0 ? null : or(...parts)!;
}

/**
 * Global search (2026-10-18): tickets by number (`#123` or `123`, the unique index) or by a
 * fragment of the folded subject (`tickets_subject_fold_trgm_idx`). The number first, then the
 * best rank, open before resolved, newest first. One query; null when the actor reads none.
 */
export function ticketSearchSql(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
) {
  const readable = readableSql(actor, access);
  if (readable === null) return null;
  const folded = foldSql(tickets.subject);
  // Nothing of a deactivated group, for admins too (owner decision); a ticket without a client
  // has no group row in the join, so it stays.
  const live = isNull(groups.deactivatedAt);
  const bySubject = matchesAllSql(folded, text.terms);
  const match = text.number === null ? bySubject : or(eq(tickets.number, text.number), bySubject);
  const isNumber =
    text.number === null
      ? sql`1`
      : sql`(case when ${tickets.number} = ${text.number} then 0 else 1 end)`;
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      groupId: tickets.groupId,
      groupName: groups.name,
      requesterUserId: tickets.requesterUserId,
    })
    .from(tickets)
    .leftJoin(groups, eq(groups.id, tickets.groupId))
    .where(and(match, readable, live))
    .orderBy(
      isNumber,
      rankSql(folded, text.key),
      sql`(${tickets.status} = 'resolved')`,
      desc(tickets.createdAt),
      desc(tickets.id),
    )
    .limit(limit);
}

export async function searchTickets(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): Promise<SearchTicketHit[]> {
  const query = ticketSearchSql(db, actor, access, text, limit);
  if (query === null) return [];
  const rows = await query;
  // The policy has the last word on every row.
  return rows
    .filter((row) =>
      canReadTicket(
        actor,
        row,
        row.groupId === null ? null : (access.roles.get(row.groupId) ?? null),
      ),
    )
    .map(({ id, number, subject, status, groupId, groupName }) => ({
      id,
      number,
      subject,
      status,
      groupId,
      groupName,
    }));
}

/**
 * Message search (2026-10-19): the tickets `actorId` started in `groupIds` (their ziadatel
 * groups), as a subquery for another module's `in (…)`: the chat module scopes a ziadatel's
 * ticket chats with it and never reads this table itself.
 */
export function requesterTicketIdsSql(actorId: string, groupIds: string[]): SQL {
  if (groupIds.length === 0) return sql`select null::text where false`;
  return sql`select ${tickets.id} from ${tickets} where ${tickets.requesterUserId} = ${actorId}
    and ${inArray(tickets.groupId, groupIds)}`;
}

/**
 * Message search (2026-10-19): of `ids`, the tickets `actor` reads (`canReadTicket` with their
 * role from `access`), with their number and subject, for the hits of ticket chats. One query;
 * none for an empty list.
 */
export async function readableTicketLabels(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  ids: string[],
): Promise<Map<string, { number: number; subject: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      groupId: tickets.groupId,
      requesterUserId: tickets.requesterUserId,
    })
    .from(tickets)
    .where(inArray(tickets.id, [...new Set(ids)]));
  return new Map(
    rows
      .filter((row) =>
        canReadTicket(
          actor,
          row,
          row.groupId === null ? null : (access.roles.get(row.groupId) ?? null),
        ),
      )
      .map((row) => [row.id, { number: row.number, subject: row.subject }]),
  );
}
