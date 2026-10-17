/**
 * Pure helpers over one group's folder tree, loaded whole in one query (a group's folders are
 * few). Shared by the knowledge base (Phase 24) and the finance documents (Phase 32).
 */

type Node = { id: string; parentId: string | null };

const collator = new Intl.Collator('sk', { sensitivity: 'base', numeric: true });

/** By name (Slovak order, case-insensitive), then by id so equal names keep one order. */
export function byName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The ids of every folder below `id` (not `id` itself). */
export function descendantIds(folders: readonly Node[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }
  const found = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (found.has(next)) continue;
    found.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return found;
}

/**
 * The chain from the top level down to `id` (inclusive), from rows keyed by id; stops at a
 * missing parent or a cycle. `parentOf` reads a row's parent id.
 */
export function chainTo<T>(
  byId: ReadonlyMap<string, T>,
  id: string,
  parentOf: (row: T) => string | null,
): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  let at: string | null = id;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const row = byId.get(at);
    if (row === undefined) break;
    path.unshift(row);
    at = parentOf(row);
  }
  return path;
}
