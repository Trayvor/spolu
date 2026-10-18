import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  KNOWLEDGE_FOLDER_LIMITS,
  type KnowledgeFolderDraft,
  type KnowledgeFolderDto,
  type KnowledgeFolderPatch,
  type SessionUser,
  type Visibility,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { byName, chainTo, descendantIds } from '../../infra/tree.js';
import { setFilesAdminsOnly } from '../files/service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadGroup } from '../groups/policy.js';
import { pruneRecipientsForAdminsOnlyMany } from '../reminders/service.js';
import { isAdmin } from '../users/policy.js';
import {
  FolderLimitError,
  InvalidFolderError,
  InvalidVisibilityError,
  KnowledgeFolderNotFoundError,
} from './errors.js';
import { canReadFolder, canSetFolderVisibility } from './policy.js';
import { knowledgeAttachments, knowledgeFolders, knowledgeItems } from './schema.js';

/**
 * Folders of a group's knowledge base (Phase 24). A group's folders are few (at most 1000): every
 * check loads them in one query and walks the tree in memory. Anything inside an admins-only
 * folder is admins-only; every write here keeps that, under the group's knowledge lock.
 */

type FolderRow = typeof knowledgeFolders.$inferSelect;

const actorGroupOf = (db: Db, actor: SessionUser) =>
  isAdmin(actor) ? Promise.resolve([]) : clientGroupIds(db, actor.id);

/**
 * Serializes the knowledge writes of one group until the transaction ends: two moves cannot make
 * a cycle, and a folder turning admins-only cannot miss an item moved into it meanwhile. Every
 * write that reads the folder tree takes it first, before any row lock.
 */
export async function lockGroupKnowledge(tx: Db, groupId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge:${groupId}`}, 0))`,
  );
}

/** Every folder of the group, whoever may see it. */
function groupFolders(db: Db, groupId: string): Promise<FolderRow[]> {
  return db.select().from(knowledgeFolders).where(eq(knowledgeFolders.groupId, groupId));
}

