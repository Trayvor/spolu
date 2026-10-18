import { describe, expect, it, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionQuery } from '@/features/auth/use-session';
import { rememberedFiltersKey } from '@/lib/use-remembered-filters';
import { OVERVIEW_PERIODS } from './period';
import { usePeriod } from './period-select';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, { id: 'u1' } as never);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePeriod', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a custom range, and forgets it for a preset', () => {
    const first = renderHook(() => usePeriod('finance.test.period', OVERVIEW_PERIODS), { wrapper });
    act(() => first.result.current.choose('custom'));
    act(() => first.result.current.setCustom({ from: '2026-01', to: '2026-03' }));
    first.unmount();

    const again = renderHook(() => usePeriod('finance.test.period', OVERVIEW_PERIODS), { wrapper });
    expect(again.result.current.period).toBe('custom');
    expect(again.result.current.custom).toEqual({ from: '2026-01', to: '2026-03' });

    act(() => again.result.current.choose(OVERVIEW_PERIODS[0]!));
    expect(
      localStorage.getItem(rememberedFiltersKey('u1', 'finance.test.period.custom')),
    ).toBeNull();
  });
});
