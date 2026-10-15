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
import { handleTaskDrop } from './drop';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
}));

const ADMIN = { id: 'a1', name: 'Jana', email: 'j@example.com', role: 'admin', groupId: null };
const CLIENT = { id: 'c1', name: 'Klient', email: 'k@example.com', role: 'client', groupId: 'g1' };
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
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  ...extra,
});

let board: BoardDto;
let me: typeof ADMIN | typeof CLIENT;
let fetchMock: ReturnType<typeof vi.fn>;
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
  board = { buckets: BUCKETS, tasks: [task('t1', 'b-todo')] };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const method = init?.method ?? 'GET';
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/board') return reply(200, board);
    if (url === '/api/groups/g1/tasks' && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return reply(201, {
        ...task('new', body.bucketId, { title: body.title }),
        description: '',
        files: [],
        sourceMessage: null,
      });
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

  it('says the board is empty in To do and "Nothing here yet." elsewhere', async () => {
    board.tasks = [];
    renderBoard();
    const columns = await screen.findAllByRole('region');
    expect(within(columns[0]!).getByText(t('tasks.board.emptyBoard'))).toBeInTheDocument();
    expect(within(columns[1]!).getByText(t('tasks.board.empty'))).toBeInTheDocument();
    expect(screen.getAllByText('Nothing here yet.')).toHaveLength(4);
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

  it('inline add: Enter posts { title, bucketId } and the card appears; Esc cancels', async () => {
    const user = renderBoard();
    const todo = (await screen.findAllByRole('region'))[0]!;
    await user.click(within(todo).getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText('Task title'), 'Write brief{Enter}');
    expect(await screen.findByText('Write brief')).toBeInTheDocument();
    const post = writes().find(([url]) => url === '/api/groups/g1/tasks')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      title: 'Write brief',
      bucketId: 'b-todo',
    });

    const before = writes().length;
    await user.type(screen.getByLabelText('Task title'), 'Nope{Escape}');
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(before);
  });

  it('shows Add bucket and the custom bucket menu to admins, neither to a client', async () => {
    renderBoard();
    await screen.findAllByRole('region');
    expect(screen.getByRole('button', { name: 'Add bucket' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^More/ })).toHaveLength(1);
  });

  it('hides bucket management from a client', async () => {
    me = CLIENT;
    renderBoard();
    await screen.findAllByRole('region');
    expect(screen.queryByRole('button', { name: 'Add bucket' })).not.toBeInTheDocument();
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

  describe('drop', () => {
    const DROP = { bucketId: 'b-egrant', afterTaskId: 't2', optimisticPosition: 'a1' };

    async function dropWith(error: ApiError) {
      board.tasks = [task('t1', 'b-todo', { position: 'a0' }), task('t2', 'b-egrant')];
      const { queryClient } = renderBoard();
      const columns = await screen.findAllByRole('region');
      let fail!: (reason: unknown) => void;
      const move = vi.fn(() => new Promise<TaskDto>((_, reject) => (fail = reject)));
      const done = handleTaskDrop(queryClient, 'g1', 't1', DROP, move);
      // Optimistic: the card is in eGrant review before the server answers.
      await waitFor(() => expect(within(columns[2]!).getByText('Task t1')).toBeInTheDocument());
      expect(within(columns[0]!).queryByText('Task t1')).not.toBeInTheDocument();
      fail(error);
      await done;
      expect(move).toHaveBeenCalledWith('t1', { bucketId: 'b-egrant', afterTaskId: 't2' });
      return columns;
    }

    it('a refused move restores the card to its bucket and shows the notice', async () => {
      const columns = await dropWith(new ApiError('forbidden', 403, { error: 'forbidden' }));
      expect(await within(columns[0]!).findByText('Task t1')).toBeInTheDocument();
      expect(within(columns[2]!).queryByText('Task t1')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('The task could not be moved.');
    });

    it('a 404 removes the card and shows "This task was deleted."', async () => {
      await dropWith(new ApiError('not_found', 404, { error: 'not_found' }));
      await waitFor(() => expect(screen.queryByText('Task t1')).not.toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent('This task was deleted.');
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
  });
});
