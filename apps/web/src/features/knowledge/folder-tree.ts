import type { KnowledgeFolderDto } from '@spolu/shared';

/** Folder helpers over a group's whole folder list (loaded in one request). */

const collators = new Map<string, Intl.Collator>();
function collator(lang: string): Intl.Collator {
  let found = collators.get(lang);
  if (!found) {
    found = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    collators.set(lang, found);
  }
  return found;
}

/** The folders directly in `parentId` (null: the top level), by name in the UI language. */
export function childFolders(
  folders: KnowledgeFolderDto[],
  parentId: string | null,
  lang: string,
): KnowledgeFolderDto[] {
  const compare = collator(lang);
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => compare.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

/** The folders from the top level down to `id` (inclusive); empty when it is unknown. */
export function folderPath(folders: KnowledgeFolderDto[], id: string): KnowledgeFolderDto[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: KnowledgeFolderDto[] = [];
  const seen = new Set<string>();
  let at: string | null = id;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const folder = byId.get(at);
    if (!folder) break;
    path.unshift(folder);
    at = folder.parentId;
  }
  return path[path.length - 1]?.id === id ? path : [];
}

/** The ids of every folder below `id`. */
export function descendantIds(folders: KnowledgeFolderDto[], id: string): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const parent = stack.pop()!;
    for (const folder of folders) {
      if (folder.parentId === parent && !found.has(folder.id)) {
        found.add(folder.id);
        stack.push(folder.id);
      }
    }
  }
  return found;
}

export type TreeRow = { folder: KnowledgeFolderDto; depth: number };

/** The whole tree, depth first, each level by name: the rows of the move picker. */
export function treeRows(folders: KnowledgeFolderDto[], lang: string): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(folders, parentId, lang)) {
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
