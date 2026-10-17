/**
 * Folder helpers over a group's whole folder list (loaded in one request): knowledge folders
 * (Phase 24) and finance folders (Phase 32), anything with an id, a parent and a name.
 */
type FolderLike = { id: string; parentId: string | null; name: string };

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
export function childFolders<F extends FolderLike>(
  folders: F[],
  parentId: string | null,
  lang: string,
): F[] {
  const compare = collator(lang);
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => compare.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

/** The folders from the top level down to `id` (inclusive); empty when it is unknown. */
export function folderPath<F extends FolderLike>(folders: F[], id: string): F[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: F[] = [];
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
export function descendantIds(folders: FolderLike[], id: string): Set<string> {
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

export type TreeRow<F extends FolderLike = FolderLike> = { folder: F; depth: number };

/** The whole tree, depth first, each level by name: the rows of the move picker. */
export function treeRows<F extends FolderLike>(folders: F[], lang: string): TreeRow<F>[] {
  const rows: TreeRow<F>[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(folders, parentId, lang)) {
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
