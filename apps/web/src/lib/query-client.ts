import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api';

/**
 * Builds the app's QueryClient. `onUnauthorized` runs when any query or mutation fails with
 * a 401 (the session ended): the cached session is cleared first, so the route guard does not
 * trust a stale user, then the callback sends the visitor to /login. The callback is passed in
 * (see main.tsx) because the router needs this client and cannot be imported here.
 */
export function createQueryClient(onUnauthorized: () => void): QueryClient {
  const handle = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(client);
      onUnauthorized();
    }
  };
  // A 401 means the session is over: retrying cannot help and only delays the redirect.
  const retry = (failureCount: number, error: unknown) =>
    !(error instanceof ApiError && error.status === 401) && failureCount < 1;
  // staleTime 30 s: screens reopened within half a minute reuse cached data instead of refetching.
  // refetchOnWindowFocus is off: realtime events keep data fresh, and focus refetches
  // would cost a request burst on every tab switch.
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry },
      // Writes are not idempotent (a retried POST could send a second invite email).
      mutations: { retry: false },
    },
  });
  return client;
}
