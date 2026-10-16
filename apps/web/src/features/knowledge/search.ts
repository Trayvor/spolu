import type { KnowledgeType } from '@spolu/shared';

// Spelled out instead of importing `KnowledgeTypes`: this module is eager (the router), and the
// shared knowledge module would bring its zod schemas into the entry chunk. Same order as there.
export const KNOWLEDGE_TYPES = [
  'note',
  'file',
  'link',
  'reminder',
  'chat_file',
] as const satisfies readonly KnowledgeType[];

/** The types people create (`?kind=`); a chat file only comes from a chat. */
const CREATABLE_TYPES: readonly string[] = ['note', 'file', 'link', 'reminder'];

export type KnowledgePageSearch = {
  clients?: string;
  /** The ticked types as one comma list in the canonical order (`note,link`); none means all. */
  type?: string;
  q?: string;
  /** `all`: chat files of the task and ticket chats too (only with the `chat_file` type). */
  chats?: 'all';
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

/** `kind`: a type people create (never `chat_file`). */
export function singleType(value: unknown): Exclude<KnowledgeType, 'chat_file'> | undefined {
  return typeof value === 'string' && CREATABLE_TYPES.includes(value)
    ? (value as Exclude<KnowledgeType, 'chat_file'>)
    : undefined;
}

/** The `chats` param: `all` or nothing. */
export function validateChats(value: unknown): 'all' | undefined {
  return value === 'all' ? 'all' : undefined;
}

/**
 * The list is flat (every folder, no breadcrumbs) while searching or while chat files are
 * ticked: they are in no folder.
 */
export function isFlatList(q: string | undefined, types: readonly KnowledgeType[]): boolean {
  return Boolean(q) || types.includes('chat_file');
}

/** The `chats` filter to send: only while chat files are ticked. */
export function chatsFilter(
  types: readonly KnowledgeType[],
  chats: 'all' | undefined,
): 'all' | undefined {
  return types.includes('chat_file') ? chats : undefined;
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
    chats: validateChats(search.chats),
    k: text(search.k) || undefined,
    at,
    folder: at ? validateFolderParam(search.folder) : undefined,
  };
}
