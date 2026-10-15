import { QueryClient } from '@tanstack/react-query';

// staleTime 30 s: screens reopened within half a minute reuse cached data instead of refetching.
// refetchOnWindowFocus is off: realtime events keep data fresh, and focus refetches
// would cost a request burst on every tab switch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});
