import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BulkEvents } from '@spolu/shared';
import { fakeSocket } from '@/features/tickets/test-api';
import { campaignListKey, campaignQuery } from './api';
import { BULK_EVENTS_DEBOUNCE_MS, useBulkEvents } from './use-bulk-events';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

describe('useBulkEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a send burst refetches the list and each named campaign once, 2 s after the last event', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useBulkEvents(), { wrapper });
    act(() => {
      socket.fire(BulkEvents.updated, { campaignId: 'c1' });
      socket.fire(BulkEvents.updated, { campaignId: 'c1' });
      socket.fire(BulkEvents.updated, { campaignId: 'c2' });
    });
    act(() => vi.advanceTimersByTime(BULK_EVENTS_DEBOUNCE_MS - 1));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      campaignListKey,
      campaignQuery('c1').queryKey,
      campaignQuery('c2').queryKey,
    ]);
  });
});
