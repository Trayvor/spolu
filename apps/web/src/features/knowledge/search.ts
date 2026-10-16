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

/** The `/knowledge` search params; anything else is dropped. */
export function validateKnowledgeSearch(search: Record<string, unknown>): KnowledgePageSearch {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  const out: KnowledgePageSearch = {};
  const clients = text(search.clients);
  if (clients !== undefined) out.clients = clients;
  if (typeof search.type === 'string' && TYPES.includes(search.type))
    out.type = search.type as KnowledgeType;
  const q = text(search.q);
  if (q) out.q = q;
  const k = text(search.k);
  if (k) out.k = k;
  return out;
}
