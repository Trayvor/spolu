import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * The tickets module's facts for the weekly client summary (spec 2026-10-19 §4): tickets of the
 * group resolved in the window, by number and subject only (a ticket without a client is never
 * one). `tickets_group_resolved_idx (group_id, resolved_at) where resolved_at is not null`.
 */

const FACTS_LIMIT = 50;

export function resolvedTicketsOfSql(
  groupId: string,
  from: Date,
  to: Date,
  limit = FACTS_LIMIT,
): SQL {
  return sql`select k.id, k.number, k.subject, k.resolved_at from tickets k
    where k.group_id = ${groupId} and k.status = 'resolved'
      and k.resolved_at >= ${from.toISOString()}::timestamptz
      and k.resolved_at < ${to.toISOString()}::timestamptz
    order by k.resolved_at desc, k.id desc limit ${limit}`;
}

export async function resolvedTicketsOf(
  db: Db,
  groupId: string,
  from: Date,
  to: Date,
  limit = FACTS_LIMIT,
): Promise<{ id: string; number: number; subject: string | null; resolvedAt: Date }[]> {
  const rows = await db.execute<{
    id: string;
    number: number;
    subject: string | null;
    resolved_at: string | Date;
  }>(resolvedTicketsOfSql(groupId, from, to, limit));
  return [...rows].map((r) => ({
    id: r.id,
    number: Number(r.number),
    subject: r.subject,
    resolvedAt: new Date(r.resolved_at),
  }));
}

/** `#12 Subject` (or `#12`) of those of `ids` that are tickets of the group now. */
export async function ticketTitlesInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(
    [...new Set(ids)].map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ id: string; number: number; subject: string | null }>(
    sql`select k.id, k.number, k.subject from tickets k
      where k.group_id = ${groupId} and k.id in (${list})`,
  );
  return new Map([...rows].map((r) => [r.id, ticketTitle(Number(r.number), r.subject)]));
}

export const ticketTitle = (number: number, subject: string | null): string =>
  subject && subject.trim() !== '' ? `#${number} ${subject.trim()}` : `#${number}`;

/** Which of `ids` are still tickets of the group (a ticket moved to another client is not). */
export async function ticketRefsInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Set<string>> {
  return new Set((await ticketTitlesInGroup(db, groupId, ids)).keys());
}
