import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { AdminEvents, type BucketDto, type TaskDetailDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { BOARD_CLIENTS_KEY } from './use-global-search';
import { board, card, doneColumn, mockBoardApi } from './test-api';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  connected: false,
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
  emit: vi.fn(),
};
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/conversation', () => ({ Conversation: () => <div /> }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const original = window.matchMedia;

function renderBoard(path = '/tasks') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const globalCalls = (calls: string[]) => calls.filter((u) => u.startsWith('/api/tasks/global'));

const BUCKETS: BucketDto[] = [
  { id: 'b-todo', groupId: 'g1', kind: 'todo', name: null, position: 'a0' },
  { id: 'b-done', groupId: 'g1', kind: 'done', name: null, position: 'a9' },
];
const DETAIL: TaskDetailDto = {
  ...card({ id: 't1', title: 'Fix budget table' }),
  description: '',
  files: [],
  sourceMessage: null,
  sourceTicket: null,
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

/** The task panel's own requests. */
const panelRoutes = (reply = json) => [
  (url: URL) => (url.pathname === '/api/tasks/t1' ? reply(200, DETAIL) : undefined),
  (url: URL) =>
    url.pathname === '/api/groups/g1/board'
      ? reply(200, {
          buckets: BUCKETS,
          tasks: [card({ id: 't1' })],
          done: { total: 0, next: null },
        })
      : undefined,
  (url: URL) =>
    url.pathname === '/api/groups/g1'
      ? reply(200, {
          id: 'g1',
          name: 'ABC s.r.o.',
          egrantUrl: 'https://abc.egrant.sk',
          hasLogo: false,
          updatedAt: '2026-10-15T10:00:00.000Z',
        })
      : undefined,
  (url: URL) => (url.pathname === '/api/groups/g1/people' ? reply(200, []) : undefined),
  (url: URL) => (url.pathname === '/api/groups/g1/task-chats' ? reply(200, {}) : undefined),
];

describe('GlobalBoardPage', () => {
  beforeEach(async () => {
    await setLanguage('en');
    handlers.clear();
    localStorage.clear();
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(min-width: 641px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('the fixed columns around the custom ones, Completed only when shown', async () => {
    const { reply } = mockBoardApi([
      (url) =>
        url.pathname === '/api/tasks/global' && url.searchParams.get('completed') === '1'
          ? reply(
              200,
              board({
                columns: [...board().columns, doneColumn()],
              }),
            )
          : undefined,
    ]);
    renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      t('adminHome.board.columns.todo'),
      'In translation',
      t('adminHome.board.columns.other'),
      t('adminHome.board.columns.egrant_review'),
      t('adminHome.board.columns.client_review'),
    ]);
    cleanup();
    renderBoard('/tasks?completed=1');
    expect(
      await screen.findByRole('heading', { name: t('adminHome.board.columns.done') }),
    ).toBeInTheDocument();
  });

  it('cards show the client line, and the bucket name only in Other steps', async () => {
    mockBoardApi();
    renderBoard();
    const first = await screen.findByRole('link', { name: /Fix budget table/ });
    expect(first).toHaveTextContent('ABC s.r.o.');
    // A custom column names the step in its heading; its cards keep their client.
    const custom = screen.getByRole('link', { name: /Annex 2/ });
    expect(custom).toHaveTextContent('Obec Lúky');
    expect(custom).not.toHaveTextContent('In Translation');
    const folded = screen.getByRole('link', { name: /Old minutes/ });
    expect(folded).toHaveTextContent('Archive');
  });

  it('the default client scope comes from localStorage when the URL has none, and storage errors are ignored', async () => {
    localStorage.setItem(BOARD_CLIENTS_KEY, 'g2');
    const { calls } = mockBoardApi();
    const { router } = renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(globalCalls(calls)).toEqual(['/api/tasks/global?clients=g2']);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ clients: 'g2' }));

    cleanup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const second = mockBoardApi();
    renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(globalCalls(second.calls)).toEqual(['/api/tasks/global']);
  });

  it('Show 50 more appends the next page of that column only', async () => {
    const { reply, calls } = mockBoardApi([
      (url) => {
        if (url.pathname !== '/api/tasks/global') return undefined;
        if (url.searchParams.get('column') === 'todo') {
          return reply(
            200,
            board({
              columns: [
                {
                  id: 'todo',
                  kind: 'todo',
                  name: null,
                  total: 2,
                  items: [card({ id: 't9', title: 'Page two' })],
                  next: null,
                },
              ],
            }),
          );
        }
        const first = board();
        first.columns[0] = { ...first.columns[0]!, total: 2, next: 'cursor-1' };
        return reply(200, first);
      },
    ]);
    const { user } = renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    const todo = screen.getByRole('region', { name: t('adminHome.board.columns.todo') });
    const other = screen.getByRole('region', { name: t('adminHome.board.columns.other') });
    expect(within(other).queryByRole('button', { name: t('adminHome.board.more') })).toBeNull();
    await user.click(within(todo).getByRole('button', { name: t('adminHome.board.more') }));
    expect(await within(todo).findByRole('link', { name: /Page two/ })).toBeInTheDocument();
    expect(within(todo).getAllByRole('link')).toHaveLength(2);
    expect(within(other).getAllByRole('link')).toHaveLength(1);
    expect(globalCalls(calls).at(-1)).toBe('/api/tasks/global?column=todo&after=cursor-1');
    expect(within(todo).queryByRole('button', { name: t('adminHome.board.more') })).toBeNull();
  });

  it('the loaded pages stay, refreshed, when tasks change; a filter change drops them (W5)', async () => {
    let pageTitle = 'Page two';
    const { reply, calls } = mockBoardApi([
      (url) => {
        if (url.pathname !== '/api/tasks/global') return undefined;
        const column = (title: string, total: number, next: string | null) => ({
          id: 'todo',
          kind: 'todo' as const,
          name: null,
          total,
          items: [card({ id: 't9', title })],
          next,
        });
        if (url.searchParams.get('column') === 'todo') {
          return reply(200, board({ columns: [column(pageTitle, 2, null)] }));
        }
        const first = board();
        first.columns[0] = { ...first.columns[0]!, total: 2, next: 'cursor-1' };
        return reply(200, first);
      },
    ]);
    const { user, router } = renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    const todo = () => screen.getByRole('region', { name: t('adminHome.board.columns.todo') });
    await user.click(within(todo()).getByRole('button', { name: t('adminHome.board.more') }));
    expect(await within(todo()).findByRole('link', { name: /Page two/ })).toBeInTheDocument();

    // A task changed somewhere: the board refetches, the loaded page stays and is reloaded.
    pageTitle = 'Page two, renamed';
    const before = globalCalls(calls).length;
    vi.useFakeTimers();
    act(() =>
      handlers.get(AdminEvents.activity)?.forEach((fn) => fn({ groupId: 'g1', kind: 'task' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    // The refetch's answer is handed to the screen on a timer too.
    for (let i = 0; i < 5; i++) await act(() => vi.advanceTimersByTimeAsync(20));
    vi.useRealTimers();
    expect(
      await within(todo()).findByRole('link', { name: /Page two, renamed/ }),
    ).toBeInTheDocument();
    expect(globalCalls(calls).slice(before)).toEqual([
      '/api/tasks/global',
      '/api/tasks/global?column=todo&after=cursor-1',
    ]);
    expect(within(todo()).getAllByRole('link')).toHaveLength(2);

    // Another filter: back to the first page.
    await router.navigate({ to: '/tasks', search: { urgent: 1 } });
    await waitFor(() =>
      expect(within(todo()).queryByRole('link', { name: /Page two/ })).toBeNull(),
    );
    expect(within(todo()).getByRole('button', { name: t('adminHome.board.more') })).toBeEnabled();
  });

  it('Show 50 more in a custom column asks for that column by its id', async () => {
    const { reply, calls } = mockBoardApi([
      (url) => {
        if (url.pathname !== '/api/tasks/global') return undefined;
        const first = board();
        if (url.searchParams.get('column') === 'custom:in translation') {
          return reply(
            200,
            board({
              columns: [
                {
                  ...first.columns[1]!,
                  total: 2,
                  items: [card({ id: 't8', title: 'Annex 3', bucketKind: 'custom' })],
                },
              ],
            }),
          );
        }
        first.columns[1] = { ...first.columns[1]!, total: 2, next: 'cursor-c' };
        return reply(200, first);
      },
    ]);
    const { user } = renderBoard();
    await screen.findByRole('link', { name: /Annex 2/ });
    const custom = screen.getByRole('region', { name: 'In translation' });
    await user.click(within(custom).getByRole('button', { name: t('adminHome.board.more') }));
    expect(await within(custom).findByRole('link', { name: /Annex 3/ })).toBeInTheDocument();
    expect(globalCalls(calls).at(-1)).toBe(
      '/api/tasks/global?column=custom%3Ain+translation&after=cursor-c',
    );
  });

  it('a card opens the panel over the board at /tasks?…&task=id and closing returns to the same filtered URL', async () => {
    mockBoardApi(panelRoutes());
    const { router, user } = renderBoard('/tasks?urgent=1');
    const link = await screen.findByRole('link', { name: /Fix budget table/ });
    expect(link).toHaveAttribute('href', '/tasks?urgent=1&task=t1');
    await user.click(link);
    const panel = await screen.findByTestId('task-panel');
    await within(panel).findByRole('heading', { name: 'Fix budget table' });
    expect(router.state.location.pathname).toBe('/tasks');
    await user.click(within(panel).getByRole('button', { name: t('forms.panel.close') }));
    await waitFor(() => expect(screen.queryByTestId('task-panel')).toBeNull());
    expect(router.state.location.pathname).toBe('/tasks');
    expect(router.state.location.search).toEqual({ urgent: 1 });
  });

  it('with onExit, Escape closes the panel and never navigates to the group board', async () => {
    mockBoardApi(panelRoutes());
    const { router, user } = renderBoard('/tasks?task=t1');
    const panel = await screen.findByTestId('task-panel');
    await within(panel).findByRole('heading', { name: 'Fix budget table' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('task-panel')).toBeNull());
    expect(router.state.location.pathname).toBe('/tasks');
    expect(router.state.location.search).toEqual({});
  });

  it('the unsaved draft blocks a task search change', async () => {
    mockBoardApi(panelRoutes());
    const { router, user } = renderBoard('/tasks?task=t1');
    const panel = await screen.findByTestId('task-panel');
    const title = await within(panel).findByLabelText(t('tasks.form.title'));
    await user.type(title, ' changed');
    await user.click(within(panel).getByRole('button', { name: t('forms.panel.close') }));
    expect(await within(panel).findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ task: 't1' });
  });

  it('clients=all (the dashboard\'s "Show all") asks for every client and the pill says so', async () => {
    const { calls } = mockBoardApi();
    renderBoard('/tasks?assignee=me&clients=all');
    await screen.findByRole('link', { name: /Fix budget table/ });
    expect(globalCalls(calls)).toEqual(['/api/tasks/global?clients=all&assignee=me']);
    expect(
      await screen.findByRole('button', { name: t('knowledge.clientFilter.pillAll') }),
    ).toBeInTheDocument();
  });

  it('cards are not draggable', async () => {
    mockBoardApi();
    renderBoard();
    const link = await screen.findByRole('link', { name: /Fix budget table/ });
    expect(link).not.toHaveAttribute('aria-roledescription');
    expect(document.querySelector('[aria-roledescription]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark as done/ })).toBeNull();
  });

  it('admin:activity refetches the board after 2 s', async () => {
    const { calls } = mockBoardApi();
    renderBoard();
    await screen.findByRole('link', { name: /Fix budget table/ });
    const before = globalCalls(calls).length;
    vi.useFakeTimers();
    act(() =>
      handlers.get(AdminEvents.activity)?.forEach((fn) => fn({ groupId: 'g1', kind: 'task' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    vi.useRealTimers();
    await waitFor(() => expect(globalCalls(calls).length).toBe(before + 1));
  });
});
