import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { TASK_SEARCH_PAGE, type MessageAttachedTask, type TaskSearchPage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { escapeLike } from '../../infra/text/search.js';
import { isAdminGroupSql } from '../groups/admin-group.js';
import { user } from '../users/schema.js';
import { buckets, taskAssignees, tasks } from './schema.js';

/** The card of a task that exists: `MessageAttachedTask` with `available: true`. */
export type AttachableTaskCard = Extract<MessageAttachedTask, { available: true }>;

/** Assignees on a card; the task panel shows the rest. */
const CARD_ASSIGNEES = 3;

// Deliberate read-only exception to "no other module's tables" (like `selectTasks`): the
// assignees' names come from a join on `user` inside the one query.
/** The select shared by the cards and the picker's search: one row per task, assignees inline. */
const taskCardColumns = {
  id: tasks.id,
  groupId: tasks.groupId,
  title: tasks.title,
  completedAt: tasks.completedAt,
  bucketKind: buckets.kind,
  bucketName: buckets.name,
  dueDate: tasks.dueDate,
  urgent: tasks.urgent,
  assignees: sql<{ id: string; name: string }[]>`coalesce((
    select json_agg(a) from (
      select ${user.id} as id, ${user.name} as name
      from ${taskAssignees}
      join ${user} on ${user.id} = ${taskAssignees.userId}
      where ${taskAssignees.taskId} = ${tasks.id}
      order by ${user.name}, ${user.id}
      limit ${sql.raw(String(CARD_ASSIGNEES))}
    ) a
  ), '[]'::json)`,
};

type TaskCardRow = {
  id: string;
  groupId: string;
  title: string;
  completedAt: Date | null;
  bucketKind: string;
  bucketName: string | null;
  dueDate: string | null;
  urgent: boolean;
  assignees: { id: string; name: string }[];
};

const toTaskCard = (row: TaskCardRow): AttachableTaskCard => ({
  id: row.id,
  available: true,
  groupId: row.groupId,
  title: row.title,
  completed: row.completedAt !== null,
  bucketKind: row.bucketKind,
  bucketName: row.bucketName,
  assignees: row.assignees,
  dueDate: row.dueDate,
  urgent: row.urgent,
});

/**
 * Phase 34: the cards of these tasks that belong to `targetGroupId` now, by id, with live fields
 * (done, bucket, assignees, deadline); the others (deleted, or of another group) are left out and
 * show as unavailable. In the admin group every task of every group passes (part D, decision 12:
 * its readers are admins, who read every task). One query for any number of ids. A channel's
 * readers read every task of its group, so the cards need no per-reader check.
 */
export async function attachableTaskCards(
  db: Db,
  targetGroupId: string,
  ids: string[],
): Promise<Map<string, AttachableTaskCard>> {
  const cards = new Map<string, AttachableTaskCard>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return cards;
  const rows = await db
    .select(taskCardColumns)
    .from(tasks)
    .innerJoin(buckets, eq(buckets.id, tasks.bucketId))
    .where(
      and(
        inArray(tasks.id, unique),
        or(eq(tasks.groupId, targetGroupId), isAdminGroupSql(targetGroupId)),
      ),
    );
  for (const row of rows) cards.set(row.id, toTaskCard(row));
  return cards;
}

/** The cursor of the search is not one this server made (route: 400). */
export class InvalidTaskSearchCursorError extends Error {
  constructor() {
    super('Invalid task search cursor');
    this.name = 'InvalidTaskSearchCursorError';
  }
}

const encodeCursor = (row: { completedAt: Date | null; createdAt: Date; id: string }) =>
  Buffer.from(
    `${row.completedAt === null ? 0 : 1}|${row.createdAt.toISOString()}|${row.id}`,
  ).toString('base64url');

function decodeCursor(cursor: string): { done: boolean; createdAt: Date; id: string } {
  const [done, at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  if ((done !== '0' && done !== '1') || !id || Number.isNaN(createdAt.getTime())) {
    throw new InvalidTaskSearchCursorError();
  }
  return { done: done === '1', createdAt, id };
}

/**
 * Phase 34: the picker's search in one group's tasks. `q` (from 2 characters; empty = all) is a
 * title fragment, served by the trigram index `tasks_title_trgm_idx` within the group; open tasks
 * first, then completed, newest first in each; keyset-paged by `after`, 20 a page. One query.
 */
export async function searchTasks(
  db: Db,
  groupId: string,
  query: SearchQuery,
): Promise<TaskSearchPage> {
  return toPage(await taskSearchQuery(db, groupId, query));
}

/**
 * Phase 34 part D: the admin group's picker search across groups (`GET /api/tasks/search`, admins
 * only): the tasks of `groupIds` (the admin group's too when chosen), or of every group when
 * null. The same order, paging and title search as `searchTasks`; a page of every group without a
 * title reads `tasks_search_order_idx` in order. One query.
 */
export async function searchAllTasks(
  db: Db,
  groupIds: string[] | null,
  query: SearchQuery,
): Promise<TaskSearchPage> {
  return toPage(await allTaskSearchQuery(db, groupIds, query));
}

type SearchQuery = { q: string; after?: string | undefined };

function toPage(rows: (TaskCardRow & { createdAt: Date })[]): TaskSearchPage {
  const page = rows.slice(0, TASK_SEARCH_PAGE);
  return {
    items: page.map(toTaskCard),
    next: rows.length > TASK_SEARCH_PAGE ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** The search's one query, not yet run (the EXPLAIN check wraps it). */
export function taskSearchQuery(db: Db, groupId: string, query: SearchQuery) {
  return searchQuery(eq(tasks.groupId, groupId), db, query);
}

/** The cross-group search's one query, not yet run (the EXPLAIN check wraps it). */
export function allTaskSearchQuery(db: Db, groupIds: string[] | null, query: SearchQuery) {
  // A deactivated group's tasks are left out of the search across groups.
  const live = sql`not exists (select 1 from groups dg where dg.id = ${tasks.groupId}
    and dg.deactivated_at is not null)`;
  return searchQuery(
    and(groupIds === null ? undefined : inArray(tasks.groupId, groupIds), live),
    db,
    query,
  );
}

function searchQuery(scope: SQL | undefined, db: Db, query: SearchQuery) {
  const where: (SQL | undefined)[] = [scope];
  if (query.q !== '')
    where.push(sql`${tasks.title} ilike ${`%${escapeLike(query.q)}%`} escape '\\'`);
  if (query.after) {
    const c = decodeCursor(query.after);
    const older = or(
      lt(tasks.createdAt, c.createdAt),
      and(eq(tasks.createdAt, c.createdAt), lt(tasks.id, c.id)),
    );
    // Open tasks come first: after an open one, the older open ones and then every completed one.
    where.push(
      c.done
        ? and(isNotNull(tasks.completedAt), older)
        : or(and(isNull(tasks.completedAt), older), isNotNull(tasks.completedAt)),
    );
  }
  return db
    .select({ ...taskCardColumns, createdAt: tasks.createdAt })
    .from(tasks)
    .innerJoin(buckets, eq(buckets.id, tasks.bucketId))
    .where(and(...where))
    .orderBy(sql`(${tasks.completedAt} is not null)`, desc(tasks.createdAt), desc(tasks.id))
    .limit(TASK_SEARCH_PAGE + 1);
}