function toFolderDto(row: FolderRow): KnowledgeFolderDto {
  return {
    id: row.id,
    groupId: row.groupId,
    parentId: row.parentId,
    name: row.name,
    visibility: row.visibility as Visibility,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The group check of every folder route: an unreadable group is "not found". */
async function checkGroup(db: Db, actor: SessionUser, groupId: string): Promise<string[]> {
  const actorGroupIds = await actorGroupOf(db, actor);
  if (!canReadGroup(actor, groupId, actorGroupIds)) throw new KnowledgeFolderNotFoundError();
  return actorGroupIds;
}

/** The folders of the group the actor sees, by name. */
export async function listFolders(
  db: Db,
  actor: SessionUser,
  groupId: string,
): Promise<KnowledgeFolderDto[]> {
  const actorGroupIds = await checkGroup(db, actor, groupId);
  const rows = await groupFolders(db, groupId);
  return rows
    .filter((row) => canReadFolder(actor, row, actorGroupIds))
    .sort(byName)
    .map(toFolderDto);
}

/** A folder of `groupId` the actor sees, from the loaded rows; else "not found". */
function visibleFolder(
  folders: FolderRow[],
  actor: SessionUser,
  actorGroupIds: string[],
  id: string,
): FolderRow {
  const folder = folders.find((row) => row.id === id);
  if (!folder || !canReadFolder(actor, folder, actorGroupIds)) {
    throw new KnowledgeFolderNotFoundError();
  }
  return folder;
}

/**
 * The folder an item goes into, checked for the actor (call under `lockGroupKnowledge`): one of
 * the item's group that the actor sees, else "not found". Null is the top level.
 */
export async function folderForItem(
  tx: Db,
  actor: SessionUser,
  groupId: string,
  folderId: string | null,
): Promise<{ id: string; visibility: Visibility } | null> {
  if (folderId === null) return null;
  const [row] = await tx.select().from(knowledgeFolders).where(eq(knowledgeFolders.id, folderId));
  if (!row || row.groupId !== groupId) throw new KnowledgeFolderNotFoundError();
  if (!canReadFolder(actor, row, await actorGroupOf(tx, actor))) {
    throw new KnowledgeFolderNotFoundError();
  }
  return { id: row.id, visibility: row.visibility as Visibility };
}

/** Creates a folder; inside an admins-only folder it is admins-only. */
export async function createFolder(
  db: Db,
  actor: SessionUser,
  groupId: string,
  draft: KnowledgeFolderDraft,
): Promise<KnowledgeFolderDto> {
  const actorGroupIds = await checkGroup(db, actor, groupId);
  if (!canSetFolderVisibility(actor, draft.visibility)) throw new InvalidVisibilityError();
  return db.transaction(async (tx) => {
    await lockGroupKnowledge(tx, groupId);
    const folders = await groupFolders(tx, groupId);
    const parent =
      draft.parentId === null ? null : visibleFolder(folders, actor, actorGroupIds, draft.parentId);
    if (folders.length >= KNOWLEDGE_FOLDER_LIMITS.perGroup) throw new FolderLimitError();
    const [row] = await tx
      .insert(knowledgeFolders)
      .values({
        id: randomUUID(),
        groupId,
        parentId: parent?.id ?? null,
        name: draft.name,
        visibility: parent?.visibility === 'admins' ? 'admins' : draft.visibility,
        createdBy: actor.id,
      })
      .returning();
    return toFolderDto(row!);
  });
}

/**
 * Makes these items admins-only with their files, and drops their non-admin reminder recipients
 * (as `updateItem` does on a switch). Returns the ids that were public.
 */
async function hideItemsIn(tx: Db, folderIds: string[]): Promise<string[]> {
  if (folderIds.length === 0) return [];
  const hidden = (
    await tx
      .update(knowledgeItems)
      .set({ visibility: 'admins', updatedAt: sql`now()` })
      .where(
        and(inArray(knowledgeItems.folderId, folderIds), eq(knowledgeItems.visibility, 'public')),
      )
      .returning({ id: knowledgeItems.id })
  ).map((row) => row.id);
  if (hidden.length === 0) return hidden;
  const fileIds = (
    await tx
      .select({ fileId: knowledgeAttachments.fileId })
      .from(knowledgeAttachments)
      .where(inArray(knowledgeAttachments.itemId, hidden))
  ).map((row) => row.fileId);
  await setFilesAdminsOnly(tx, fileIds, true);
  await pruneRecipientsForAdminsOnlyMany(tx, 'knowledge', hidden);
  return hidden;
}

/** True when a client wrote an item in one of these folders: such an item stays public. */
async function holdsClientItem(tx: Db, folderIds: string[]): Promise<boolean> {
  const rows = await tx.execute(sql`
    select 1 from knowledge_items k join "user" u on u.id = k.created_by
    where k.folder_id in (${sql.join(folderIds, sql`, `)}) and u.role = 'client'
    limit 1`);
  return rows.length > 0;
}

/**
 * Renames, moves or changes the visibility of a folder. Ending up admins-only (asked for, or moved
 * into an admins-only folder) makes everything inside admins-only too, unless a client's item is
 * inside; becoming public changes only the folder. `hiddenItemIds`: the items that stopped being
 * public, for the clients' `item_deleted` events.
 */
export async function updateFolder(
  db: Db,
  actor: SessionUser,
  id: string,
  patch: KnowledgeFolderPatch,
): Promise<{
  folder: KnowledgeFolderDto;
  previousVisibility: Visibility;
  hiddenItemIds: string[];
}> {
  const [ref] = await db
    .select({ groupId: knowledgeFolders.groupId })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, id));
  if (!ref) throw new KnowledgeFolderNotFoundError();
  const actorGroupIds = await checkGroup(db, actor, ref.groupId);
  return db.transaction(async (tx) => {
    await lockGroupKnowledge(tx, ref.groupId);
    const folders = await groupFolders(tx, ref.groupId);
    const folder = visibleFolder(folders, actor, actorGroupIds, id);
    const previousVisibility = folder.visibility as Visibility;

    const parentId = patch.parentId !== undefined ? patch.parentId : folder.parentId;
    let parent: FolderRow | null = null;
    if (parentId !== null) {
      parent = visibleFolder(folders, actor, actorGroupIds, parentId);
      if (parentId === id || descendantIds(folders, id).has(parentId)) {
        throw new InvalidFolderError();
      }
    }

    if (patch.visibility && !canSetFolderVisibility(actor, patch.visibility)) {
      throw new InvalidVisibilityError();
    }
    const inAdmins = parent?.visibility === 'admins';
    if (inAdmins && patch.visibility === 'public') throw new InvalidVisibilityError();
    const visibility: Visibility = inAdmins ? 'admins' : (patch.visibility ?? previousVisibility);

    let hiddenItemIds: string[] = [];
    if (visibility === 'admins' && previousVisibility === 'public') {
      const subtree = [id, ...descendantIds(folders, id)];
      if (await holdsClientItem(tx, subtree)) throw new InvalidVisibilityError();
      await tx
        .update(knowledgeFolders)
        .set({ visibility: 'admins', updatedAt: sql`now()` })
        .where(
          and(inArray(knowledgeFolders.id, subtree), eq(knowledgeFolders.visibility, 'public')),
        );
      hiddenItemIds = await hideItemsIn(tx, subtree);
    }

    const [row] = await tx
      .update(knowledgeFolders)
      .set({ name: patch.name ?? folder.name, parentId, visibility, updatedAt: sql`now()` })
      .where(eq(knowledgeFolders.id, id))
      .returning();
    return { folder: toFolderDto(row!), previousVisibility, hiddenItemIds };
  });
}

