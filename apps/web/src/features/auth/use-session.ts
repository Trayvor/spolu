import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { SessionUserSchema, type SessionUser } from '@spolu/shared';
import { ApiError, apiGet } from '@/lib/api';

/** The signed-in user, or null for an anonymous visitor (a 401 is an answer, not an error). */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionUser | null> => {
    try {
      return await apiGet('/me', SessionUserSchema);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  retry: false,
});

export function useSession(): SessionUser | null {
  return useQuery(sessionQuery).data ?? null;
}

/**
 * The session is over (logout, a 401, a refused socket): cache "anonymous" so the route guard
 * does not trust the old user and drop everything else cached for that user. The signed-in
 * layout sees the session go and closes the socket.
 */
export function clearSession(queryClient: QueryClient): void {
  queryClient.setQueryData(sessionQuery.queryKey, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
}
