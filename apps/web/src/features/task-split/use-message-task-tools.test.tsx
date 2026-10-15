import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MessageDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { proposeTasks } from './api';
import { useMessageTaskTools } from './use-message-task-tools';

vi.mock('./api', async (importActual) => ({
  ...(await importActual<typeof import('./api')>()),
  proposeTasks: vi.fn(),
  createTasksFromMessage: vi.fn(),
}));

const MESSAGE = {
  id: 'm1',
  body: 'Pay the invoice',
  author: { id: 'u2', name: 'Boris', isAdmin: true },
  attachments: [],
} as unknown as MessageDto;

function setup(taskSplit: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/ai/status')
        ? new Response(JSON.stringify({ taskSplit }), { status: 200 })
        : new Response('[]', { status: 200 }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useMessageTaskTools('g1'), { wrapper });
}

describe('useMessageTaskTools', () => {
  beforeEach(async () => {
    await setLanguage('en');
    vi.mocked(proposeTasks).mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has no action while the AI is off', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current.messageActions).toEqual([]);
  });

  it('offers "Turn into tasks" in the menu on messages with text, the same array across renders', async () => {
    const { result, rerender } = setup(true);
    await waitFor(() => expect(result.current.messageActions).toHaveLength(1));
    const [action] = result.current.messageActions;
    expect(action).toMatchObject({
      id: 'turn-into-tasks',
      label: i18n.t('chat.actions.turnIntoTasks'),
      inMenu: true,
    });
    expect(action!.isAvailable!(MESSAGE)).toBe(true);
    expect(action!.isAvailable!({ ...MESSAGE, body: '  \n' })).toBe(false);

    const before = result.current.messageActions;
    rerender();
    expect(result.current.messageActions).toBe(before);
  });

  it('choosing the action opens the review dialog for that message', async () => {
    const { result } = setup(true);
    await waitFor(() => expect(result.current.messageActions).toHaveLength(1));
    expect(result.current.element).toBeTruthy();

    act(() => result.current.messageActions[0]!.onSelect(MESSAGE));
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>{result.current.element}</QueryClientProvider>);
    expect(
      await screen.findByRole('dialog', { name: i18n.t('taskSplit.title') }),
    ).toBeInTheDocument();
    expect(proposeTasks).toHaveBeenCalledWith('m1');
  });
});
