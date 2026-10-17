import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  KnowledgeFolderDtoSchema,
  KnowledgeFolderListSchema,
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  KnowledgeScopeSchema,
  type KnowledgeDraft,
  type KnowledgeFolderDraft,
  type KnowledgeFolderDto,
  type KnowledgeFolderPatch,
  type KnowledgeItemDto,
  type KnowledgePatch,
  type KnowledgeToFile,
  type KnowledgeType,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/**
 * `types`: any of these types; empty or absent means every type. `folder` (the tab only): the
 * items directly in that folder, null the top level; absent means every folder (a search).
 */
export type KnowledgeFilter = {
  types?: KnowledgeType[];
  q?: string;
  folder?: string | null;
  /** `all`: the task and ticket chats' files too; absent: the group chat's only. */
  chats?: 'all';
  /** Phase 28 (the tab only): only items that may be attached to a chat message. */
  shareable?: true;
};
/** `scope: 'all'` is every client, whatever the admin manages; it never combines with `clients`. */
export type GlobalKnowledgeFilter = KnowledgeFilter & { clients?: string[]; scope?: 'all' };

/** The `type` param: one comma list. */
const typeParam = (types: KnowledgeType[] | undefined) =>
  types?.length ? types.join(',') : undefined;

/** The filter as a query key: no types and an empty list are the same list. */
const keyOf = <F extends KnowledgeFilter>(filter: F): F => ({
  ...filter,
  types: filter.types?.length ? filter.types : undefined,
});

function search(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const text = qs.toString();
  return text ? `?${text}` : '';
}

// Query keys share the `['knowledge']` prefix; the page param is the server's cursor.

export const groupKnowledgeQuery = (groupId: string, filter: KnowledgeFilter) =>
  infiniteQueryOptions({
    queryKey: ['knowledge', 'group', groupId, keyOf(filter)],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/groups/${enc(groupId)}/knowledge${search({
          type: typeParam(filter.types),
          q: filter.q,
          chats: filter.chats,
          shareable: filter.shareable ? '1' : undefined,
          folder: filter.folder === null ? 'root' : filter.folder,
          cursor: pageParam,
        })}`,
        KnowledgePageSchema,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const globalKnowledgeQuery = (filter: GlobalKnowledgeFilter) =>
  infiniteQueryOptions({
    queryKey: ['knowledge', 'global', keyOf(filter)],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/knowledge${search({
          scope: filter.scope,
          clients: filter.clients?.length ? filter.clients.join(',') : undefined,
          type: typeParam(filter.types),
          q: filter.q,
          chats: filter.chats,
          cursor: pageParam,
        })}`,
        KnowledgePageSchema,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const knowledgeItemQuery = (id: string) =>
  queryOptions({
    queryKey: ['knowledge', 'item', id],
    queryFn: () => apiGet(`/knowledge/${enc(id)}`, KnowledgeItemDtoSchema),
  });

export const knowledgeScopeQuery = queryOptions({
  queryKey: ['knowledge', 'scope'],
  queryFn: () => apiGet('/knowledge/scope', KnowledgeScopeSchema),
});

export function createKnowledge(groupId: string, draft: KnowledgeDraft): Promise<KnowledgeItemDto> {
  return apiSend('POST', `/groups/${enc(groupId)}/knowledge`, draft, KnowledgeItemDtoSchema);
}

export function updateKnowledge(id: string, patch: KnowledgePatch): Promise<KnowledgeItemDto> {
  return apiSend('PATCH', `/knowledge/${enc(id)}`, patch, KnowledgeItemDtoSchema);
}

/** A chat file becomes a normal file item ("Save as a file", one way). */
export function convertKnowledgeToFile(
  id: string,
  input: KnowledgeToFile,
): Promise<KnowledgeItemDto> {
  return apiSend('POST', `/knowledge/${enc(id)}/to-file`, input, KnowledgeItemDtoSchema);
}

/** Items this browser is deleting: their socket `item_deleted` is the viewer's own delete. */
const deleting = new Set<string>();

export function isDeletingKnowledge(id: string): boolean {
  return deleting.has(id);
}

export async function deleteKnowledge(id: string): Promise<void> {
  deleting.add(id);
  try {
    await apiSend('DELETE', `/knowledge/${enc(id)}`);
  } finally {
    deleting.delete(id);
  }
}

// Folders (Phase 24): a group's whole folder list in one request.

export const groupFoldersQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['knowledge', 'folders', groupId],
    queryFn: () =>
      apiGet(`/groups/${enc(groupId)}/knowledge/folders`, KnowledgeFolderListSchema).then(
        (list) => list.folders,
      ),
  });

export function createFolder(
  groupId: string,
  draft: Partial<KnowledgeFolderDraft> & { name: string },
): Promise<KnowledgeFolderDto> {
  return apiSend(
    'POST',
    `/groups/${enc(groupId)}/knowledge/folders`,
    draft,
    KnowledgeFolderDtoSchema,
  );
}

export function updateFolder(id: string, patch: KnowledgeFolderPatch): Promise<KnowledgeFolderDto> {
  return apiSend('PATCH', `/knowledge/folders/${enc(id)}`, patch, KnowledgeFolderDtoSchema);
}

export async function deleteFolder(id: string): Promise<void> {
  await apiSend('DELETE', `/knowledge/folders/${enc(id)}`);
}
