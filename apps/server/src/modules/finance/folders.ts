import { randomUUID } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
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
 *
 * Every function takes the owner as `groupId`: a client's id, or null for the organisation's
 * own folders (Phase 32 E, `/finance` only), which follow the same rules.
 */

export const FINANCE_FOLDERS_PER_GROUP = 1000;

type FolderRow = typeof financeFolders.$inferSelect;

/**
 * Serializes the finance writes of one client (or of the organisation, null) until the
 * transaction ends, so two moves cannot make a cycle and no item lands in a folder being
 * deleted. Taken before any row lock.
 */
export async function lockGroupFinance(tx: Db, groupId: string | null): Promise<void> {
  const key = `finance:${groupId ?? 'organisation'}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

function groupFolders(db: Db, groupId: string | null): Promise<FolderRow[]> {
  return db
    .select()
    .from(financeFolders)
    .where(groupId === null ? isNull(financeFolders.groupId) : eq(financeFolders.groupId, groupId));
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

/** Every folder of the client (null: of the organisation), by name. */
export async function listFolders(db: Db, groupId: string | null): Promise<FinanceFolder[]> {
  return (await groupFolders(db, groupId)).sort(byName).map(toDto);
}

/**
 * A folder of the client, or of the organisation for null (call under `lockGroupFinance`); a
 * folder of another owner is not found. `folderId` null is the top level.
 */
export async function folderOfGroup(
  tx: Db,
  groupId: string | null,
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
  groupId: string | null,
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

/**
 * The owner a folder belongs to (`groupId` null: the organisation), or null for an unknown id.
 */
export async function folderOwner(db: Db, id: string): Promise<{ groupId: string | null } | null> {
  const [row] = await db
    .select({ groupId: financeFolders.groupId })
    .from(financeFolders)
    .where(eq(financeFolders.id, id));
  return row ?? null;
}

/** The owner of a folder that must exist (`FinanceNotFoundError` otherwise). */
async function ownerOf(db: Db, id: string): Promise<string | null> {
  const owner = await folderOwner(db, id);
  if (owner === null) throw new FinanceNotFoundError('Finance folder');
  return owner.groupId;
}

/** Renames and/or moves a folder; never into itself or below itself. */
export async function updateFolder(
  db: Db,
  id: string,
  patch: FinanceFolderPatch,
): Promise<FinanceFolder> {
  const groupId = await ownerOf(db, id);
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
export async function deleteFolder(db: Db, id: string): Promise<{ groupId: string | null }> {
  const groupId = await ownerOf(db, id);
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
