import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FinanceFolder, FinanceFolderBody, FinanceFolderPatch } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { byName, chainTo, descendantIds } from '../../infra/tree.js';
import {
  FinanceFolderCycleError,
  FinanceFolderLimitError,
  FinanceNotFoundError,
} from './errors.js';
import { financeFolders, financeItems } from './schema.js';

/**
 * Folders of one client's finance documents (Phase 32 part B), like the knowledge folders without
 * their visibility: every finance admin sees every folder. A client's folders are few (at most
 * 1000): each check loads them in one query and walks the tree in memory (`infra/tree.ts`). The
 * caller (the finance plugin) has checked `canSeeFinance`.
 */

export const FINANCE_FOLDERS_PER_GROUP = 1000;

type FolderRow = typeof financeFolders.$inferSelect;

/**
 * Serializes the finance writes of one client until the transaction ends, so two moves cannot
 * make a cycle and no item lands in a folder being deleted. Taken before any row lock.
 */
export async function lockGroupFinance(tx: Db, groupId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`finance:${groupId}`}, 0))`);
}

function groupFolders(db: Db, groupId: string): Promise<FolderRow[]> {
  return db.select().from(financeFolders).where(eq(financeFolders.groupId, groupId));
}

function toDto(row: FolderRow): FinanceFolder {
  return {
    id: row.id,
    groupId: row.groupId,
    parentId: row.parentId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every folder of the client, by name. */
export async function listFolders(db: Db, groupId: string): Promise<FinanceFolder[]> {
  return (await groupFolders(db, groupId)).sort(byName).map(toDto);
}

/** A folder of the client (call under `lockGroupFinance`); null is the top level. */
export async function folderOfGroup(
  tx: Db,
  groupId: string,
  folderId: string | null,
): Promise<string | null> {
  if (folderId === null) return null;
  const [row] = await tx
    .select({ groupId: financeFolders.groupId })
    .from(financeFolders)
    .where(eq(financeFolders.id, folderId));
  if (!row || row.groupId !== groupId) throw new FinanceNotFoundError('Finance folder');
  return folderId;
}

function findIn(folders: FolderRow[], id: string): FolderRow {
  const folder = folders.find((row) => row.id === id);
  if (!folder) throw new FinanceNotFoundError('Finance folder');
  return folder;
}

export async function createFolder(
  db: Db,
  actorId: string,
  groupId: string,
  body: FinanceFolderBody,
): Promise<FinanceFolder> {
  return db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const folders = await groupFolders(tx, groupId);
    if (body.parentId !== null) findIn(folders, body.parentId);
    if (folders.length >= FINANCE_FOLDERS_PER_GROUP) throw new FinanceFolderLimitError();
    const [row] = await tx
      .insert(financeFolders)
      .values({
        id: randomUUID(),
        groupId,
        parentId: body.parentId,
        name: body.name,
        createdBy: actorId,
      })
      .returning();
    return toDto(row!);
  });
}

/** The client a folder belongs to, or null for an unknown id. */
export async function folderGroupId(db: Db, id: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: financeFolders.groupId })
    .from(financeFolders)
    .where(eq(financeFolders.id, id));
  return row?.groupId ?? null;
}

/** Renames and/or moves a folder; never into itself or below itself. */
export async function updateFolder(
  db: Db,
  id: string,
  patch: FinanceFolderPatch,
): Promise<FinanceFolder> {
  const groupId = await folderGroupId(db, id);
  if (groupId === null) throw new FinanceNotFoundError('Finance folder');
  return db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const folders = await groupFolders(tx, groupId);
    const folder = findIn(folders, id);
    const parentId = patch.parentId !== undefined ? patch.parentId : folder.parentId;
    if (parentId !== null) {
      findIn(folders, parentId);
      if (parentId === id || descendantIds(folders, id).has(parentId)) {
        throw new FinanceFolderCycleError();
      }
    }
    const [row] = await tx
      .update(financeFolders)
      .set({ name: patch.name ?? folder.name, parentId, updatedAt: sql`now()` })
      .where(eq(financeFolders.id, id))
      .returning();
    return toDto(row!);
  });
}

/** Deletes a folder, never an item: its folders and items move one level up. */
export async function deleteFolder(db: Db, id: string): Promise<{ groupId: string }> {
  const groupId = await folderGroupId(db, id);
  if (groupId === null) throw new FinanceNotFoundError('Finance folder');
  return db.transaction(async (tx) => {
    await lockGroupFinance(tx, groupId);
    const folder = findIn(await groupFolders(tx, groupId), id);
    await tx
      .update(financeFolders)
      .set({ parentId: folder.parentId, updatedAt: sql`now()` })
      .where(eq(financeFolders.parentId, id));
    await tx
      .update(financeItems)
      .set({ folderId: folder.parentId })
      .where(eq(financeItems.folderId, id));
    await tx.delete(financeFolders).where(eq(financeFolders.id, id));
    return { groupId };
  });
}

type PathRow = { id: string; parent_id: string | null; name: string };

/** The folder names from the top level down to each of these folders, in one recursive query. */
export async function folderPaths(db: Db, folderIds: string[]): Promise<(id: string) => string[]> {
  const unique = [...new Set(folderIds)];
  const byId = new Map<string, PathRow>();
  if (unique.length > 0) {
    const rows = await db.execute<PathRow>(sql`
      with recursive up as (
        select f.id, f.parent_id, f.name from finance_folders f
        where f.id in (${sql.join(unique, sql`, `)})
        union
        select f.id, f.parent_id, f.name from finance_folders f join up on f.id = up.parent_id
      )
      select id, parent_id, name from up`);
    for (const row of rows) byId.set(row.id, row);
  }
  return (id) => chainTo(byId, id, (row) => row.parent_id).map((row) => row.name);
}
