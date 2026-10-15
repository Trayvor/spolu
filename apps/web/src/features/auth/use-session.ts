import { queryOptions, useQuery } from '@tanstack/react-query';
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
