import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { KnowledgeSummary } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import type { KnowledgeDialogTarget } from './knowledge-dialog';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));

// The dialog is tested in knowledge-dialog.test.tsx; here it shows its target and its callbacks.
vi.mock('./knowledge-dialog', () => ({
  KnowledgeDialog: ({
    target,
    onClose,
    onUnavailable,
  }: {
    target: KnowledgeDialogTarget;
    onClose: (createdId?: string) => void;
    onUnavailable: () => void;
  }) => (
    <div role="dialog" aria-label="knowledge-dialog">
      <p>{target.mode === 'view' ? `view:${target.id}` : `create:${target.type}`}</p>
      <button onClick={() => onClose()}>dialog-close</button>
      <button onClick={() => onClose('k9')}>dialog-created</button>
      <button onClick={onUnavailable}>dialog-unavailable</button>
    </div>
  ),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'admin', groupId: null };
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  inviteUrl: 'https://spolu.test/join/x',
};

function summary(id: string, overrides: Partial<KnowledgeSummary> = {}): KnowledgeSummary {
  return {
    id,
    groupId: 'g1',
    type: 'note',
    visibility: 'public',
    title: `Item ${id}`,
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 0,
    lastReminderAt: null,
    createdBy: { id: 'u1', name: 'Anna' },
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

function mockApi(items: KnowledgeSummary[] = [summary('k1')]) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url.startsWith('/api/groups/g1/knowledge')) return reply(200, { items, nextCursor: null });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTab(path = '/groups/g1/knowledge') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const search = () => router.state.location.search as Record<string, unknown>;
  return { router, search, user: userEvent.setup() };
}

const heading = () => screen.findByRole('heading', { name: t('knowledge.tab.title') });

describe('knowledge tab', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width: 641px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the tab pill sits between Tasks and Members', async () => {
    mockApi();
    renderTab();
    const nav = await screen.findByRole('navigation', { name: t('group.tabs.label') });
    await heading();
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual([
      t('group.tabs.chat'),
      t('group.tabs.tasks'),
      t('group.tabs.knowledge'),
      t('group.tabs.members'),
    ]);
    expect(within(nav).getByRole('link', { name: t('group.tabs.knowledge') })).toHaveAttribute(
      'href',
      '/groups/g1/knowledge',
    );
  });

  it('type pill writes ?type', async () => {
    const fetchMock = mockApi();
    const { search, user } = renderTab();
    await heading();
    const pills = screen.getByRole('group', { name: t('knowledge.tab.filters') });
    expect(within(pills).getByRole('button', { name: t('knowledge.types.all') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(pills).getByRole('button', { name: t('knowledge.types.links') }));
    await waitFor(() => expect(search().type).toBe('link'));
    expect(within(pills).getByRole('button', { name: t('knowledge.types.links') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/knowledge?type=link')).toBe(
        true,
      ),
    );
    await user.click(within(pills).getByRole('button', { name: t('knowledge.types.all') }));
    await waitFor(() => expect(search().type).toBeUndefined());
  });

  it('search writes ?q after 300 ms and only from 2 characters', async () => {
    mockApi();
    const { search } = renderTab();
    await heading();
    const box = screen.getByRole('searchbox', { name: t('knowledge.tab.search') });
    fireEvent.change(box, { target: { value: 'b' } });
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(search().q).toBeUndefined();
    fireEvent.change(box, { target: { value: 'bu' } });
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(search().q).toBeUndefined();
    await waitFor(() => expect(search().q).toBe('bu'));
    fireEvent.change(box, { target: { value: '' } });
    await waitFor(() => expect(search().q).toBeUndefined());
  });

  it('New → Reminder opens the create dialog with ?k=new&kind=reminder', async () => {
    mockApi();
    const { search, user } = renderTab();
    await heading();
    await user.click(screen.getByRole('button', { name: t('knowledge.tab.new') }));
    await user.click(await screen.findByRole('menuitem', { name: /Reminder/ }));
    await waitFor(() => expect(search()).toMatchObject({ k: 'new', kind: 'reminder' }));
    expect(await screen.findByText('create:reminder')).toBeInTheDocument();
    // After Create the new item opens.
    await user.click(screen.getByRole('button', { name: 'dialog-created' }));
    await waitFor(() => expect(search().k).toBe('k9'));
    expect(search().kind).toBeUndefined();
  });

  it('?k=<id> opens the detail and Close removes k', async () => {
    mockApi();
    const { search, user } = renderTab('/groups/g1/knowledge?type=note&k=k1');
    expect(await screen.findByText('view:k1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'dialog-close' }));
    await waitFor(() => expect(search().k).toBeUndefined());
    expect(search().type).toBe('note');
    expect(screen.queryByText('view:k1')).not.toBeInTheDocument();
  });

  it('an unavailable item closes with the notice', async () => {
    mockApi();
    const { search, user } = renderTab('/groups/g1/knowledge?k=gone');
    await user.click(await screen.findByRole('button', { name: 'dialog-unavailable' }));
    await waitFor(() => expect(search().k).toBeUndefined());
    expect(screen.getByRole('status')).toHaveTextContent(t('knowledge.detail.unavailable'));
  });

  it('empty and no-match states', async () => {
    mockApi([]);
    const { router } = renderTab();
    expect(await screen.findByText(t('knowledge.tab.empty'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t('knowledge.tab.new') })).toHaveLength(2);
    await act(() =>
      router.navigate({
        to: '/groups/$groupId/knowledge',
        params: { groupId: 'g1' },
        search: { q: 'budget', type: 'file' },
      }),
    );
    expect(
      await screen.findByText(t('knowledge.tab.noMatch', { q: 'budget' })),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('knowledge.tab.clearFilters') })).toBeVisible();
  });

  it('Clear filters removes type and q', async () => {
    mockApi([]);
    const { search, user } = renderTab('/groups/g1/knowledge?q=budget&type=file');
    await user.click(await screen.findByRole('button', { name: t('knowledge.tab.clearFilters') }));
    await waitFor(() => expect(search()).toEqual({}));
    expect(await screen.findByText(t('knowledge.tab.empty'))).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: t('knowledge.tab.search') })).toHaveValue('');
  });
});
