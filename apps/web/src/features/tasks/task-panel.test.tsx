import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserHistory, createMemoryHistory } from '@tanstack/react-router';
import {
  BoardEvents,
  type BucketDto,
  type FileInfo,
  type TaskDetailDto,
  type TaskDto,
} from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { chatMessageHref } from '@/features/chat/links';
import { uploadFile } from '@/features/files/upload';
import { taskQuery } from './api';

const handlers = new Map<string, (payload: unknown) => void>();
const socket = {
  on: vi.fn((event: string, fn: (payload: unknown) => void) => handlers.set(event, fn)),
  off: vi.fn((event: string) => handlers.delete(event)),
  emit: vi.fn(),
  connected: false,
};
// Marking seen (2026-10-17) has its own test; here it would add requests and listeners.
vi.mock('@/lib/use-mark-seen', () => ({ useMarkSeen: () => {} }));
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
// The conversation has its own tests; here it only has to be mounted for the right channel.
vi.mock('@/features/chat/conversation', () => ({
  Conversation: (props: { channelId: string; threadMode?: string }) => (
    <div
      data-testid="conversation"
      data-channel={props.channelId}
      data-thread-mode={props.threadMode}
    />
  ),
}));
const markAllRead = vi.hoisted(() =>
  vi.fn<(channelId: string) => Promise<void>>(async () => undefined),
);
vi.mock('@/features/chat/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/api')>()),
  markAllRead,
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

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
  link: null,
  completedAt: null,
  createdBy: { id: 'a1', name: 'Jana Nováková' },
  assignees: [],
  fileCount: 0,
  upcomingReminders: 0,
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
  markAllRead.mockClear();
  me = ADMIN;
  patchReply = null;
  detail = {
    ...card('t1', 'b-todo'),
    description: 'Some details',
    files: [],
    sourceMessage: null,
    sourceTicket: null,
    sourceMeeting: null,
  };
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
        done: { total: 2, next: null },
      });
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url === '/api/tasks/t1' && method === 'GET') return reply(200, detail);
    if (url === '/api/tasks/t1' && method === 'PATCH') {
      if (patchReply) return reply(patchReply.status, patchReply.body);
      const body = JSON.parse(init!.body as string);
      return reply(200, { ...detail, ...body, updatedAt: '2026-10-16T10:00:00.000Z' });
    }
    if (url === '/api/tasks/t1/move') return reply(200, card('t1', 'b-done'));
    if (url === '/api/tasks/t1/chat')
      return reply(200, { id: 'ch1', lastSeq: 3, lastReadAt: null, unread: 3 });
    if (url === '/api/groups/g1/tasks' && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      return reply(201, {
        ...card('t2', body.bucketId),
        title: body.title,
        description: body.description,
        files: [],
        sourceMessage: null,
        sourceTicket: null,
        sourceMeeting: null,
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
const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('TaskPanel', () => {
  it('shows the form filled from the task and the created-by footer', async () => {
    renderPanel();
    expect(await titleField()).toHaveValue('Task t1');
    expect(screen.getByText('Some details')).toBeInTheDocument();
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
    // Editing never warns about an empty link.
    expect(screen.queryByText(t('tasks.form.linkEmptyWarning'))).toBeNull();
  });

  it('shows a saved link as a link in a new tab and edits it in place', async () => {
    detail = { ...detail, link: 'https://egrant.sk/projekt/1' };
    const { user } = renderPanel();
    const field = await screen.findByRole('textbox', { name: t('tasks.form.link') });
    expect(field).toHaveValue('https://egrant.sk/projekt/1');
    const open = screen.getByRole('link', { name: new RegExp(t('tasks.form.openLink')) });
    expect(open).toHaveAttribute('href', 'https://egrant.sk/projekt/1');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: t('tasks.panel.save') }));
    await waitFor(() => expect(calls('PATCH', '/api/tasks/t1')).toHaveLength(1));
    const body = JSON.parse((calls('PATCH', '/api/tasks/t1')[0]![1] as RequestInit).body as string);
    expect(body.link).toBeNull();
    expect(screen.queryByText(t('tasks.form.linkEmptyWarning'))).toBeNull();
  });

  it('invalid_url on save shows the link error', async () => {
    patchReply = { status: 400, body: { error: 'invalid_url' } };
    const { user } = renderPanel();
    await user.type(
      await screen.findByRole('textbox', { name: t('tasks.form.link') }),
      'https://x.sk',
    );
    await user.click(screen.getByRole('button', { name: t('tasks.panel.save') }));
    expect(await screen.findByText(t('tasks.form.errors.invalidLink'))).toBeInTheDocument();
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

  it('invalid_assignee on save shows the line and refetches people', async () => {
    patchReply = { status: 400, body: { error: 'invalid_assignee' } };
    const { user } = renderPanel();
    await user.type(await titleField(), '!');
    await waitFor(() => expect(calls('GET', '/api/groups/g1/people')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: t('tasks.panel.save') }));
    expect(await screen.findByText(t('tasks.form.errors.assigneeNotAllowed'))).toBeInTheDocument();
    await waitFor(() => expect(calls('GET', '/api/groups/g1/people')).toHaveLength(2));
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

  it("the bucket select looks like the app's fields, not a pill", async () => {
    renderPanel();
    await titleField();
    const select = screen.getByLabelText(t('tasks.panel.bucket'));
    expect(select).toHaveClass('appearance-none', 'rounded-md', 'border-2', 'border-input');
    expect(select).not.toHaveClass('rounded-full');
    expect(select.parentElement!.querySelector('svg')).not.toBeNull();
  });

  it('the done circle next to the title moves the task to the top of Completed', async () => {
    const { user } = renderPanel();
    await titleField();
    const panel = screen.getByRole('complementary', { name: t('tasks.panel.label') });
    await user.click(within(panel).getByRole('button', { name: t('tasks.card.markDone') }));
    await waitFor(() => expect(calls('POST', '/api/tasks/t1/move')).toHaveLength(1));
    const body = JSON.parse(
      (calls('POST', '/api/tasks/t1/move')[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({ bucketId: 'b-done', afterTaskId: null });
    expect(
      await within(panel).findByRole('button', { name: t('tasks.card.markNotDone') }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Task t1' })).toHaveClass('line-through');
    expect(
      within(panel).getByRole('button', { name: t('tasks.card.markNotDone') }),
    ).toHaveAccessibleDescription('Task t1');
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
    await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
    expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/tasks/t1');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.keepEditing') }));
    expect(screen.queryByText(t('tasks.panel.unsaved'))).toBeNull();
    await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
    await user.click(await screen.findByRole('button', { name: t('tasks.panel.discard') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('renders the source message block with a link into the chat', async () => {
    detail = {
      ...detail,
      sourceMessage: {
        id: 'm1',
        channelId: 'c1',
        taskId: null,
        authorName: 'Eva',
        excerpt: 'Please send the budget',
      },
    };
    renderPanel();
    expect(await screen.findByText(t('tasks.panel.fromMessage'))).toBeInTheDocument();
    expect(screen.getByText('Eva')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('tasks.panel.openMessage') })).toHaveAttribute(
      'href',
      chatMessageHref('g1', { messageId: 'm1', channelId: 'c1', taskId: null }),
    );
  });

  it('task panel shows the ticket line', async () => {
    detail = { ...detail, sourceTicket: { id: 'k1', number: 123, subject: 'Login fails' } };
    renderPanel();
    expect(await screen.findByText(t('tasks.panel.fromTicket'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#123 Login fails' })).toHaveAttribute(
      'href',
      '/tickets/k1',
    );
  });

  it('task panel shows the meeting line, opening the meeting in Knowledge', async () => {
    detail = { ...detail, sourceMeeting: { id: 'm9', title: 'Kickoff' } };
    renderPanel();
    expect(await screen.findByText(t('tasks.panel.fromMeeting'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kickoff' })).toHaveAttribute(
      'href',
      '/groups/g1/knowledge?k=m9',
    );
  });

  it('the source message link navigates in the app, so unsaved edits are asked about first', async () => {
    detail = {
      ...detail,
      sourceMessage: { id: 'm1', channelId: 'c1', taskId: null, authorName: 'Eva', excerpt: 'Hi' },
    };
    const { user, router } = renderPanel();
    await user.type(await titleField(), '!');
    await user.click(screen.getByRole('link', { name: t('tasks.panel.openMessage') }));
    expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/groups/g1/tasks/t1');
    await user.click(screen.getByRole('button', { name: t('tasks.panel.discard') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/chat'));
    expect(router.state.location.search).toEqual({ message: 'm1', c: 'c1' });
  });

  it("the source message of another task's chat links into that task's Chat tab", async () => {
    detail = {
      ...detail,
      sourceMessage: {
        id: 'm2',
        channelId: 'ch7',
        taskId: 't7',
        authorName: 'Eva',
        excerpt: 'Split this',
      },
    };
    renderPanel();
    expect(await screen.findByRole('link', { name: t('tasks.panel.openMessage') })).toHaveAttribute(
      'href',
      '/groups/g1/tasks/t7?tab=chat&message=m2&c=ch7',
    );
  });

  describe('tabs', () => {
    it('shows Details and Chat tabs; Chat mounts the conversation and marks the chat read', async () => {
      const { user, router } = renderPanel('/groups/g1/tasks/t1');
      await titleField();
      expect(tab(/Details/)).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByTestId('conversation')).toBeNull();
      expect(calls('GET', '/api/tasks/t1/chat')).toHaveLength(0);
      await user.click(tab(/Chat/));
      const conversation = await screen.findByTestId('conversation');
      expect(conversation).toHaveAttribute('data-channel', 'ch1');
      expect(conversation).toHaveAttribute('data-thread-mode', 'over');
      await waitFor(() => expect(markAllRead).toHaveBeenCalledWith('ch1'));
      expect(markAllRead).toHaveBeenCalledTimes(1);
      expect(tab(/Chat/)).toHaveAttribute('aria-selected', 'true');
      expect(router.state.location.search).toMatchObject({ tab: 'chat' });
      // The Details tab drops the param and keeps the others.
      await user.click(tab(/Details/));
      expect(router.state.location.search).toEqual({});
    });

    it('the tabs read "Details" and "Chat (N)" and move with the arrow keys', async () => {
      const { user } = renderPanel();
      await titleField();
      expect(tab(/Chat/)).toHaveAccessibleName(t('tasks.panel.tabs.chat', { count: 0 }));
      tab(/Details/).focus();
      await user.keyboard('{ArrowRight}');
      expect(tab(/Chat/)).toHaveFocus();
      expect(tab(/Chat/)).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{ArrowLeft}');
      expect(tab(/Details/)).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps unsaved Details edits across a tab switch and still asks on leaving', async () => {
      const { user } = renderPanel();
      await user.type(await titleField(), ' more');
      await user.click(tab(/Chat/));
      expect(await screen.findByTestId('conversation')).toBeInTheDocument();
      await user.click(tab(/Details/));
      expect(screen.getByLabelText(t('tasks.form.title'))).toHaveValue('Task t1 more');
      await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
      expect(await screen.findByText(t('tasks.panel.unsaved'))).toBeInTheDocument();
    });

    it('opens on the Chat tab at a linked message', async () => {
      const { router } = renderPanel('/groups/g1/tasks/t1?tab=chat&message=m9&c=ch1');
      expect(await screen.findByRole('tab', { name: /Chat/, selected: true })).toBeInTheDocument();
      expect(await screen.findByTestId('conversation')).toBeInTheDocument();
      expect(router.state.location.search).toMatchObject({ message: 'm9', c: 'ch1' });
    });

    it('a chat that cannot load says so and retries', async () => {
      const inner = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      let fail = true;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/api/tasks/t1/chat' && fail) return new Response(null, { status: 500 });
        return inner(url, init);
      });
      const { user } = renderPanel('/groups/g1/tasks/t1?tab=chat');
      expect(await screen.findByText(t('chat.loadError'))).toBeInTheDocument();
      expect(markAllRead).not.toHaveBeenCalled();
      fail = false;
      await user.click(screen.getByRole('button', { name: t('errors.retry') }));
      expect(await screen.findByTestId('conversation')).toBeInTheDocument();
    });

    it('a hidden page does not mark the chat read until it is shown', async () => {
      let state: DocumentVisibilityState = 'hidden';
      const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
      try {
        renderPanel('/groups/g1/tasks/t1?tab=chat');
        await screen.findByTestId('conversation');
        expect(markAllRead).not.toHaveBeenCalled();
        state = 'visible';
        act(() => void document.dispatchEvent(new Event('visibilitychange')));
        await waitFor(() => expect(markAllRead).toHaveBeenCalledWith('ch1'));
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('a task that is gone sends the user back to the board with the deleted notice', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const reply = (status: number, body?: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (url === '/api/me') return reply(200, me);
      if (url === '/api/groups/g1') return reply(200, GROUP);
      if (url === '/api/groups/g1/board')
        return reply(200, { buckets: BUCKETS, tasks: [], done: { total: 0, next: null } });
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
    await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
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
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });

  it('create mode shows the hint and no section', async () => {
    renderPanel(NEW);
    await titleField();
    expect(screen.getByText(t('reminders.task.createHint'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('reminders.row.add') })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reminders'))).toBe(false);
  });

  const linkField = () => screen.getByRole('textbox', { name: t('tasks.form.link') });
  const warning = () => screen.queryByText(t('tasks.form.linkEmptyWarning'));

  it('Create with an empty link warns once and focuses the field; the second Create saves', async () => {
    const { user, router } = renderPanel(NEW);
    await user.type(await titleField(), 'No link');
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(warning()).toBeInTheDocument();
    expect(linkField()).toHaveFocus();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);

    await user.click(createButton());
    await waitFor(() => expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(1));
    const body = JSON.parse(
      (calls('POST', '/api/groups/g1/tasks')[0]![1] as RequestInit).body as string,
    );
    expect(body.link).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
  });

  it('typing a link after the warning hides it for good and Create sends the link', async () => {
    const { user } = renderPanel(NEW);
    await user.type(await titleField(), 'Linked');
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(warning()).toBeInTheDocument();
    await user.type(linkField(), 'h');
    expect(warning()).toBeNull();
    await user.clear(linkField());
    expect(warning()).toBeNull(); // shown once only
    await user.type(linkField(), 'https://egrant.sk/projekt');
    await user.click(createButton());
    await waitFor(() => expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(1));
    const body = JSON.parse(
      (calls('POST', '/api/groups/g1/tasks')[0]![1] as RequestInit).body as string,
    );
    expect(body.link).toBe('https://egrant.sk/projekt');
  });

  it('an invalid link shows its error and posts nothing (no warning)', async () => {
    const { user } = renderPanel(NEW);
    await user.type(await titleField(), 'Bad link');
    await user.type(linkField(), 'ftp://files.example.com');
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());
    expect(await screen.findByText(t('tasks.form.errors.invalidLink'))).toBeInTheDocument();
    expect(warning()).toBeNull();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });

  it('Create posts the whole draft to the chosen bucket and returns to the board', async () => {
    const { user, router } = renderPanel(NEW);
    await user.type(await titleField(), 'Budget');
    await user.type(linkField(), 'https://egrant.sk/b');
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
      link: 'https://egrant.sk/b',
      bucketId: 'b-todo',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(await screen.findByRole('link', { name: /Budget/ })).toBeInTheDocument();
  });

  it('invalid_assignee on Create shows the line and refetches people', async () => {
    const answer = fetchMock.getMockImplementation() as (
      url: string,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/groups/g1/tasks' && init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'invalid_assignee' }), { status: 400 })
        : answer(url, init),
    );
    const { user } = renderPanel(NEW);
    await user.type(await titleField(), 'Budget');
    await user.type(linkField(), 'https://egrant.sk/b');
    await waitFor(() => expect(screen.getByLabelText(t('tasks.panel.bucket'))).toBeEnabled());
    await waitFor(() => expect(calls('GET', '/api/groups/g1/people')).toHaveLength(1));
    await user.click(createButton());
    expect(await screen.findByText(t('tasks.form.errors.assigneeNotAllowed'))).toBeInTheDocument();
    await waitFor(() => expect(calls('GET', '/api/groups/g1/people')).toHaveLength(2));
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
    await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(screen.queryByText(t('tasks.panel.unsaved'))).toBeNull();
    expect(calls('POST', '/api/groups/g1/tasks')).toHaveLength(0);
  });
});

describe('TaskPanel scroll lock', () => {
  let listeners: ((event: { matches: boolean }) => void)[];
  let query: { matches: boolean };
  const original = window.matchMedia;

  beforeEach(() => {
    listeners = [];
    query = { matches: true };
    window.matchMedia = vi.fn((text: string) =>
      // The signed-in frame's sidebar query (Phase 20) is not the panel's: keep it narrow and out
      // of the listener count.
      text === '(min-width: 1024px)'
        ? {
            matches: false,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }
        : {
            get matches() {
              return query.matches;
            },
            addEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
              listeners.push(fn),
            removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => {
              listeners = listeners.filter((l) => l !== fn);
            },
          },
    ) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    document.documentElement.style.overflow = '';
  });
  const change = (matches: boolean) =>
    act(() => {
      query.matches = matches;
      listeners.forEach((fn) => fn({ matches }));
    });

  it('locks the page while the panel covers it, follows the media query and restores on close', async () => {
    const { user, router } = renderPanel();
    await titleField();
    expect(document.documentElement.style.overflow).toBe('hidden');
    change(false); // wider than 1024 px: the board stays usable
    expect(document.documentElement.style.overflow).toBe('');
    change(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: t('forms.panel.close') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/tasks'));
    expect(document.documentElement.style.overflow).toBe('');
    expect(listeners).toHaveLength(0);
  });

  it('Save changes waits for an upload: disabled with a reason, enabled after', async () => {
    let finish!: (file: FileInfo) => void;
    vi.mocked(uploadFile).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { user } = renderPanel();
    await user.type(await titleField(), '!');
    await user.upload(screen.getByTestId('task-file-input'), new File(['x'], 'a.pdf'));
    const save = screen.getByRole('button', { name: t('tasks.panel.save') });
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAccessibleDescription(t('forms.files.waiting'));
    await act(async () => finish(UPLOADED));
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('Create task waits for an upload: disabled with a reason, enabled after', async () => {
    let finish!: (file: FileInfo) => void;
    vi.mocked(uploadFile).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { user } = renderPanel('/groups/g1/tasks/new');
    await user.type(await titleField(), 'New');
    await user.upload(screen.getByTestId('task-file-input'), new File(['x'], 'a.pdf'));
    const create = screen.getByRole('button', { name: t('tasks.panel.create') });
    await waitFor(() => expect(create).toBeDisabled());
    expect(create).toHaveAccessibleDescription(t('forms.files.waiting'));
    await act(async () => finish(UPLOADED));
    await waitFor(() => expect(create).toBeEnabled());
  });
});

const UPLOADED: FileInfo = {
  id: 'f1',
  name: 'a.pdf',
  mime: 'application/pdf',
  size: 1,
  width: null,
  height: null,
  hasPreview: false,
};
