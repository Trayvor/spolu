import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { unseenSummaryQuery } from './api';
import { useOpenSummary } from './banner';

afterEach(() => vi.unstubAllGlobals());

const target = { kind: 'task', id: 't1' } as const;

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useOpenSummary (2026-10-18)', () => {
  it('a stale error of the tooltip query does not make it ready while the refetch runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { queryClient, wrapper } = setup();
    await queryClient.fetchQuery(unseenSummaryQuery(target)).catch(() => undefined);
    expect(queryClient.getQueryState(['unseen-summary', 'task', 't1'])?.status).toBe('error');

    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const { result } = renderHook(() => useOpenSummary(target), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);

    answer(new Response(JSON.stringify({ lines: [{ kind: 'assigned' }], more: 0 })));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.summary?.lines).toEqual([{ kind: 'assigned' }]);
  });

  it('a failed summary is ready once the request has finished', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useOpenSummary(target), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.summary).toBeNull();
  });
});
