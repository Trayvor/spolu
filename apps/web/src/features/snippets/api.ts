import { queryOptions } from '@tanstack/react-query';
import {
  SnippetListSchema,
  SnippetSchema,
  type Snippet,
  type SnippetBody,
  type SnippetPatch,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** The admin's own canned replies and the shared ones (F7), by title. */
export const snippetsQuery = queryOptions({
  queryKey: ['snippets'],
  queryFn: () => apiGet('/snippets', SnippetListSchema),
  staleTime: 60_000,
});

export function createSnippet(body: SnippetBody): Promise<Snippet> {
  return apiSend('POST', '/snippets', body, SnippetSchema);
}

export function updateSnippet(id: string, patch: SnippetPatch): Promise<Snippet> {
  return apiSend('PATCH', `/snippets/${encodeURIComponent(id)}`, patch, SnippetSchema);
}

export function deleteSnippet(id: string): Promise<void> {
  return apiSend('DELETE', `/snippets/${encodeURIComponent(id)}`);
}
