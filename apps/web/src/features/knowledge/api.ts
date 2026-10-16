import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  KnowledgeScopeSchema,
  type KnowledgeDraft,
  type KnowledgeItemDto,
  type KnowledgePatch,
  type KnowledgeType,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

export type KnowledgeFilter = { type?: KnowledgeType; q?: string };
/** `scope: 'all'` is every client, whatever the admin manages; it never combines with `clients`. */
export type GlobalKnowledgeFilter = KnowledgeFilter & { clients?: string[]; scope?: 'all' };

function search(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const text = qs.toString();
  return text ? `?${text}` : '';
}

// Query keys share the `['knowledge']` prefix; the page param is the server's cursor.

export const groupKnowledgeQuery = (groupId: string, filter: KnowledgeFilter) =>
  infiniteQueryOptions({
    queryKey: ['knowledge', 'group', groupId, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/groups/${enc(groupId)}/knowledge${search({ type: filter.type, q: filter.q, cursor: pageParam })}`,
        KnowledgePageSchema,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const globalKnowledgeQuery = (filter: GlobalKnowledgeFilter) =>
  infiniteQueryOptions({
    queryKey: ['knowledge', 'global', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/knowledge${search({
          scope: filter.scope,
          clients: filter.clients?.length ? filter.clients.join(',') : undefined,
          type: filter.type,
          q: filter.q,
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

export async function deleteKnowledge(id: string): Promise<void> {
  await apiSend('DELETE', `/knowledge/${enc(id)}`);
}
