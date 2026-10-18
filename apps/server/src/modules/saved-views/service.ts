import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  SAVED_VIEW_LIMITS,
  type SavedView,
  type SavedViewBody,
  type SavedViewPage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { savedViews } from './schema.js';

/** The person already has `SAVED_VIEW_LIMITS.perPage` views on the page (409 saved_view_limit). */
export class SavedViewLimitError extends Error {
  constructor() {
    super('Too many saved views');
    this.name = 'SavedViewLimitError';
  }
}

type Row = typeof savedViews.$inferSelect;
const toDto = (r: Row): SavedView => ({
  id: r.id,
  page: r.page,
  name: r.name,
  url: r.url,
  createdAt: r.createdAt.toISOString(),
});

/** The person's views of one page, oldest first (one index range). */
export async function listSavedViews(
  db: Db,
  userId: string,
  page: SavedViewPage,
): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.userId, userId), eq(savedViews.page, page)))
    .orderBy(asc(savedViews.createdAt), asc(savedViews.id));
  return rows.map(toDto);
}

export async function createSavedView(
  db: Db,
  userId: string,
  body: SavedViewBody,
): Promise<SavedView> {
  return db.transaction(async (tx) => {
    // One person's saves one at a time, so two at once cannot pass the limit together.
    await tx.execute(sql`select 1 from "user" where id = ${userId} for update`);
    const [have] = await tx
      .select({ n: count() })
      .from(savedViews)
      .where(and(eq(savedViews.userId, userId), eq(savedViews.page, body.page)));
    if ((have?.n ?? 0) >= SAVED_VIEW_LIMITS.perPage) throw new SavedViewLimitError();
    const [row] = await tx
      .insert(savedViews)
      .values({ id: randomUUID(), userId, page: body.page, name: body.name, url: body.url })
      .returning();
    return toDto(row!);
  });
}

/** Deletes one of the person's views; false when it is not theirs or does not exist. */
export async function deleteSavedView(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, userId)))
    .returning({ id: savedViews.id });
  return result.length > 0;
}
