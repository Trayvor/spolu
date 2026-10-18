import { queryOptions } from '@tanstack/react-query';
import {
  SavedViewListSchema,
  SavedViewSchema,
  type SavedView,
  type SavedViewBody,
  type SavedViewPage,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** The signed-in person's saved views of one page (F5), oldest first. */
export const savedViewsQuery = (page: SavedViewPage) =>
  queryOptions({
    queryKey: ['me', 'saved-views', page],
    queryFn: () => apiGet(`/me/saved-views?page=${page}`, SavedViewListSchema),
    staleTime: 5 * 60_000,
  });

export function createSavedView(body: SavedViewBody): Promise<SavedView> {
  return apiSend('POST', '/me/saved-views', body, SavedViewSchema);
}

export function deleteSavedView(id: string): Promise<void> {
  return apiSend('DELETE', `/me/saved-views/${encodeURIComponent(id)}`);
}
