import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WeeklySummaryEvents } from '@spolu/shared';
import { fakeSocket } from '@/features/tickets/test-api';
import { summaryKeys } from './api';
import { SUMMARY_EVENTS_DEBOUNCE_MS, useSummaryEvents } from './use-summary-events';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

describe('useSummaryEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a changed event invalidates the list and that summary once within 2 s', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useSummaryEvents(), { wrapper });
    const event = { id: 's1', groupId: 'g1', week: '2026-W43', status: 'draft', version: 2 };
    act(() => {
      socket.fire(WeeklySummaryEvents.changed, event);
      socket.fire(WeeklySummaryEvents.changed, { ...event, version: 3 });
    });
    act(() => vi.advanceTimersByTime(SUMMARY_EVENTS_DEBOUNCE_MS - 1));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      [...summaryKeys.all, 'list'],
      [...summaryKeys.all, 'archive'],
      summaryKeys.detail('s1'),
      summaryKeys.revisions('s1'),
    ]);
  });
});
