import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * The tasks module's facts for the weekly client summary (spec 2026-10-19 §4): every task of a
 * client group is read by its clients, so these are the clients' own view. Each reader is one
 * bounded, indexed query; the `…Sql` builders are exported for the EXPLAIN check.
 */

const FACTS_LIMIT = 50;

/** Completed in `[from, to)`, newest first: `tasks_open_group_idx (group_id, completed_at)`. */
export function doneTasksOfSql(groupId: string, from: Date, to: Date, limit = FACTS_LIMIT): SQL {
  return sql`select t.id, t.title, t.completed_at from tasks t
    where t.group_id = ${groupId}
      and t.completed_at >= ${from.toISOString()}::timestamptz
      and t.completed_at < ${to.toISOString()}::timestamptz
    order by t.completed_at desc, t.id desc limit ${limit}`;
}

export async function doneTasksOf(
  db: Db,
  groupId: string,
  from: Date,
  to: Date,
  limit = FACTS_LIMIT,
): Promise<{ id: string; title: string; completedAt: Date }[]> {
  const rows = await db.execute<{ id: string; title: string; completed_at: string | Date }>(
    doneTasksOfSql(groupId, from, to, limit),
  );
  return [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    completedAt: new Date(r.completed_at),
  }));
}

/**
 * Open tasks in the group's "Na kontrole u klienta" bucket, by board position:
 * `buckets_group_fixed_kind_unique`, then `tasks_bucket_position_unique`.
 */
export function waitingOnClientTasksOfSql(groupId: string, limit = FACTS_LIMIT): SQL {
  return sql`select t.id, t.title, t.due_date::text as due_date from buckets b
    join tasks t on t.bucket_id = b.id
    where b.group_id = ${groupId} and b.kind = 'client_review' and t.completed_at is null
    order by t.position limit ${limit}`;
}

export async function waitingOnClientTasksOf(
  db: Db,
  groupId: string,
  limit = FACTS_LIMIT,
): Promise<{ id: string; title: string; dueDate: string | null }[]> {
  const rows = await db.execute<{ id: string; title: string; due_date: string | null }>(
    waitingOnClientTasksOfSql(groupId, limit),
  );
  return [...rows].map((r) => ({ id: r.id, title: r.title, dueDate: r.due_date }));
}

/**
 * Open tasks due from `fromDay` to `toDay` (both included, `YYYY-MM-DD`), by date:
 * `tasks_group_due_open_idx (group_id, due_date) where completed_at is null`.
 */
export function dueTasksOfSql(
  groupId: string,
  fromDay: string,
  toDay: string,
  limit = FACTS_LIMIT,
): SQL {
  return sql`select t.id, t.title, t.due_date::text as due_date from tasks t
    where t.group_id = ${groupId} and t.completed_at is null
      and t.due_date >= ${fromDay}::date and t.due_date <= ${toDay}::date
    order by t.due_date, t.id limit ${limit}`;
}

export async function dueTasksOf(
  db: Db,
  groupId: string,
  fromDay: string,
  toDay: string,
  limit = FACTS_LIMIT,
): Promise<{ id: string; title: string; dueDate: string }[]> {
  const rows = await db.execute<{ id: string; title: string; due_date: string }>(
    dueTasksOfSql(groupId, fromDay, toDay, limit),
  );
  return [...rows].map((r) => ({ id: r.id, title: r.title, dueDate: r.due_date }));
}

/** The titles of those of `ids` that are tasks of the group (a deleted or moved one is absent). */
export async function taskTitlesInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(
    [...new Set(ids)].map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ id: string; title: string }>(
    sql`select t.id, t.title from tasks t where t.group_id = ${groupId} and t.id in (${list})`,
  );
  return new Map([...rows].map((r) => [r.id, r.title]));
}

/** Which of `ids` are still tasks of the group (the Send check, spec §7.2). */
export async function taskRefsInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Set<string>> {
  return new Set((await taskTitlesInGroup(db, groupId, ids)).keys());
}
