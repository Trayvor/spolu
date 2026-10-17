import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { ProjectDto, ProjectListItem } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const NOW = '2026-10-17T10:00:00.000Z';
const CLIENT = {
  id: 'c1',
  name: 'Klára',
  email: 'k@x.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Acme', role: 'client', hasLogo: false, updatedAt: NOW }],
};
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: NOW,
};
const ROW: ProjectListItem = {
  id: 'p1',
  groupId: 'g1',
  name: 'Kultúra 2026',
  color: 'blue',
  status: 'active',
  source: 'egrant',
  eventCount: 2,
  nextEvent: { id: 'e2', name: 'Hodnotenie', occursOn: '2099-11-04' },
  openTasks: 3,
  openTickets: 0,
  egrantChanges: 0,
  updatedAt: NOW,
};
const PROJECT: ProjectDto = {
  ...ROW,
  description: 'Výzva na kultúru',
  files: [],
  aliases: [],
  egrantProjectId: 'prj-208',
  createdBy: null,
  createdAt: NOW,
  archivedAt: null,
};

function mockApi(page: { items: ProjectListItem[]; nextCursor: string | null }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const method = init?.method ?? 'GET';
    if (url === '/api/me') return reply(200, CLIENT);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url === '/api/groups/g1/projects' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { name: string };
      if (body.name === 'Šport') {
        return reply(409, { error: 'project_name_taken', name: 'Šport 2026' });
      }
      return reply(201, { ...PROJECT, name: body.name });
    }
    if (url.startsWith('/api/groups/g1/projects?status=active')) return reply(200, page);
    if (url.startsWith('/api/groups/g1/projects?status=archived')) {
      return reply(200, { items: [], nextCursor: null });
    }
    if (url === '/api/projects/p1') return reply(200, PROJECT);
    if (url === '/api/projects/p1/events/picker') {
      return reply(200, [
        { id: 'e1', name: 'Kickoff', occursOn: '2026-03-12', source: 'egrant' },
        { id: 'e2', name: 'Hodnotenie', occursOn: '2099-11-04', source: 'manual' },
      ]);
    }
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderOverview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: ['/groups/g1/overview'] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('the Prehľad tab', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is the first tab pill and lists the projects with their facts', async () => {
    mockApi({ items: [ROW], nextCursor: null });
    renderOverview();
    const row = await screen.findByRole('button', { name: /Kultúra 2026/ }, { timeout: 5000 });
    const tabs = screen.getByRole('navigation', { name: t('group.tabs.label') });
    expect(within(tabs).getAllByRole('link')[0]).toHaveTextContent(t('group.tabs.overview'));
    expect(row).toHaveTextContent(t('projects.fromEgrant'));
    expect(row).toHaveTextContent(t('projects.card.events', { count: 2 }));
    expect(row).toHaveTextContent(t('projects.card.openTasks', { count: 3 }));
    // No open tickets: the fact is left out.
    expect(row).not.toHaveTextContent(t('projects.card.openTickets', { count: 0 }));
  });

  it('shows the empty state, and the archived list on its pill', async () => {
    mockApi({ items: [], nextCursor: null });
    renderOverview();
    expect(await screen.findByText(t('projects.card.empty'), {}, { timeout: 5000 })).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: t('projects.card.archived') }));
    expect(await screen.findByText(t('projects.card.emptyArchived'))).toBeVisible();
  });

  it('the project dialog checks the name and shows a taken name', async () => {
    const fetchMock = mockApi({ items: [], nextCursor: null });
    renderOverview();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: t('projects.card.new') }, { timeout: 5000 }),
    );
    const dialog = await screen.findByTestId('project-dialog');
    const create = within(dialog).getByRole('button', { name: t('projects.dialogs.create') });
    await user.click(create);
    expect(within(dialog).getByText(t('projects.dialogs.errors.nameRequired'))).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await user.type(within(dialog).getByLabelText(t('projects.dialogs.name')), 'Šport');
    await user.click(create);
    expect(
      await within(dialog).findByText(
        t('projects.dialogs.errors.nameTaken', { name: 'Šport 2026' }),
      ),
    ).toBeVisible();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      name: 'Šport',
      description: '',
      fileIds: [],
    });
  });

  it('a row opens the project sheet with its events by date', async () => {
    mockApi({ items: [ROW], nextCursor: null });
    renderOverview();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Kultúra 2026/ }, { timeout: 5000 }),
    );
    const sheet = await screen.findByTestId('project-sheet');
    expect(await within(sheet).findByText('Výzva na kultúru')).toBeVisible();
    await waitFor(() =>
      expect(
        within(sheet)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([expect.stringContaining('Kickoff'), expect.stringContaining('Hodnotenie')]),
    );
    expect(within(sheet).getByRole('button', { name: t('projects.sheet.addEvent') })).toBeVisible();
  });
});
