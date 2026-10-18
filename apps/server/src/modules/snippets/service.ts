import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import {
  SNIPPET_LIMITS,
  type SessionUser,
  type Snippet,
  type SnippetBody,
  type SnippetPatch,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { canChangeSnippet, canReadSnippet } from './policy.js';
import { replySnippets } from './schema.js';

/** The author already has `SNIPPET_LIMITS.perUser` snippets (route: 409 snippet_limit). */
export class SnippetLimitError extends Error {
  constructor() {
    super('Too many snippets');
    this.name = 'SnippetLimitError';
  }
}

/** The caller reads the snippet but may not change it (route: 403 forbidden). */
export class SnippetForbiddenError extends Error {
  constructor() {
    super('Only the author changes a snippet');
    this.name = 'SnippetForbiddenError';
  }
}

const columns = {
  id: replySnippets.id,
  authorId: replySnippets.authorId,
  title: replySnippets.title,
  body: replySnippets.body,
  shared: replySnippets.shared,
  updatedAt: replySnippets.updatedAt,
  authorName: user.name,
};
type Row = { [K in keyof typeof columns]: (typeof columns)[K]['_']['data'] };

const toDto = (actor: SessionUser, r: Row): Snippet => ({
  id: r.id,
  title: r.title,
  body: r.body,
  shared: r.shared,
  mine: r.authorId === actor.id,
  authorName: r.authorName,
  updatedAt: r.updatedAt.toISOString(),
});

/** The caller's own snippets and every shared one, by title; one query. */
export async function listSnippets(db: Db, actor: SessionUser): Promise<Snippet[]> {
  const rows = await db
    .select(columns)
    .from(replySnippets)
    .innerJoin(user, eq(user.id, replySnippets.authorId))
    .where(or(eq(replySnippets.authorId, actor.id), eq(replySnippets.shared, true)))
    .orderBy(asc(sql`lower(${replySnippets.title})`), asc(replySnippets.id));
  return rows.map((r) => toDto(actor, r));
}

async function getRow(db: Db, id: string): Promise<Row | null> {
  const [row] = await db
    .select(columns)
    .from(replySnippets)
    .innerJoin(user, eq(user.id, replySnippets.authorId))
    .where(eq(replySnippets.id, id));
  return row ?? null;
}

export async function createSnippet(
  db: Db,
  actor: SessionUser,
  body: SnippetBody,
): Promise<Snippet> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    // Serialises one author's creates, so two at once cannot pass the limit together.
    await tx.execute(sql`select 1 from "user" where id = ${actor.id} for update`);
    const [owned] = await tx
      .select({ n: count() })
      .from(replySnippets)
      .where(eq(replySnippets.authorId, actor.id));
    if ((owned?.n ?? 0) >= SNIPPET_LIMITS.perUser) throw new SnippetLimitError();
    await tx.insert(replySnippets).values({ id, authorId: actor.id, ...body });
  });
  return toDto(actor, (await getRow(db, id))!);
}

/**
 * Edits a snippet; null when it does not exist or the caller cannot read it (404), and
 * `SnippetForbiddenError` for someone else's shared one.
 */
export async function updateSnippet(
  db: Db,
  actor: SessionUser,
  id: string,
  patch: SnippetPatch,
): Promise<Snippet | null> {
  const row = await getRow(db, id);
  if (!row || !canReadSnippet(actor, row)) return null;
  if (!canChangeSnippet(actor, row)) throw new SnippetForbiddenError();
  await db
    .update(replySnippets)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(replySnippets.id, id), eq(replySnippets.authorId, actor.id)));
  return toDto(actor, (await getRow(db, id))!);
}

/** Deletes a snippet; false when it does not exist or is unreadable, the rest as `updateSnippet`. */
export async function deleteSnippet(db: Db, actor: SessionUser, id: string): Promise<boolean> {
  const row = await getRow(db, id);
  if (!row || !canReadSnippet(actor, row)) return false;
  if (!canChangeSnippet(actor, row)) throw new SnippetForbiddenError();
  await db
    .delete(replySnippets)
    .where(and(eq(replySnippets.id, id), eq(replySnippets.authorId, actor.id)));
  return true;
}
