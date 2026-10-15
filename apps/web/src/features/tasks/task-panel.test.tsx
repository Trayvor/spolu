import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserHistory, createMemoryHistory } from '@tanstack/react-router';
import { BoardEvents, type BucketDto, type TaskDetailDto, type TaskDto } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { taskQuery } from './api';

const handlers = new Map<string, (payload: unknown) => void>();
const socket = {
  on: vi.fn((event: string, fn: (payload: unknown) => void) => handlers.set(event, fn)),
  off: vi.fn((event: string) => handlers.delete(event)),
  emit: vi.fn(),
  connected: false,
};
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Jana', email: 'j@example.com', role: 'admin', groupId: null };
const CLIENT = { id: 'c1', name: 'Klient', email: 'k@example.com', role: 'client', groupId: 'g1' };
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
};
const bucket = (id: string, kind: BucketDto['kind'], position: string): BucketDto => ({
  id,
  groupId: 'g1',
  kind,
  name: null,
  position,
});
const BUCKETS = [bucket('b-todo', 'todo', 'a0'), bucket('b-done', 'done', 'z0')];
const card = (id: string, bucketId: string): TaskDto => ({
  id,
  groupId: 'g1',
  bucketId,
  position: id,
  title: `Task ${id}`,
  urgent: false,
  dueDate: null,
  completedAt: null,
  createdBy: { id: 'a1', name: 'Jana Nováková' },
  assignees: [],
  fileCount: 0,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
});

let me: typeof ADMIN | typeof CLIENT;
let detail: TaskDetailDto;
let fetchMock: ReturnType<typeof vi.fn>;
let patchReply: { status: number; body: unknown } | null;
const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, i]) => u === url && ((i as RequestInit | undefined)?.method ?? 'GET') === method,
  );

beforeEach(() => {
  setLanguage('en');
  handlers.clear();
  me = ADMIN;
  patchReply = null;
  detail = { ...card('t1', 'b-todo'), description: 'Details', files: [], sourceMessage: null };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, me);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/board')
      return reply(200, {
        buckets: BUCKETS,
        tasks: [{ ...card('t1', detail.bucketId) }, card('t9', 'b-done'), card('t8', 'b-done')],
      });
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url === '/api/tasks/t1' && method === 'GET') return reply(200, detail);
    if (url === '/api/tasks/t1' && method === 'PATCH') {
      if (patchReply) return reply(patchReply.status, patchReply.body);
      const body = JSON.parse(init!.body as string);
      return reply(200, { ...detail, ...body, updatedAt: '2026-10-16T10:00:00.000Z' });
    }
    if (url === '/api/tasks/t1/move') return reply(200, card('t1', 'b-done'));
    if (url === '/api/groups/g1/tasks' && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return reply(201, {
        ...card('t2', body.bucketId),
        title: body.title,
        description: body.description,
        files: [],
        sourceMessage: null,
      });
    }
    if (url === '/api/tasks/t1' && method === 'DELETE') return reply(204);
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderPanel(path = '/groups/g1/tasks/t1', seed?: (queryClient: QueryClient) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(queryClient);
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user, router };
}

const titleField = () => screen.findByLabelText(t('tasks.form.title'));

