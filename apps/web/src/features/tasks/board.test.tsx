import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { ApiError } from '@/lib/api';
import { Board } from './board';
import { handleBucketDrop, handleTaskDrop } from './drop';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
}));

const ADMIN = {
  id: 'a1',
  name: 'Jana',
  email: 'j@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const CLIENT = {
  id: 'c1',
  name: 'Klient',
  email: 'k@example.com',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const bucket = (
  id: string,
  kind: BucketDto['kind'],
  position: string,
  name?: string,
): BucketDto => ({
  id,
  groupId: 'g1',
  kind,
  name: name ?? null,
  position,
});
const BUCKETS = [
  bucket('b-done', 'done', 'z0'),
  bucket('b-todo', 'todo', 'a0'),
  bucket('b-client', 'client_review', 'a8'),
  bucket('b-custom', 'custom', 'a1', 'My bucket'),
  bucket('b-egrant', 'egrant_review', 'a7'),
];
const task = (id: string, bucketId: string, extra: Partial<TaskDto> = {}): TaskDto => ({
  id,
  groupId: 'g1',
  bucketId,
  position: id,
  title: `Task ${id}`,
  urgent: false,
  dueDate: null,
  completedAt: null,
  createdBy: { id: 'a1', name: 'Jana' },
  assignees: [],
  fileCount: 0,
  upcomingReminders: 0,
  link: null,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  ...extra,
});

let board: BoardDto;
let chats: Record<string, { count: number; unread: boolean }>;
let me: typeof ADMIN | typeof CLIENT;
let fetchMock: ReturnType<typeof vi.fn>;
/** Answers the Completed column's paged requests (`board?done=`, `board/done?after=`). */
let pageReply: ((url: string) => Response) | null;
const writes = () =>
  fetchMock.mock.calls.filter(([, init]) => init && (init as RequestInit).method);

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Board groupId="g1" /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return Object.assign(userEvent.setup(), { queryClient });
}