/**
 * Deletes a folder; never an item. Its folders and items move one level up, so nothing is lost
 * and a client deleting a folder that looks empty learns nothing of what admins keep in it.
 */
export async function deleteFolder(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<{ groupId: string; id: string; visibility: Visibility }> {
  const [ref] = await db
    .select({ groupId: knowledgeFolders.groupId })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, id));
  if (!ref) throw new KnowledgeFolderNotFoundError();
  const actorGroupIds = await checkGroup(db, actor, ref.groupId);
  return db.transaction(async (tx) => {
    await lockGroupKnowledge(tx, ref.groupId);
    const folders = await groupFolders(tx, ref.groupId);
    const folder = visibleFolder(folders, actor, actorGroupIds, id);
    await tx
      .update(knowledgeFolders)
      .set({ parentId: folder.parentId, updatedAt: sql`now()` })
      .where(eq(knowledgeFolders.parentId, id));
    await tx
      .update(knowledgeItems)
      .set({ folderId: folder.parentId })
      .where(eq(knowledgeItems.folderId, id));
    await tx.delete(knowledgeFolders).where(eq(knowledgeFolders.id, id));
    return { groupId: folder.groupId, id, visibility: folder.visibility as Visibility };
  });
}

type PathRow = { id: string; parent_id: string | null; name: string; visibility: string };

/**
 * The path (top level first) of each of these folders, in one recursive query. With `publicOnly`
 * an admins-only folder is left out: a public item's path never has one (the invariant), this is
 * defence in depth.
 */
export async function folderPaths(
  db: Db,
  folderIds: string[],
): Promise<(id: string, publicOnly: boolean) => { id: string; name: string }[]> {
  const chainOf = await folderChains(db, folderIds);
  return (id, publicOnly) =>
    chainOf(id)
      .filter((row) => !publicOnly || row.visibility === 'public')
      .map((row) => ({ id: row.id, name: row.name }));
}

/** Every folder from the top down to each of these folders, with its visibility (one query). */
export async function folderChains(
  db: Db,
  folderIds: string[],
): Promise<(id: string) => { id: string; name: string; visibility: string }[]> {
  const unique = [...new Set(folderIds)];
  const byId = new Map<string, PathRow>();
  if (unique.length > 0) {
    const rows = await db.execute<PathRow>(sql`
      with recursive up as (
        select f.id, f.parent_id, f.name, f.visibility from knowledge_folders f
        where f.id in (${sql.join(unique, sql`, `)})
        union
        select f.id, f.parent_id, f.name, f.visibility from knowledge_folders f
        join up on f.id = up.parent_id
      )
      select id, parent_id, name, visibility from up`);
    for (const row of rows) byId.set(row.id, row);
  }
  return (id) =>
    chainTo(byId, id, (row) => row.parent_id).map((row) => ({
      id: row.id,
      name: row.name,
      visibility: row.visibility,
    }));
}