describe('TaskPanel', () => {
  it('shows the form filled from the task and the created-by footer', async () => {
    renderPanel();
    expect(await titleField()).toHaveValue('Task t1');
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Created by Jana Nováková on 15 Oct 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('tasks.panel.save') })).toBeNull();
  });

  it('offers Save changes only after an edit and sends PATCH with updatedAt', async () => {
    const { user } = renderPanel();
    await user.type(await titleField(), '!');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.save') }));
    await waitFor(() => expect(calls('PATCH', '/api/tasks/t1')).toHaveLength(1));
    const body = JSON.parse((calls('PATCH', '/api/tasks/t1')[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ title: 'Task t1!', updatedAt: '2026-10-15T10:00:00.000Z' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('tasks.panel.save') })).toBeNull(),
    );
  });

  it('answers 409 task_changed with a notice and keeps the typed title until Reload', async () => {
    patchReply = { status: 409, body: { error: 'task_changed' } };
    const { user } = renderPanel();
    await user.type(await titleField(), '!');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.save') }));
    expect(await screen.findByText(t('tasks.panel.changedBySomeone'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Task t1!');
    detail = { ...detail, title: 'Theirs', updatedAt: '2026-10-16T09:00:00.000Z' };
    await user.click(screen.getByRole('button', { name: t('tasks.panel.reload') }));
    await waitFor(() => expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Theirs'));
    expect(screen.queryByText(t('tasks.panel.changedBySomeone'))).toBeNull();
  });

  it('a task event from someone else warns while dirty and reloads silently while clean', async () => {
    const { user } = renderPanel();
    await user.type(await titleField(), '!');
    const theirs = { ...card('t1', 'b-todo'), updatedAt: '2026-10-16T09:00:00.000Z' };
    detail = { ...detail, title: 'Theirs', updatedAt: theirs.updatedAt };
    act(() => handlers.get(BoardEvents.task)!({ task: theirs, actor: { id: 'u9', name: 'Jana' } }));
    expect(await screen.findByText('Changed by Jana just now.')).toBeInTheDocument();
    expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Task t1!');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.reload') }));
    await waitFor(() => expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Theirs'));

    // Clean now: the next foreign change replaces the form without a notice.
    const again = { ...theirs, updatedAt: '2026-10-16T09:30:00.000Z' };
    detail = { ...detail, title: 'Again', updatedAt: again.updatedAt };
    act(() => handlers.get(BoardEvents.task)!({ task: again, actor: { id: 'u9', name: 'Jana' } }));
    await waitFor(() => expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Again'));
    expect(screen.queryByText('Changed by Jana just now.')).toBeNull();
  });

  it('a panel opened on a stale cached detail catches up when the refetch brings a newer one', async () => {
    const old = { ...detail };
    detail = { ...detail, title: 'Newer', updatedAt: '2026-10-16T09:00:00.000Z' };
    renderPanel('/groups/g1/tasks/t1', (qc) => qc.setQueryData(taskQuery('t1').queryKey, old));
    await waitFor(() => expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Newer'));
    expect(screen.queryByText(t('tasks.panel.changedBySomeone'))).toBeNull();
  });

  it('a newer version arriving through a refetch while editing shows the notice, keeps edits', async () => {
    const old = { ...detail };
    detail = { ...detail, title: 'Newer', updatedAt: '2026-10-16T09:00:00.000Z' };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = fetchMock.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/tasks/t1' && !init?.method) await gate;
      return inner(url, init);
    });
    const { user } = renderPanel('/groups/g1/tasks/t1', (qc) =>
      qc.setQueryData(taskQuery('t1').queryKey, old),
    );
    await user.type(await titleField(), '!');
    release();
    expect(await screen.findByText(t('tasks.panel.changedBySomeone'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Task t1!');
  });

  it('catches up after a rejoin: the invalidated detail refetches and replaces a clean form', async () => {
    let qc!: QueryClient;
    renderPanel('/groups/g1/tasks/t1', (client) => (qc = client));
    expect(await titleField()).toHaveValue('Task t1');
    detail = { ...detail, title: 'After rejoin', updatedAt: '2026-10-16T09:00:00.000Z' };
    await act(() => qc.invalidateQueries({ queryKey: ['tasks', 'task'] }));
    await waitFor(() =>
      expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('After rejoin'),
    );
  });

  it('deleting your own task does not show the "deleted" notice when the socket event comes first', async () => {
    const { user, router } = renderPanel();
    await titleField();
    const inner = fetchMock.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/tasks/t1' && init?.method === 'DELETE') {
        act(() => handlers.get(BoardEvents.taskDeleted)!({ groupId: 'g1', taskId: 't1' }));
      }
      return inner(url, init);
    });
    await user.click(await screen.findByRole('button', { name: t('tasks.panel.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('tasks.panel.delete') }));
    await user.click(screen.getByRole('button', { name: t('tasks.panel.delete') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(screen.queryByText(t('tasks.board.taskDeleted'))).toBeNull();
  });

  it('choosing Completed posts the move after the last task there', async () => {
    const { user } = renderPanel();
    await titleField();
    await waitFor(() => expect(screen.getByLabelText(t('tasks.panel.bucket'))).toBeEnabled());
    await user.selectOptions(screen.getByLabelText(t('tasks.panel.bucket')), 'b-done');
    await waitFor(() => expect(calls('POST', '/api/tasks/t1/move')).toHaveLength(1));
    const body = JSON.parse(
      (calls('POST', '/api/tasks/t1/move')[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({ bucketId: 'b-done', afterTaskId: 't9' });
  });

  it('shows Delete to admins and the creator, not to other clients', async () => {
    me = CLIENT;
    renderPanel();
    await titleField();
    expect(screen.queryByRole('button', { name: t('tasks.panel.more') })).toBeNull();
  });

  it('shows Delete to a client who created the task', async () => {
    me = CLIENT;
    detail = { ...detail, createdBy: { id: 'c1', name: 'Klient' } };
    renderPanel();
    expect(await screen.findByRole('button', { name: t('tasks.panel.more') })).toBeInTheDocument();
  });

  it('confirming Delete sends DELETE and returns to the board', async () => {
    const { user, router } = renderPanel();
    await titleField();
    await user.click(await screen.findByRole('button', { name: t('tasks.panel.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('tasks.panel.delete') }));
    expect(screen.getByText(t('tasks.panel.deleteConfirm'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('tasks.panel.delete') }));
    await waitFor(() => expect(calls('DELETE', '/api/tasks/t1')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('Close with unsaved changes asks first; Keep editing stays, Discard leaves', async () => {
    const { user, router } = renderPanel();
    await user.type(await titleField(), '!');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.close') }));
    expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/tasks/t1');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.keepEditing') }));
    expect(screen.queryByText(t('tasks.panel.unsaved'))).toBeNull();
    await user.click(screen.getByRole('button', { name: t('tasks.panel.close') }));
    await user.click(await screen.findByRole('button', { name: t('tasks.panel.discard') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('renders the source message block with a link into the chat', async () => {
    detail = {
      ...detail,
      sourceMessage: { id: 'm1', authorName: 'Eva', excerpt: 'Please send the budget' },
    };
    renderPanel();
    expect(await screen.findByText(t('tasks.panel.fromMessage'))).toBeInTheDocument();
    expect(screen.getByText('Eva')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('tasks.panel.openMessage') })).toHaveAttribute(
      'href',
      '/groups/g1/chat?message=m1',
    );
  });

  it('a task that is gone sends the user back to the board with the deleted notice', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const reply = (status: number, body?: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (url === '/api/me') return reply(200, me);
      if (url === '/api/groups/g1') return reply(200, GROUP);
      if (url === '/api/groups/g1/board') return reply(200, { buckets: BUCKETS, tasks: [] });
      return reply(404, { error: 'not_found' });
    });
    const { router } = renderPanel();
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(await screen.findByText(t('tasks.board.taskDeleted'))).toBeInTheDocument();
  });

  it('moves the focus to the panel heading on open and back to the card on close', async () => {
    const { user, router } = renderPanel();
    const heading = await screen.findByRole('heading', { name: 'Task t1' });
    await waitFor(() => expect(heading).toHaveFocus());
    const card = await screen.findByRole('link', { name: /Task t1/ });
    await user.click(screen.getByRole('button', { name: t('tasks.panel.close') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    await waitFor(() => expect(card).toHaveFocus());
  });

  it('Escape asks first when there are unsaved changes', async () => {
    const { user, router } = renderPanel();
    await user.type(await titleField(), '!');
    await user.keyboard('{Escape}');
    expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/tasks/t1');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.discard') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('Escape closes a clean panel at once', async () => {
    const { user, router } = renderPanel();
    await titleField();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('asks the browser before unloading only with unsaved changes', async () => {
    window.history.pushState({}, '', '/groups/g1/tasks/t1');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(queryClient, createBrowserHistory());
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const input = await titleField();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.type(input, '!');
    expect(unload()).toBe(true);
  });
});

describe('TaskPanel in create mode', () => {
  const NEW = '/groups/g1/tasks/new?bucket=b-done';
  const createButton = () => screen.getByRole('button', { name: t('tasks.panel.create') });

  it('shows every field empty, the bucket preselected, and saves nothing before Create', async () => {
    renderPanel(NEW);
    expect(await titleField()).toHaveValue('');
    expect(screen.getByRole('heading', { name: t('tasks.panel.newTask') })).toBeInTheDocument();
    expect(screen.getByLabelText(t('tasks.form.description'))).toHaveValue('');
    expect(screen.getByRole('combobox', { name: t('tasks.form.assignees') })).toBeInTheDocument();
    expect(screen.getByLabelText(t('tasks.form.deadline'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t('tasks.form.urgent') })).toBeInTheDocument();
    expect(screen.getByText(t('tasks.form.files'))).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(t('tasks.panel.bucket'))).toHaveValue('b-done'),
    );
    expect(createButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('tasks.panel.more') })).toBeNull();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });

  it('Create posts the whole draft to the chosen bucket and returns to the board', async () => {
    const { user, router } = renderPanel(NEW);
    await user.type(await titleField(), 'Budget');
    await user.type(screen.getByLabelText(t('tasks.form.description')), 'Check **totals**');
    await user.click(screen.getByRole('switch', { name: t('tasks.form.urgent') }));
    await waitFor(() => expect(screen.getByLabelText(t('tasks.panel.bucket'))).toBeEnabled());
    await user.selectOptions(screen.getByLabelText(t('tasks.panel.bucket')), 'b-todo');
    await user.click(createButton());
    await waitFor(() => expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(1));
    const body = JSON.parse(
      (calls('POST', '/api/groups/g1/tasks')[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({
      title: 'Budget',
      description: 'Check **totals**',
      assigneeIds: [],
      dueDate: null,
      urgent: true,
      fileIds: [],
      bucketId: 'b-todo',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(await screen.findByRole('link', { name: /Budget/ })).toBeInTheDocument();
  });

  it('an empty title shows the error and posts nothing', async () => {
    const { user } = renderPanel(NEW);
    await titleField();
    await user.click(createButton());
    expect(await screen.findByText(t('tasks.form.errors.titleRequired'))).toBeInTheDocument();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });

  it('closing discards the draft without asking', async () => {
    const { user, router } = renderPanel(NEW);
    await user.type(await titleField(), 'Draft');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.close') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(screen.queryByText(t('tasks.panel.unsaved'))).toBeNull();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });
});
