import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type {
  ActiveCards,
  EventItemsPage,
  ProjectEventDto,
  TimelineEventDto,
  TimelineResponse,
} from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { formatEventDate, formatShortDate } from './project-dot';
import { daysBetween, gapOf, mergeEvents, todayIndex, whenOf } from './timeline-model';

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
const TODAY = '2026-10-17';
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
const PROJECT = { id: 'p1', name: 'Kultúra 2026', color: 'blue' as const };

function event(id: string, occursOn: string, extra: Partial<TimelineEventDto> = {}) {
  return {
    id,
    name: `Event ${id}`,
    occursOn,
    project: PROJECT,
    fromEgrant: false,
    files: 0,
    openTasks: [],
    openTaskCount: 0,
    openTickets: [],
    openTicketCount: 0,
    doneCount: 0,
    ...extra,
  } satisfies TimelineEventDto;
}

const NO_CARDS: ActiveCards = {
  tickets: { rows: [], total: 0, mine: 0 },
  tasks: { rows: [], total: 0, mine: 0, urgent: 0 },
};

type Pages = Record<string, TimelineResponse>;

function mockApi(pages: Pages, opts: { cards?: ActiveCards; items?: EventItemsPage } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, CLIENT);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url === '/api/groups/g1/projects/picker') {
      return reply(200, [{ ...PROJECT, status: 'active' }]);
    }
    if (url.startsWith('/api/groups/g1/projects?')) {
      return reply(200, { items: [], nextCursor: null });
    }
    if (url.startsWith('/api/groups/g1/timeline')) {
      const query = url.split('?')[1] ?? '';
      const page = pages[query];
      return page ? reply(200, page) : reply(404, { error: 'not_found' });
    }
    if (url === '/api/groups/g1/overview/active') return reply(200, opts.cards ?? NO_CARDS);
    if (url.startsWith('/api/project-events/') && url.includes('/items')) {
      return reply(200, opts.items ?? { tasks: [], tickets: [], nextCursor: null });
    }
    if (url.startsWith('/api/project-events/')) {
      const id = url.split('/')[3]!;
      const dto: ProjectEventDto = {
        id,
        projectId: 'p1',
        groupId: 'g1',
        project: PROJECT,
        name: `Event ${id}`,
        description: 'Popis udalosti',
        occursOn: TODAY,
        source: 'manual',
        files: [],
        createdBy: null,
        createdAt: NOW,
        updatedAt: NOW,
        linkedKnowledge: [],
      };
      return reply(200, dto);
    }
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderOverview(path = '/groups/g1/overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** The strip's items in order: event names, and "TODAY" for the marker. */
async function stripItems() {
  const list = await screen.findByRole(
    'list',
    { name: t('projects.timeline.listLabel') },
    {
      timeout: 5000,
    },
  );
  return [...list.children].map((li) =>
    li.hasAttribute('data-today') ? 'TODAY' : (li.querySelector('h3')?.textContent ?? ''),
  );
}

describe('the timeline model', () => {
  it('places Today before the first event from today on, or at the end', () => {
    const events = [event('a', '2026-10-01'), event('b', TODAY), event('c', '2026-11-01')];
    expect(todayIndex(events, TODAY)).toBe(1);
    expect(todayIndex(events.slice(0, 1), TODAY)).toBe(1);
    expect(todayIndex(events.slice(2), TODAY)).toBe(0);
    expect(todayIndex([], TODAY)).toBe(0);
    expect(whenOf('2026-10-01', TODAY)).toBe('past');
    expect(whenOf(TODAY, TODAY)).toBe('today');
    expect(whenOf('2026-11-01', TODAY)).toBe('coming');
  });

  it('marks gaps over 60 days in months, and years from two', () => {
    expect(gapOf(daysBetween('2026-01-01', '2026-03-02'))).toBeNull();
    expect(gapOf(61)).toEqual({ unit: 'months', count: 2 });
    expect(gapOf(daysBetween('2026-01-01', '2026-05-01'))).toEqual({ unit: 'months', count: 4 });
    expect(gapOf(800)).toEqual({ unit: 'years', count: 2 });
  });

  it('shortens a deadline to day and month, with the year only when it is not this one', () => {
    expect(formatShortDate('2026-09-10', 'en', TODAY)).toBe('Sep 10');
    expect(formatShortDate('2027-09-10', 'en', TODAY)).toBe('Sep 10, 2027');
  });

  it('merges pages, each event once', () => {
    const a = event('a', TODAY);
    expect(mergeEvents([[a], undefined, [a, event('b', TODAY)]]).map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('the timeline card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('puts Today between the last past and the first coming event, with gap marks', async () => {
    mockApi({
      '': {
        events: [event('1', '2026-03-01'), event('2', '2026-10-01'), event('3', '2026-12-20')],
        before: null,
        after: null,
        today: TODAY,
      },
    });
    renderOverview();
    expect(await stripItems()).toEqual(['Event 1', 'Event 2', 'TODAY', 'Event 3']);
    // 2026-03-01 → 2026-10-01 is 7 months; 2026-10-01 → 2026-12-20 is 80 days, 3 months
    expect(screen.getByText(t('projects.timeline.gap.months', { count: 7 }))).toBeVisible();
    expect(screen.getByText(t('projects.timeline.gap.months', { count: 3 }))).toBeVisible();
    expect(
      screen.getByText(
        t('projects.timeline.todayAt', { date: formatEventDate(TODAY, i18n.language) }),
      ),
    ).toBeTruthy();
  });

  it('puts Today first with no past events, last with no coming ones', async () => {
    mockApi({
      '': {
        events: [event('1', TODAY), event('2', '2026-10-20')],
        before: null,
        after: null,
        today: TODAY,
      },
    });
    renderOverview();
    expect(await stripItems()).toEqual(['TODAY', 'Event 1', 'Event 2']);
  });

  it('puts Today last when every event is past', async () => {
    mockApi({
      '': { events: [event('1', '2026-10-01')], before: null, after: null, today: TODAY },
    });
    renderOverview();
    expect(await stripItems()).toEqual(['Event 1', 'TODAY']);
  });

  it('loads Earlier and Later pages at the ends', async () => {
    const fetchMock = mockApi({
      '': {
        events: [event('2', '2026-10-01'), event('3', '2026-10-20')],
        before: 'B',
        after: 'A',
        today: TODAY,
      },
      'before=B': { events: [event('1', '2026-09-01')], before: null, after: null, today: TODAY },
      'after=A': { events: [event('4', '2026-11-01')], before: null, after: null, today: TODAY },
    });
    renderOverview();
    const user = userEvent.setup();
    expect(await stripItems()).toEqual(['Event 2', 'TODAY', 'Event 3']);
    await user.click(screen.getByRole('button', { name: t('projects.timeline.earlier') }));
    await waitFor(async () =>
      expect(await stripItems()).toEqual(['Event 1', 'Event 2', 'TODAY', 'Event 3']),
    );
    expect(screen.queryByRole('button', { name: t('projects.timeline.earlier') })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('projects.timeline.later') }));
    await waitFor(async () =>
      expect(await stripItems()).toEqual(['Event 1', 'Event 2', 'TODAY', 'Event 3', 'Event 4']),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/groups/g1/timeline?before=B');
  });

  it('moves between events with the arrow keys', async () => {
    mockApi({
      '': {
        events: [event('1', '2026-10-01'), event('2', '2026-10-20')],
        before: null,
        after: null,
        today: TODAY,
      },
    });
    renderOverview();
    const user = userEvent.setup();
    await stripItems();
    const first = screen.getByRole('button', { name: 'Event 1' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Event 2' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(first).toHaveFocus();
  });

  it('lists an event’s rows, expands the done pile and opens the event sheet', async () => {
    const busy = event('1', TODAY, {
      openTasks: [
        {
          id: 't1',
          title: 'Rozpočet',
          dueDate: '2026-10-01',
          urgent: false,
          completedAt: null,
          assignees: [],
        },
      ],
      openTaskCount: 1,
      openTickets: [{ id: 'k1', number: 812, subject: 'Otázka', status: 'new' }],
      openTicketCount: 1,
      doneCount: 2,
    });
    mockApi(
      { '': { events: [busy], before: null, after: null, today: TODAY } },
      {
        items: {
          tasks: [
            {
              id: 't9',
              title: 'Hotová úloha',
              dueDate: null,
              urgent: false,
              completedAt: NOW,
              assignees: [],
            },
          ],
          tickets: [{ id: 'k9', number: 900, subject: 'Vyriešené', status: 'resolved' }],
          nextCursor: null,
        },
      },
    );
    renderOverview();
    const user = userEvent.setup();
    await stripItems();
    expect(screen.getByRole('link', { name: /Rozpočet/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /#812/ })).toBeVisible();
    const pile = screen.getByRole('button', { name: t('projects.timeline.done', { count: 2 }) });
    expect(pile).toHaveAttribute('aria-expanded', 'false');
    await user.click(pile);
    expect(await screen.findByRole('link', { name: /Hotová úloha/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /#900/ })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Event 1' }));
    const sheet = await screen.findByTestId('event-sheet');
    expect(await within(sheet).findByText('Popis udalosti')).toBeVisible();
    expect(within(sheet).getByText(PROJECT.name)).toBeVisible();
  });

  it('"Show all" links to the Tasks tab filtered by the event, or to Tickets', async () => {
    const task = {
      id: 't1',
      title: 'Rozpočet',
      dueDate: null,
      urgent: false,
      completedAt: null,
      assignees: [],
    };
    const ticket = { id: 'k1', number: 812, subject: 'Otázka', status: 'new' as const };
    const tasks = event('e1', TODAY, { openTasks: [task], openTaskCount: 7 });
    const tickets = event('e2', '2026-10-20', { openTickets: [ticket], openTicketCount: 6 });
    mockApi({ '': { events: [tasks, tickets], before: null, after: null, today: TODAY } });
    renderOverview();
    await stripItems();
    expect(
      screen.getByRole('link', { name: t('projects.timeline.showAll', { count: 7 }) }),
    ).toHaveAttribute('href', '/groups/g1/tasks?project=p1&event=e1');
    expect(
      screen.getByRole('link', { name: t('projects.timeline.showAll', { count: 6 }) }),
    ).toHaveAttribute('href', '/groups/g1/tickets?project=p1&event=e2');
  });

  it('a task row opens the task panel over the overview', async () => {
    const busy = event('1', TODAY, {
      openTasks: [
        {
          id: 't1',
          title: 'Rozpočet',
          dueDate: null,
          urgent: true,
          completedAt: null,
          assignees: [],
        },
      ],
      openTaskCount: 1,
    });
    mockApi({ '': { events: [busy], before: null, after: null, today: TODAY } });
    const router = renderOverview();
    const user = userEvent.setup();
    await stripItems();
    await user.click(screen.getByRole('link', { name: /Rozpočet/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ task: 't1' }));
  });

  it('a task on the strip: a red dot for urgent, the title clipped, the short deadline', async () => {
    const busy = event('1', TODAY, {
      openTasks: [
        {
          id: 't1',
          title: 'Pripraviť formulár výzvy 2',
          dueDate: '2026-10-27',
          urgent: true,
          completedAt: null,
          assignees: [],
        },
      ],
      openTaskCount: 1,
    });
    mockApi({ '': { events: [busy], before: null, after: null, today: TODAY } });
    renderOverview();
    await stripItems();
    const row = screen.getByRole('link', { name: /Pripraviť formulár výzvy 2/ });
    // "Urgent" is for screen readers only; the eye sees the dot.
    expect(row).toHaveAccessibleName(
      new RegExp(`^${t('projects.cards.urgent')}:\\s*Pripraviť formulár výzvy 2`),
    );
    expect(within(row).getByText('Pripraviť formulár výzvy 2', { exact: false })).toHaveClass(
      'line-clamp-2',
    );
    expect(
      within(row).getByText(formatShortDate('2026-10-27', i18n.language, TODAY)),
    ).toBeVisible();
  });

  it('shows the empty state of a client without projects', async () => {
    mockApi({ '': { events: [], before: null, after: null, today: TODAY } });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      const reply = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status });
      if (url === '/api/me') return reply(200, CLIENT);
      if (url === '/api/groups/g1') return reply(200, GROUP);
      if (url === '/api/groups/g1/projects/picker') return reply(200, []);
      if (url.startsWith('/api/groups/g1/projects?'))
        return reply(200, { items: [], nextCursor: null });
      if (url.startsWith('/api/groups/g1/timeline')) {
        return reply(200, { events: [], before: null, after: null, today: TODAY });
      }
      if (url === '/api/groups/g1/overview/active') return reply(200, NO_CARDS);
      return reply(404, { error: 'not_found' });
    });
    renderOverview();
    expect(
      await screen.findByText(t('projects.timeline.noProjects'), {}, { timeout: 5000 }),
    ).toBeVisible();
  });
});

describe('the active cards', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists my rows first as the server sent them, with the totals and Open all', async () => {
    mockApi(
      { '': { events: [], before: null, after: null, today: TODAY } },
      {
        cards: {
          tickets: {
            total: 2,
            mine: 1,
            rows: [
              {
                id: 'k1',
                number: 5,
                subject: 'Moja otázka',
                status: 'in_progress',
                createdAt: NOW,
                mine: true,
                project: PROJECT,
                event: null,
              },
              {
                id: 'k2',
                number: 4,
                subject: 'Iná',
                status: 'new',
                createdAt: NOW,
                mine: false,
                project: null,
                event: null,
              },
            ],
          },
          tasks: {
            total: 1,
            mine: 0,
            urgent: 1,
            rows: [
              {
                id: 't1',
                title: 'Urgentná',
                dueDate: null,
                urgent: true,
                assignees: [{ id: 'u1', name: 'Ad Min' }],
                mine: false,
                project: null,
                event: null,
              },
            ],
          },
        },
      },
    );
    renderOverview();
    const tickets = await screen.findByRole(
      'region',
      { name: t('projects.cards.tickets') },
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(
        within(tickets)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual([
        t('projects.cards.openAll'),
        expect.stringContaining('Moja otázka'),
        expect.stringContaining('Iná'),
      ]),
    );
    expect(tickets).toHaveTextContent(t('projects.cards.ticketsActive', { count: 2 }));
    expect(tickets).toHaveTextContent(t('projects.cards.mine', { count: 1 }));
    expect(within(tickets).getByText(PROJECT.name)).toBeVisible();
    const tasks = screen.getByRole('region', { name: t('projects.cards.tasks') });
    expect(tasks).toHaveTextContent(t('projects.cards.urgentCount', { count: 1 }));
    expect(within(tasks).getByRole('link', { name: /Urgentná/ })).toBeVisible();
  });
});
