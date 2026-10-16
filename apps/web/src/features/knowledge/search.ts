import type { KnowledgeType } from '@spolu/shared';

// Spelled out instead of importing `KnowledgeTypes`: this module is eager (the router), and the
// shared knowledge module would bring its zod schemas into the entry chunk.
const TYPES: readonly string[] = ['note', 'file', 'link', 'reminder'] satisfies KnowledgeType[];

export type KnowledgePageSearch = {
  clients?: string;
  type?: KnowledgeType;
  q?: string;
  k?: string;
};

/**
 * The `/knowledge` search params. Every key is set, an invalid one to undefined: the router keeps
 * the raw params under the validated ones, so an omitted key would let the raw value through.
 * The search is trimmed and runs from 2 characters, as on the Knowledge tab.
 */
export function validateKnowledgeSearch(search: Record<string, unknown>): KnowledgePageSearch {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  const q = text(search.q)?.trim() ?? '';
  return {
    clients: text(search.clients),
    type:
      typeof search.type === 'string' && TYPES.includes(search.type)
        ? (search.type as KnowledgeType)
        : undefined,
    q: q.length >= 2 ? q : undefined,
    k: text(search.k) || undefined,
  };
}
