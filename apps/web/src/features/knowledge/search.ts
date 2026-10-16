import type { KnowledgeType } from '@spolu/shared';

// Spelled out instead of importing `KnowledgeTypes`: this module is eager (the router), and the
// shared knowledge module would bring its zod schemas into the entry chunk. Same order as there.
export const KNOWLEDGE_TYPES = [
  'note',
  'file',
  'link',
  'reminder',
] as const satisfies readonly KnowledgeType[];

export type KnowledgePageSearch = {
  clients?: string;
  /** The ticked types as one comma list in the canonical order (`note,link`); none means all. */
  type?: string;
  q?: string;
  k?: string;
  /** The client (group) open in the folder view; the folder open in it. */
  at?: string;
  folder?: string;
};

/** An id-like URL value (letters, digits, `-` and `_`), else undefined. */
export function validateFolderParam(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined;
}

const isType = (value: string): value is KnowledgeType =>
  (KNOWLEDGE_TYPES as readonly string[]).includes(value);

/** The types in the canonical order, without duplicates. */
const canonical = (types: readonly string[]): KnowledgeType[] =>
  KNOWLEDGE_TYPES.filter((type) => types.includes(type));

/**
 * The `type` search param as the canonical comma list: a comma list, an old single value or an
 * array, with invalid values and duplicates dropped; undefined when no valid type is left.
 */
export function normalizeTypes(value: unknown): string | undefined {
  const parts =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? value.filter((part): part is string => typeof part === 'string')
        : [];
  return formatTypes(parts.filter(isType));
}

/** The ticked types of a validated `type` param. */
export function parseTypes(value: string | undefined): KnowledgeType[] {
  return value ? canonical(value.split(',')) : [];
}

/** The `type` param for these types; undefined (every type) when none is ticked. */
export function formatTypes(types: readonly KnowledgeType[]): string | undefined {
  const list = canonical(types);
  return list.length > 0 ? list.join(',') : undefined;
}

/** `kind` and other single-type params. */
export function singleType(value: unknown): KnowledgeType | undefined {
  return typeof value === 'string' && isType(value) ? value : undefined;
}

/**
 * The `/knowledge` search params. Every key is set, an invalid one to undefined: the router keeps
 * the raw params under the validated ones, so an omitted key would let the raw value through.
 * The search is trimmed and runs from 2 characters, as on the Knowledge tab.
 */
export function validateKnowledgeSearch(search: Record<string, unknown>): KnowledgePageSearch {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  const q = text(search.q)?.trim() ?? '';
  const at = validateFolderParam(search.at);
  return {
    clients: text(search.clients),
    type: normalizeTypes(search.type),
    q: q.length >= 2 ? q : undefined,
    k: text(search.k) || undefined,
    at,
    folder: at ? validateFolderParam(search.folder) : undefined,
  };
}