beforeEach(() => {
  setLanguage('en');
  me = ADMIN;
  chats = {};
  pageReply = null;
  board = { buckets: BUCKETS, tasks: [task('t1', 'b-todo')], done: { total: 0, next: null } };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const method = init?.method ?? 'GET';
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/board') return reply(200, board);
    if (url.startsWith('/api/groups/g1/board?') || url.startsWith('/api/groups/g1/board/done?'))
      return pageReply ? pageReply(url) : reply(404, { error: 'not_found' });
    if (url === '/api/groups/g1/task-chats') return reply(200, chats);
    if (url === '/api/groups/g1/tasks' && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return reply(201, {
        ...task('new', body.bucketId, { title: body.title }),
        description: '',
        files: [],
        sourceMessage: null,
      });
    }
    const moving = /^\/api\/tasks\/([^/]+)\/move$/.exec(url);
    if (moving && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return reply(200, task(moving[1]!, body.bucketId, { position: 'Zz' }));
    }
    if (url === '/api/buckets/b-custom' && method === 'DELETE') return reply(204);
    if (url === '/api/buckets/b-custom' && method === 'PATCH')
      return reply(200, { ...BUCKETS[3], name: JSON.parse(init!.body as string).name });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

describe('Board', () => {
  it('renders To do, custom, eGrant review, "Acme review", Completed in that order with counts', async () => {
    board.tasks = [task('t1', 'b-todo'), task('t2', 'b-todo'), task('t3', 'b-done')];
    renderBoard();
    const columns = await screen.findAllByRole('region');
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'To do',
      'My bucket',
      'eGrant review',
      'Acme review',
      'Completed',
    ]);
    expect(within(columns[0]!).getByText('2 tasks')).toBeInTheDocument();
    expect(within(columns[4]!).getByText('1 task')).toBeInTheDocument();
    expect(within(columns[1]!).getByText('0 tasks')).toBeInTheDocument();
  });

  it('Completed shows its total and "Show 15 more" loads the next page into the column (S8)', async () => {
    board.tasks = [task('d1', 'b-done', { completedAt: 'x' })];
    board.done = { total: 3, next: 'd1' };
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    pageReply = (url) => {
      expect(url).toBe('/api/groups/g1/board/done?after=d1');
      release();
      const page = {
        tasks: [task('d2', 'b-done', { completedAt: 'x' }), task('d3', 'b-done')],
        next: null,
      };
      return new Response(JSON.stringify(page), { status: 200 });
    };
    const user = renderBoard();
    const columns = await screen.findAllByRole('region');
    const done = columns[4]!;
    expect(within(done).getByText('3 tasks')).toBeInTheDocument();
    await user.click(within(done).getByRole('button', { name: 'Show 15 more' }));
    await loaded;
    expect(await within(done).findByText('Task d3')).toBeInTheDocument();
    expect(within(done).getByText('Task d2')).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: 'Show 15 more' })).toBeNull();
    expect(within(done).getByText('3 tasks')).toBeInTheDocument();
    // Other columns never page.
    expect(within(columns[0]!).queryByRole('button', { name: 'Show 15 more' })).toBeNull();
  });

  it('a failed "Show 15 more" says so and keeps the button', async () => {
    board.tasks = [task('d1', 'b-done')];
    board.done = { total: 2, next: 'd1' };
    pageReply = () => new Response(null, { status: 500 });
    const user = renderBoard();
    const done = (await screen.findAllByRole('region'))[4]!;
    await user.click(within(done).getByRole('button', { name: 'Show 15 more' }));
    expect(await within(done).findByRole('alert')).toHaveTextContent(t('tasks.board.moreFailed'));
    expect(within(done).getByRole('button', { name: 'Show 15 more' })).toBeEnabled();
  });

  it('a refetch keeps the Completed pages already shown (asks for done=30)', async () => {
    const shown = Array.from({ length: 16 }, (_, i) =>
      task(`d${String(i).padStart(2, '0')}`, 'b-done'),
    );
    board.tasks = shown;
    board.done = { total: 40, next: 'd15' };
    pageReply = (url) => {
      expect(url).toBe('/api/groups/g1/board?done=30');
      return new Response(JSON.stringify(board), { status: 200 });
    };
    const { queryClient } = renderBoard();
    await screen.findAllByRole('region');
    await queryClient.invalidateQueries({ queryKey: ['tasks', 'g1', 'board'] });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/groups/g1/board?done=30')).toBe(
        true,
      ),
    );
  });

  it('says the board is empty in To do and "Nothing here yet." elsewhere', async () => {
    board.tasks = [];
    renderBoard();
    const columns = await screen.findAllByRole('region');
    expect(within(columns[0]!).getByText(t('tasks.board.emptyBoard'))).toBeInTheDocument();
    expect(within(columns[1]!).getByText(t('tasks.board.empty'))).toBeInTheDocument();
    expect(screen.getAllByText('Nothing here yet.')).toHaveLength(4);
  });

  it('marks an unread task: bold title, chat count with a dot', async () => {
    board.tasks = [task('t1', 'b-todo'), task('t2', 'b-todo'), task('t3', 'b-todo')];
    chats = { t1: { count: 3, unread: true }, t2: { count: 1, unread: false } };
    renderBoard();
    const card = await screen.findByRole('link', { name: /Task t1/ });
    await waitFor(() =>
      expect(
        within(card).getByText(t('tasks.card.messagesUnread', { count: 3 })),
      ).toBeInTheDocument(),
    );
    expect(within(card).getByText('Task t1')).toHaveClass('font-bold');
    const read = screen.getByRole('link', { name: /Task t2/ });
    expect(within(read).getByText(t('tasks.card.messages', { count: 1 }))).toBeInTheDocument();
    expect(within(read).getByText('Task t2')).toHaveClass('font-medium');
    // No chat entry: no chat icon, no extra meta row.
    expect(
      within(screen.getByRole('link', { name: /Task t3/ })).queryByText(/messages?$/),
    ).not.toBeInTheDocument();
  });

  it('fetches the chat summaries once per board load', async () => {
    board.tasks = [task('t1', 'b-todo'), task('t2', 'b-custom')];
    renderBoard();
    await screen.findByText('Task t1');
    await screen.findByText('Task t2');
    const calls = fetchMock.mock.calls.filter(([u]) => u === '/api/groups/g1/task-chats');
    expect(calls).toHaveLength(1);
  });

  it('the bell shows when upcomingReminders > 0, before the paperclip, labelled Has reminders', async () => {
    board.tasks = [task('t1', 'b-todo', { upcomingReminders: 2, fileCount: 1 })];
    renderBoard();
    await screen.findByText('Task t1');
    const bell = screen.getByText(t('tasks.card.reminders'));
    expect(bell).toHaveClass('sr-only');
    const files = screen.getByText(t('tasks.card.files', { count: 1 }));
    expect(bell.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a card with a link shows the link mark, labelled Has a link; none without', async () => {
    board.tasks = [task('t1', 'b-todo', { link: 'https://egrant.sk/a' }), task('t2', 'b-todo')];
    renderBoard();
    await screen.findByText('Task t1');
    const marks = screen.getAllByText(t('tasks.card.link'));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveClass('sr-only');
    // The card stays one link: no URL anchor inside it.
    expect(screen.queryByRole('link', { name: 'https://egrant.sk/a' })).toBeNull();
  });

  it('no bell at 0', async () => {
    board.tasks = [task('t1', 'b-todo', { dueDate: '2030-01-15' })];
    renderBoard();
    await screen.findByText('Task t1');
    expect(screen.queryByText(t('tasks.card.reminders'))).toBeNull();
  });

  it('shows the Urgent pill on an urgent card only', async () => {
    board.tasks = [task('t1', 'b-todo', { urgent: true }), task('t2', 'b-todo')];
    renderBoard();
    await screen.findByText('Task t1');
    expect(screen.getAllByText('Urgent')).toHaveLength(1);
  });

  it('marks an overdue deadline as error-ink, but not in Completed', async () => {
    const past = { dueDate: '2020-10-18' };
    board.tasks = [task('t1', 'b-todo', past), task('t2', 'b-done', past)];
    renderBoard();
    await screen.findByText('Task t1');
    const [open, done] = screen.getAllByText('18 Oct');
    expect(open).toHaveClass('text-error-ink');
    expect(within(open!).getByText(/Overdue/)).toBeInTheDocument();
    expect(done).not.toHaveClass('text-error-ink');
    expect(screen.getAllByText(/Overdue/)).toHaveLength(1);
  });

  it('shows three avatars and +1 for four assignees', async () => {
    const people = ['A One', 'B Two', 'C Three', 'D Four'].map((name, i) => ({
      id: `p${i}`,
      name,
    }));
    board.tasks = [task('t1', 'b-todo', { assignees: people })];
    renderBoard();
    const card = (await screen.findByText('Task t1')).closest('a')!;
    expect(card.querySelectorAll('[aria-hidden="true"].rounded-full')).toHaveLength(3);
    expect(within(card).getByText('+1')).toBeInTheDocument();
  });

  it('"Add task" links to the create panel with the bucket preselected', async () => {
    renderBoard();
    const columns = await screen.findAllByRole('region');
    expect(within(columns[0]!).getByRole('link', { name: 'Add task' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/new?bucket=b-todo',
    );
    expect(within(columns[4]!).getByRole('link', { name: 'Add task' })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/new?bucket=b-done',
    );
    expect(screen.queryByLabelText('Task title')).toBeNull();
  });

  it('shows Add bucket and the custom bucket menu to admins, neither to a client', async () => {
    renderBoard();
    await screen.findAllByRole('region');
    expect(screen.getByRole('button', { name: 'Add column' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^More/ })).toHaveLength(1);
  });

  it('puts "Add column" after the last bucket', async () => {
    renderBoard();
    const columns = await screen.findAllByRole('region');
    const add = screen.getByRole('button', { name: 'Add column' });
    expect(columns.at(-1)!.getAttribute('aria-label')).toBe('Completed');
    expect(
      columns.at(-1)!.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const column of columns.slice(0, -1)) {
      expect(column.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('gives admins a drag handle on every bucket, fixed ones included', async () => {
    renderBoard();
    await screen.findAllByRole('region');
    for (const title of ['To do', 'My bucket', 'eGrant review', 'Acme review', 'Completed']) {
      expect(screen.getByRole('button', { name: `Move ${title}` })).toBeInTheDocument();
    }
  });

  it('hides bucket management from a client', async () => {
    me = CLIENT;
    renderBoard();
    await screen.findAllByRole('region');
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add column' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More/ })).not.toBeInTheDocument();
  });

  describe('rename', () => {
    async function startRename() {
      const user = renderBoard();
      await screen.findAllByRole('region');
      await user.click(screen.getByRole('button', { name: /^More/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      return { user, input: await screen.findByLabelText('Bucket name') };
    }

    it('keeps the field open after the menu closes; Enter sends PATCH and shows the new name', async () => {
      const { user, input } = await startRename();
      expect(input).toHaveFocus();
      await user.clear(input);
      await user.type(input, 'Renamed{Enter}');
      expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
      const [url, init] = writes()[0]!;
      expect(`${(init as RequestInit).method} ${url}`).toBe('PATCH /api/buckets/b-custom');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'Renamed' });
    });

    it('Esc cancels without a request', async () => {
      const { user, input } = await startRename();
      await user.type(input, 'x{Escape}');
      expect(screen.getByRole('heading', { name: 'My bucket' })).toBeInTheDocument();
      expect(writes()).toHaveLength(0);
    });

    it('blur cancels without a request', async () => {
      const { user } = await startRename();
      await user.click(document.body);
      expect(await screen.findByRole('heading', { name: 'My bucket' })).toBeInTheDocument();
      expect(writes()).toHaveLength(0);
    });
  });

  it('shows a loading line, then an error with Try again when the board fails to load', async () => {
    let fail = true;
    const base = fetchMock.getMockImplementation() as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/groups/g1/board' && fail
        ? new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
        : base(url, init),
    );
    const user = renderBoard();
    expect(await screen.findByText('Loading the board.')).toBeInTheDocument();
    expect(await screen.findByText('Could not load the board.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('region')).toHaveLength(5);
  });

  it('delete bucket asks inline, then sends DELETE', async () => {
    const user = renderBoard();
    await screen.findAllByRole('region');
    await user.click(screen.getByRole('button', { name: /^More/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete this bucket? Its tasks move to To do.')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(writes().map(([url, init]) => `${(init as RequestInit).method} ${url}`)).toEqual([
        'DELETE /api/buckets/b-custom',
      ]),
    );
  });

  describe('done circle', () => {
    const moveBody = (id: string) =>
      JSON.parse(
        (writes().find(([url]) => url === `/api/tasks/${id}/move`)![1] as RequestInit)
          .body as string,
      );

    it('every card has one; Completed cards are checked and struck through', async () => {
      board.tasks = [task('t1', 'b-todo'), task('t2', 'b-custom'), task('t3', 'b-done')];
      renderBoard();
      const columns = await screen.findAllByRole('region');
      expect(within(columns[0]!).getByRole('button', { name: 'Mark as done' })).toBeInTheDocument();
      expect(within(columns[1]!).getByRole('button', { name: 'Mark as done' })).toBeInTheDocument();
      const undo = within(columns[4]!).getByRole('button', { name: 'Mark as not done' });
      expect(undo).toHaveAttribute('data-checked', 'true');
      expect(within(columns[4]!).getByText('Task t3')).toHaveClass('line-through');
      expect(within(columns[0]!).getByText('Task t1')).not.toHaveClass('line-through');
    });

    it('is described by the card title', async () => {
      board.tasks = [task('t1', 'b-todo')];
      renderBoard();
      const circle = await screen.findByRole('button', { name: 'Mark as done' });
      expect(circle).toHaveAccessibleDescription('Task t1');
    });

    it('checking moves the task to the top of Completed through the move endpoint', async () => {
      board.tasks = [task('t1', 'b-todo'), task('t3', 'b-done', { position: 'a0' })];
      const user = renderBoard();
      const columns = await screen.findAllByRole('region');
      await user.click(within(columns[0]!).getByRole('button', { name: 'Mark as done' }));
      await waitFor(() =>
        expect(moveBody('t1')).toEqual({ bucketId: 'b-done', afterTaskId: null }),
      );
      await waitFor(() =>
        expect(
          within(columns[4]!)
            .getAllByRole('link', { name: /^Task/ })
            .map((a) => a.textContent),
        ).toEqual(['Task t1', 'Task t3']),
      );
    });

    it('unchecking a task in Completed moves it to the top of To do; clients can too', async () => {
      me = CLIENT;
      board.tasks = [task('t0', 'b-todo', { position: 'a0' }), task('t3', 'b-done')];
      const user = renderBoard();
      const columns = await screen.findAllByRole('region');
      await user.click(within(columns[4]!).getByRole('button', { name: 'Mark as not done' }));
      await waitFor(() =>
        expect(moveBody('t3')).toEqual({ bucketId: 'b-todo', afterTaskId: null }),
      );
    });
  });

  describe('drop', () => {
    const DROP = { bucketId: 'b-egrant', afterTaskId: 't2', optimisticPosition: 'a1' };
    const KEY = ['tasks', 'g1', 'board'];

    /** Drops t1 from To do into eGrant review; `meanwhile` runs before the server fails. */
    async function dropWith(error: ApiError, meanwhile?: (queryClient: QueryClient) => void) {
      board.tasks = [task('t1', 'b-todo', { position: 'a0' }), task('t2', 'b-egrant')];
      const { queryClient } = renderBoard();
      const columns = await screen.findAllByRole('region');
      let fail!: (reason: unknown) => void;
      const move = vi.fn(() => new Promise<TaskDto>((_, reject) => (fail = reject)));
      const done = handleTaskDrop(queryClient, 'g1', 't1', DROP, move);
      // Optimistic: the card is in eGrant review before the server answers.
      await waitFor(() => expect(within(columns[2]!).getByText('Task t1')).toBeInTheDocument());
      expect(within(columns[0]!).queryByText('Task t1')).not.toBeInTheDocument();
      meanwhile?.(queryClient);
      fail(error);
      await done;
      expect(move).toHaveBeenCalledWith('t1', { bucketId: 'b-egrant', afterTaskId: 't2' });
      return columns;
    }
    const refused = () => new ApiError('forbidden', 403, { error: 'forbidden' });
    const gone = () => new ApiError('not_found', 404, { error: 'not_found' });

    it('a refused move restores the card to its bucket and shows the notice', async () => {
      const columns = await dropWith(refused());
      expect(await within(columns[0]!).findByText('Task t1')).toBeInTheDocument();
      expect(within(columns[2]!).queryByText('Task t1')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('The task could not be moved.');
    });

    it('a refused move keeps live changes made meanwhile', async () => {
      const columns = await dropWith(refused(), (queryClient) =>
        queryClient.setQueryData<BoardDto>(KEY, (b) => ({
          ...b!,
          tasks: b!.tasks.map((t) => (t.id === 't2' ? { ...t, title: 'Renamed live' } : t)),
        })),
      );
      expect(await within(columns[0]!).findByText('Task t1')).toBeInTheDocument();
      expect(within(columns[2]!).getByText('Renamed live')).toBeInTheDocument();
    });

    it('a refused move does not undo a live move of the same card', async () => {
      const columns = await dropWith(refused(), (queryClient) =>
        queryClient.setQueryData<BoardDto>(KEY, (b) => ({
          ...b!,
          tasks: b!.tasks.map((t) =>
            t.id === 't1' ? { ...t, bucketId: 'b-done', position: 'a0' } : t,
          ),
        })),
      );
      expect(await within(columns[4]!).findByText('Task t1')).toBeInTheDocument();
      expect(within(columns[0]!).queryByText('Task t1')).not.toBeInTheDocument();
    });

    it('a 404 removes the card and shows "This task was deleted."', async () => {
      // The server deleted it: the reloaded board no longer has it.
      await dropWith(gone(), () => (board = { ...board, tasks: [task('t2', 'b-egrant')] }));
      await waitFor(() => expect(screen.queryByText('Task t1')).not.toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent('This task was deleted.');
    });

    it('a 404 for a task that still exists (its target bucket is gone) reloads it back', async () => {
      const columns = await dropWith(gone());
      expect(await within(columns[0]!).findByText('Task t1')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('The task could not be moved.');
    });

    it('a successful move keeps the server copy', async () => {
      board.tasks = [task('t1', 'b-todo', { position: 'a0' })];
      const { queryClient } = renderBoard();
      const columns = await screen.findAllByRole('region');
      const move = vi.fn(async () => task('t1', 'b-done', { position: 'a0', title: 'Server' }));
      await handleTaskDrop(queryClient, 'g1', 't1', { ...DROP, bucketId: 'b-done' }, move);
      expect(await within(columns[4]!).findByText('Server')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('a card deleted live while it moved stays deleted', async () => {
      board.tasks = [task('t1', 'b-todo', { position: 'a0' })];
      const { queryClient } = renderBoard();
      await screen.findByText('Task t1');
      const move = vi.fn(async () => {
        queryClient.setQueryData<BoardDto>(KEY, (b) => ({ ...b!, tasks: [] }));
        return task('t1', 'b-done', { position: 'a0' });
      });
      await handleTaskDrop(queryClient, 'g1', 't1', { ...DROP, bucketId: 'b-done' }, move);
      await waitFor(() => expect(screen.queryByText('Task t1')).not.toBeInTheDocument());
      expect(queryClient.getQueryData<BoardDto>(KEY)!.tasks).toEqual([]);
    });
  });

  it('reorders a fixed bucket with the keyboard: Space, ArrowRight, Space sends the PATCH', async () => {
    // jsdom has no layout: give each column a 288 px box side by side, everything else none.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const section = this.closest('[data-bucket-id]');
      if (!section || section !== this) return new DOMRect(0, 0, 0, 0);
      const index = [...document.querySelectorAll('[data-bucket-id]')].indexOf(section);
      return new DOMRect(index * 300, 0, 288, 400);
    });
    try {
      const user = renderBoard();
      await screen.findAllByRole('region');
      screen.getByRole('button', { name: 'Move To do' }).focus();
      await user.keyboard(' ');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await user.keyboard('{ArrowRight}');
      await user.keyboard(' ');
      await waitFor(() => {
        const patch = writes().find(([url]) => url === '/api/buckets/b-todo');
        expect(patch).toBeDefined();
        expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
          afterBucketId: 'b-custom',
        });
      });
    } finally {
      rect.mockRestore();
    }
  });

  describe('bucket drop', () => {
    const KEY = ['tasks', 'g1', 'board'];
    const order = () => screen.getAllByRole('region').map((c) => c.getAttribute('aria-label'));

    it('moves the column at once and keeps the server position', async () => {
      const { queryClient } = renderBoard();
      await screen.findAllByRole('region');
      const update = vi.fn(async () => ({ ...BUCKETS[3]!, position: 'a7V' }));
      await handleBucketDrop(queryClient, 'g1', 'b-custom', 'b-egrant', update);
      expect(update).toHaveBeenCalledWith('b-custom', { afterBucketId: 'b-egrant' });
      await waitFor(() =>
        expect(order()).toEqual([
          'To do',
          'eGrant review',
          'My bucket',
          'Acme review',
          'Completed',
        ]),
      );
      expect(
        queryClient.getQueryData<BoardDto>(KEY)!.buckets.find((b) => b.id === 'b-custom')!.position,
      ).toBe('a7V');
    });

    it('moves a fixed bucket to the front with afterBucketId null', async () => {
      const { queryClient } = renderBoard();
      await screen.findAllByRole('region');
      const update = vi.fn(async () => ({ ...BUCKETS[0]!, position: 'Zz' }));
      await handleBucketDrop(queryClient, 'g1', 'b-done', null, update);
      expect(update).toHaveBeenCalledWith('b-done', { afterBucketId: null });
      await waitFor(() => expect(order()[0]).toBe('Completed'));
    });

    it('a failure puts it back and says so', async () => {
      const { queryClient } = renderBoard();
      await screen.findAllByRole('region');
      let fail!: (reason: unknown) => void;
      const update = vi.fn(() => new Promise<BucketDto>((_, reject) => (fail = reject)));
      const done = handleBucketDrop(queryClient, 'g1', 'b-custom', 'b-egrant', update);
      await waitFor(() => expect(order()[2]).toBe('My bucket'));
      fail(new ApiError('forbidden', 403, { error: 'forbidden' }));
      await done;
      await waitFor(() => expect(order()[1]).toBe('My bucket'));
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
    });

    it('a 404 reloads the board', async () => {
      const { queryClient } = renderBoard();
      await screen.findAllByRole('region');
      board = { ...board, buckets: BUCKETS.filter((b) => b.id !== 'b-custom') };
      const update = vi.fn(async () => {
        throw new ApiError('not_found', 404, { error: 'not_found' });
      });
      await handleBucketDrop(queryClient, 'g1', 'b-custom', 'b-egrant', update);
      await waitFor(() => expect(order()).not.toContain('My bucket'));
    });
  });
});
