import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { clearDrafts } from '@/features/chat/drafts';
import { ApiError, apiGet } from '@/lib/api';
import { meGuard } from './me-guard';

/** The signed-in user, or null for an anonymous visitor (a 401 is an answer, not an error). */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await apiGet('/me', meGuard);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  retry: false,
});

export function useSession(): Me | null {
  return useQuery(sessionQuery).data ?? null;
}

/**
 * The session is over (logout, a 401, a refused socket): cache "anonymous" so the route guard
 * does not trust the old user and drop everything else cached for that user. The signed-in
 * layout sees the session go and closes the socket. Logout does not reload the page, so the
 * unsent chat drafts go too: the next person on this tab must not see them.
 */
export function clearSession(queryClient: QueryClient): void {
  queryClient.setQueryData(sessionQuery.queryKey, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  clearDrafts();
}
