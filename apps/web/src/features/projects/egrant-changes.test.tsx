import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { EgrantChangeList, ProjectDto } from '@spolu/shared';
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
const GROUP = { id: 'g1', name: 'Acme', egrantUrl: null, hasLogo: false, updatedAt: NOW };
const PROJECT: ProjectDto = {
  id: 'p1',
  groupId: 'g1',
  name: 'Kultúra 2026',
  color: 'blue',
  status: 'active',
  source: 'egrant',
  isTest: false,
  eventCount: 2,
  nextEvent: null,
  openTasks: 1,
  openTickets: 2,
  egrantChanges: 4,
  updatedAt: NOW,
  description: '',
  files: [],
  aliases: [],
  egrantProjectId: 'prj-208',
  createdBy: null,
  createdAt: NOW,
  archivedAt: null,
  linkedKnowledge: [],
};
const at = { sentAt: NOW, receivedAt: NOW };
const CHANGES: EgrantChangeList = {
  changes: [
    {
      id: 'c-name',
      kind: 'project_name',
      eventId: null,
      current: 'Kultúra 2026',
      incoming: 'Kultúra 2026 – nová',
      ...at,
    },
    {
      id: 'c-date',
      kind: 'event_date',
      eventId: 'e1',
      current: '2026-11-04',
      incoming: '2026-11-06',
      ...at,
    },
    {
      id: 'c-add',
      kind: 'event_add',
      eventId: null,
      current: null,
      incoming: { name: 'Workshop', occursOn: '2027-01-15', description: '' },
      ...at,
    },
    {
      id: 'c-remove',
      kind: 'event_remove',
      eventId: 'e2',
      current: { name: 'Kickoff', occursOn: '2026-10-10', description: '' },
      incoming: null,
      ...at,
    },
  ],
  maybeSame: [{ addId: 'c-add', removeId: 'c-remove' }],
};

function mockApi(review: (body: unknown) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const method = init?.method ?? 'GET';
    if (url === '/api/me') return reply(200, CLIENT);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url.startsWith('/api/groups/g1/projects?')) {
      return reply(200, { items: [], nextCursor: null });
    }
    if (url === '/api/groups/g1/projects/picker') {
      return reply(200, [
        { id: 'p1', name: 'Kultúra 2026', status: 'active', color: 'blue', isTest: false },
        { id: 'p2', name: 'Kultúra 2026 (2)', status: 'active', color: 'pink', isTest: false },
      ]);
    }
    if (url === '/api/projects/p1') return reply(200, PROJECT);
    if (url === '/api/projects/p1/events/picker') {
      return reply(200, [
        { id: 'e2', name: 'Kickoff', occursOn: '2026-10-10', source: 'egrant' },
        { id: 'e1', name: 'Hodnotenie', occursOn: '2026-11-04', source: 'egrant' },
      ]);
    }
    if (url === '/api/projects/p1/egrant-changes' && method === 'GET') return reply(200, CHANGES);
    if (url === '/api/projects/p1/egrant-changes') return review(JSON.parse(String(init?.body)));
    if (url === '/api/projects/p1/merge') return reply(200, { ...PROJECT, id: 'p2' });
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const ok = () => new Response(JSON.stringify({ ...PROJECT, egrantChanges: 0 }), { status: 200 });

describe('changes from eGrant in the project sheet (Phase 33 part P3)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('`?project=` opens the sheet on the review; each row is accepted or dismissed in one save', async () => {
    const fetchMock = mockApi(ok);
    renderAt('/groups/g1/overview?sheet=p1');
    const sheet = await screen.findByTestId('project-sheet', {}, { timeout: 5000 });
    const section = await within(sheet).findByRole('region', {
      name: t('projects.egrant.title', { count: 4 }),
    });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Kultúra 2026 – nová');
    expect(rows[1]).toHaveTextContent(
      t('projects.egrant.kinds.eventDate', { event: 'Hodnotenie' }),
    );
    expect(rows[2]).toHaveTextContent(t('projects.egrant.kinds.eventAdd'));
    // An addition and a removal side by side: "Maybe the same event".
    expect(rows[2]).toHaveTextContent(/Kickoff/);
    // The affected events carry a mark in the list.
    expect(within(sheet).getAllByText(t('projects.egrant.eventMark'))).toHaveLength(2);

    const user = userEvent.setup();
    const save = within(section).getByRole('button', { name: t('projects.egrant.save') });
    expect(save).toBeDisabled();
    await user.click(within(rows[0]!).getByRole('button', { name: t('projects.egrant.accept') }));
    await user.click(within(rows[2]!).getByRole('button', { name: t('projects.egrant.dismiss') }));
    await user.click(save);
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/projects/p1/egrant-changes' && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ accept: ['c-name'], dismiss: ['c-add'] });
  });

  it('accepting a removal asks first; a change outdated meanwhile says so', async () => {
    const fetchMock = mockApi(
      () => new Response(JSON.stringify({ error: 'change_outdated' }), { status: 409 }),
    );
    renderAt('/groups/g1/overview?sheet=p1');
    const sheet = await screen.findByTestId('project-sheet', {}, { timeout: 5000 });
    const section = await within(sheet).findByRole('region', {
      name: t('projects.egrant.title', { count: 4 }),
    });
    const user = userEvent.setup();
    const remove = within(section).getAllByRole('listitem')[3]!;
    await user.click(within(remove).getByRole('button', { name: t('projects.egrant.accept') }));
    await user.click(within(section).getByRole('button', { name: t('projects.egrant.save') }));
    expect(within(section).getByText(t('projects.egrant.confirmRemove'))).toBeVisible();
    // Nothing is saved yet (the tab's own reads and marks may post elsewhere).
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/projects/p1/egrant-changes' && init?.method === 'POST',
      ),
    ).toBe(false);
    await user.click(within(section).getByRole('button', { name: t('projects.egrant.save') }));
    expect(await within(section).findByText(t('projects.egrant.outdated'))).toBeVisible();
  });

  it('merge picks another project of the client and posts it', async () => {
    const fetchMock = mockApi(ok);
    renderAt('/groups/g1/overview?sheet=p1');
    const sheet = await screen.findByTestId('project-sheet', {}, { timeout: 5000 });
    const user = userEvent.setup();
    await user.click(
      await within(sheet).findByRole('button', { name: t('projects.sheet.actions') }),
    );
    await user.click(await screen.findByRole('menuitem', { name: t('projects.merge.action') }));
    const select = await within(sheet).findByRole('combobox');
    expect(within(select).queryByText('Kultúra 2026')).toBeNull();
    await user.selectOptions(select, 'p2');
    expect(within(sheet).getByText(/Kultúra 2026 \(2\)/, { selector: 'p' })).toBeVisible();
    await user.click(within(sheet).getByRole('button', { name: t('projects.merge.submit') }));
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/projects/p1/merge')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ into: 'p2' });
  });
});
