import type { QueryClient } from '@tanstack/react-query';
import type { Visibility } from '@spolu/shared';
import { createFolder, groupFoldersQuery, updateFolder } from './api';

/**
 * The folder dialog's `save` for the knowledge base: creates a folder in `target.parentId` or
 * updates `target.folderId` with the changed fields, then refreshes the group's folders.
 */
export async function saveKnowledgeFolder(
  client: QueryClient,
  groupId: string,
  target: { folderId: string } | { parentId: string | null },
  change: { name?: string; visibility?: Visibility },
): Promise<void> {
  if ('folderId' in target) await updateFolder(target.folderId, change);
  else
    await createFolder(groupId, { name: change.name ?? '', parentId: target.parentId, ...change });
  void client.invalidateQueries({ queryKey: groupFoldersQuery(groupId).queryKey });
}
