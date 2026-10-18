import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Me } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { useFinanceEvents, FINANCE_REFETCH_DEBOUNCE_MS } from './use-finance-events';
import { useMeChanged } from './use-me-changed';

const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: (event: string, fn: (payload: unknown) => void) => handlers.set(event, fn),
    off: (event: string) => handlers.delete(event),
  }),
}));

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, wrapper };
}

describe('useFinanceEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("a client's tab refetches its own and client-less changes once per burst, not another client's", () => {
    const { invalidate, wrapper } = setup();
    renderHook(() => useFinanceEvents({ kind: 'group', groupId: 'g1' }), { wrapper });
    const emit = handlers.get('finance:changed')!;
    act(() => {
      emit({ groupId: 'g2', kind: 'items' });
      vi.advanceTimersByTime(FINANCE_REFETCH_DEBOUNCE_MS);
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => {
      emit({ groupId: 'g1', kind: 'items' });
      emit({ groupId: null, kind: 'rates' });
      vi.advanceTimersByTime(FINANCE_REFETCH_DEBOUNCE_MS - 1);
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    // The change of no client also refreshes the organisation's items (the admin group's tab).
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance', 'g1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance', 'all', 'org'] });
  });

  it('the system-wide page refetches on every change', () => {
    const { invalidate, wrapper } = setup();
    const { unmount } = renderHook(() => useFinanceEvents({ kind: 'all', clients: [] }), {
      wrapper,
    });
    act(() => {
      handlers.get('finance:changed')!({ groupId: 'g7', kind: 'time' });
      vi.advanceTimersByTime(FINANCE_REFETCH_DEBOUNCE_MS);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance', 'all'] });
    unmount();
    expect(handlers.has('finance:changed')).toBe(false);
  });
});

describe('useMeChanged', () => {
  beforeEach(() => handlers.clear());

  it('refetches the session and drops finance data when the right went', async () => {
    const { queryClient, invalidate, wrapper } = setup();
    const me: Omit<Me, 'finance'> = {
      id: 'a1',
      name: 'A',
      email: 'a@x.sk',
      role: 'admin',
      groups: [],
    };
    queryClient.setQueryDefaults(sessionQuery.queryKey, {
      queryFn: async () => ({ ...me, finance: false }),
    });
    queryClient.setQueryData(sessionQuery.queryKey, { ...me, finance: true } as Me);
    queryClient.setQueryData(['finance', 'g1', 'overview'], { cached: true });
    // The session query must be observed for invalidate to refetch it.
    const observer = queryClient.getQueryCache().find({ queryKey: sessionQuery.queryKey });
    expect(observer).toBeDefined();
    renderHook(() => useMeChanged(), { wrapper });
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: sessionQuery.queryKey });
      await (handlers.get('me:changed')! as unknown as () => Promise<void>)();
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionQuery.queryKey });
    expect(queryClient.getQueryData(['finance', 'g1', 'overview'])).toBeUndefined();
  });
});
