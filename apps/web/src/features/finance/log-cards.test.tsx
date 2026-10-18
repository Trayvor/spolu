import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { FinanceOverviewDto, Me, RatesDto } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { setLanguage } from '@/i18n';
import { OverviewCard } from './overview-card';
import { RatesDialog } from './rates-dialog';
import { logEntry, logMonth, logPage } from './test-data';
import { WorkLogCard } from './work-log-card';

const view = { kind: 'group', groupId: 'g1' } as const;

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

/** `fetch` answering by URL; records every call. */
function serve(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: input,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      const answer = handler(input, init) ?? { status: 404, body: { error: 'not_found' } };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function renderIn(ui: ReactNode) {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const ticket = createRoute({ getParentRoute: () => root, path: '/tickets/$ticketId' });
  const router = createRouter({
    routeTree: root.addChildren([task, ticket]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQuery.queryKey, {
    id: 'a1',
    name: 'Fin',
    email: 'fin@example.com',
    role: 'admin',
    finance: true,
    groups: [],
  } as Me);
  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    user: userEvent.setup(),
  };
}

function overviewDto(over: Partial<FinanceOverviewDto> = {}): FinanceOverviewDto {
  return {
    from: '2026-09',
    to: '2026-11',
    months: ['2026-09', '2026-10', '2026-11'],
    organisation: false,
    expenses: [],
    money: [
      {
        currency: 'EUR',
        paid: 1_200_000,
        toBePaid: 300_000,
        byMonth: [
          { month: '2026-09', paid: 1_200_000, toBePaid: 0 },
          { month: '2026-11', paid: 0, toBePaid: 300_000 },
        ],
      },
    ],
    cost: { total: 160_000, byMonth: [{ month: '2026-10', amount: 160_000 }] },
    hours: {
      minutes: 2400,
      taskCount: 3,
      ticketCount: 1,
      missingRateMinutes: 90,
      byAdmin: [
        {
          userId: 'u1',
          name: 'Eva',
          minutes: 1500,
          taskCount: 2,
          ticketCount: 1,
          cost: 100_000,
          missingRateMinutes: 0,
          byMonth: [{ month: '2026-10', minutes: 1500 }],
        },
        {
          userId: 'u2',
          name: 'Ján',
          minutes: 900,
          taskCount: 1,
          ticketCount: 0,
          cost: 60_000,
          missingRateMinutes: 90,
          byMonth: [{ month: '2026-10', minutes: 900 }],
        },
      ],
    },
    ...over,
  };
}

describe('finance part C cards', () => {
  beforeEach(async () => {
    await setLanguage('en');
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('OverviewCard', () => {
    it('shows the money totals and balance, the table fallback, then one chart per admin', async () => {
      const calls = serve((url) =>
        url.includes('/overview') ? { body: overviewDto() } : undefined,
      );
      const { user } = renderIn(<OverviewCard view={view} />);
      expect(await screen.findByText('€12,000')).toBeInTheDocument();
      expect(screen.getByText('€3,000')).toBeInTheDocument();
      expect(screen.getByText('€1,600')).toBeInTheDocument();
      // Balance: paid 12 000 − spent 1 600.
      expect(screen.getByText('€10,400')).toHaveClass('text-success');
      expect(
        screen.getByRole('button', { name: '1 h 30 min without an hourly rate' }),
      ).toBeInTheDocument();
      // The default period: the last 12 and the next 12 months.
      expect(calls.find((c) => c.url.includes('/finance/'))!.url).toMatch(
        /\/api\/groups\/g1\/finance\/overview\?from=\d{4}-\d{2}&to=\d{4}-\d{2}$/,
      );

      await user.click(screen.getByRole('button', { name: 'Show as table' }));
      const table = screen.getByRole('table');
      expect(within(table).getByRole('rowheader', { name: 'September 2026' })).toBeInTheDocument();
      expect(within(table).getAllByRole('row')).toHaveLength(4); // header + Sep, Oct, Nov

      await user.click(screen.getByRole('radio', { name: 'Hours' }));
      expect(screen.getByText('Eva')).toBeInTheDocument();
      expect(screen.getByText('Ján')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Hours of Eva by month' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Hours of Ján by month' })).toBeInTheDocument();
    });

    it('says so when the period is empty, and offers a retry on an error', async () => {
      let fail = true;
      serve((url) => {
        if (!url.includes('/overview')) return undefined;
        if (fail) return { status: 500, body: { error: 'internal' } };
        return {
          body: overviewDto({
            money: [],
            cost: { total: 0, byMonth: [] },
            hours: { minutes: 0, taskCount: 0, ticketCount: 0, missingRateMinutes: 0, byAdmin: [] },
          }),
        };
      });
      const { user } = renderIn(<OverviewCard view={view} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The numbers could not be loaded.',
      );
      fail = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByText('No contracts and no logged time in this period.'),
      ).toBeInTheDocument();
    });
  });

  describe('WorkLogCard', () => {
    it('shows the summary, months oldest at the top, and loads the earlier page above', async () => {
      const newest = logPage({
        entries: [
          logEntry({
            id: 'n2',
            workedOn: '2026-10-02',
            userName: 'Eva',
            note: 'Call with the client',
          }),
          logEntry({
            id: 'n1',
            workedOn: '2026-10-01',
            userName: 'Ján',
            minutes: null,
            cost: null,
            source: 'task',
            title: 'Fix the budget',
            taskId: 't1',
          }),
        ],
        months: [logMonth('2026-10', 60)],
        summary: {
          minutes: 60,
          taskCount: 1,
          ticketCount: 0,
          cost: 4000,
          missingRateMinutes: 0,
          byAdmin: [],
        },
        before: 'older',
      });
      const older = logPage({
        entries: [
          logEntry({ id: 'o1', workedOn: '2026-09-15', userName: 'Eva', note: 'September work' }),
        ],
        months: [logMonth('2026-09', 60)],
      });
      const calls = serve((url) =>
        url.includes('/work-log')
          ? { body: url.includes('before=older') ? older : newest }
          : undefined,
      );
      const { user } = renderIn(<WorkLogCard view={view} />);
      const summary = await screen.findByTestId('work-log-summary');
      expect(summary).toHaveTextContent('1 h · 1 task · €40');
      const rows = () => screen.getAllByTestId('work-log-entry').map((r) => r.textContent);
      expect(rows()).toEqual([
        expect.stringContaining('Fix the budget'),
        expect.stringContaining('Call with the client'),
      ]);
      expect(rows()[0]).toContain('Time not recorded yet');
      expect(screen.getByRole('heading', { name: /October 2026/ })).toBeInTheDocument();
      // All time by default: no period in the request.
      expect(calls.find((c) => c.url.includes('/finance/'))!.url).toBe(
        '/api/groups/g1/finance/work-log',
      );

      await user.click(screen.getByRole('button', { name: 'Show earlier' }));
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(rows()[0]).toContain('September work');
      expect(screen.queryByRole('button', { name: 'Show earlier' })).not.toBeInTheDocument();
    });

    it('has Hourly rates on a client’s tab, not on /finance (the page has its own)', async () => {
      serve((url) => (url.includes('/work-log') ? { body: logPage() } : undefined));
      renderIn(<WorkLogCard view={view} />);
      expect(await screen.findByRole('button', { name: 'Hourly rates' })).toBeInTheDocument();
      cleanup();
      renderIn(<WorkLogCard view={{ kind: 'all', clients: [] }} />);
      expect(await screen.findByRole('button', { name: 'Add time' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hourly rates' })).not.toBeInTheDocument();
    });

    it('adds a manual entry for an admin from the dialog', async () => {
      const rates: RatesDto = {
        admins: [{ userId: 'u2', name: 'Ján', active: true, current: null, history: [] }],
      };
      const calls = serve((url, init) => {
        if (url.includes('/work-log')) return { body: logPage() };
        if (url === '/api/finance/rates') return { body: rates };
        if (url.endsWith('/time-entries') && init?.method === 'POST')
          return { status: 201, body: { id: 'x' } };
        return undefined;
      });
      const { user } = renderIn(<WorkLogCard view={view} />);
      expect(await screen.findByText('No time logged in this period yet.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add time' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add time' });
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(within(dialog).getByText('Choose the admin.')).toBeInTheDocument();
      await waitFor(() =>
        expect(within(dialog).getByRole('option', { name: 'Ján' })).toBeInTheDocument(),
      );
      await user.selectOptions(within(dialog).getByLabelText('Admin'), 'u2');
      await user.type(within(dialog).getByLabelText('Time spent'), '2h');
      await user.type(within(dialog).getByLabelText('Note'), 'Workshop');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      const post = calls.find((c) => c.method === 'POST')!;
      expect(post.url).toBe('/api/groups/g1/finance/time-entries');
      expect(post.body).toMatchObject({ userId: 'u2', minutes: 120, note: 'Workshop' });
    });
  });

  describe('RatesDialog', () => {
    it("lists today's rates and history and adds an admin's first rate from the start", async () => {
      const rates: RatesDto = {
        admins: [
          {
            userId: 'u1',
            name: 'Eva',
            active: true,
            current: {
              id: 'r1',
              userId: 'u1',
              rateMinor: 4000,
              currency: 'EUR',
              effectiveFrom: null,
              createdBy: 'a1',
              createdByName: 'Fin',
              createdAt: '2026-01-01T00:00:00Z',
            },
            history: [
              {
                id: 'r1',
                userId: 'u1',
                rateMinor: 4000,
                currency: 'EUR',
                effectiveFrom: null,
                createdBy: 'a1',
                createdByName: 'Fin',
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
          { userId: 'u2', name: 'Ján', active: true, current: null, history: [] },
        ],
      };
      const calls = serve((url, init) => {
        if (url === '/api/finance/rates' && init?.method === 'POST') {
          return {
            status: 201,
            body: { ...rates.admins[0]!.current!, id: 'r2', userId: 'u2', rateMinor: 5050 },
          };
        }
        if (url === '/api/finance/rates') return { body: rates };
        return undefined;
      });
      const { user } = renderIn(<RatesDialog view={view} onClose={() => undefined} />);
      const [eva, jan] = await screen.findAllByTestId('rate-row');
      expect(eva).toHaveTextContent('€40.00 / h');
      expect(jan).toHaveTextContent('No rate');
      await user.click(within(jan!).getByRole('button', { name: 'Change' }));
      expect(within(jan!).getByRole('checkbox', { name: 'From the start' })).toBeChecked();
      await user.type(within(jan!).getByLabelText('Rate per hour (EUR)'), '50,50');
      await user.click(within(jan!).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        userId: 'u2',
        rateMinor: 5050,
        effectiveFrom: null,
      });
    });
  });

  describe('the Project and Event filters (Phase 33 P6)', () => {
    const picker = (url: string) => {
      if (url.includes('/groups/g1/projects/picker')) {
        return { body: [{ id: 'p1', name: 'Kultúra 2026', color: 'blue', status: 'active' }] };
      }
      if (url.includes('/projects/p1/events/picker')) {
        return {
          body: [{ id: 'e1', name: 'Hodnotenie', occursOn: '2026-11-04', source: 'manual' }],
        };
      }
      return undefined;
    };

    it('sends the remembered project and event, names them, and explains the missing money', async () => {
      localStorage.setItem(
        'spolu.filters.a1.finance.overview.project.g1',
        JSON.stringify({ project: 'p1', event: 'e1' }),
      );
      const calls = serve((url) =>
        url.includes('/overview') ? { body: overviewDto({ money: [] }) } : picker(url),
      );
      renderIn(<OverviewCard view={view} />);
      expect(await screen.findByText('Project: Kultúra 2026')).toBeInTheDocument();
      expect(await screen.findByText('Event: Hodnotenie')).toBeInTheDocument();
      expect(calls.find((c) => c.url.includes('/finance/overview'))!.url).toMatch(
        /&project=p1&event=e1$/,
      );
      expect(await screen.findByTestId('finance-no-event-money')).toBeInTheDocument();
    });

    it('filters the work log by project, and /finance only with one client and no event', async () => {
      localStorage.setItem(
        'spolu.filters.a1.finance.workLog.project.g1',
        JSON.stringify({ project: 'p1', event: 'e1' }),
      );
      const calls = serve((url) => (url.includes('/work-log') ? { body: logPage() } : picker(url)));
      renderIn(<WorkLogCard view={{ kind: 'all', clients: ['g1'] }} />);
      expect(await screen.findByText('Project: Kultúra 2026')).toBeInTheDocument();
      expect(screen.queryByText(/^Event:/)).not.toBeInTheDocument();
      await waitFor(() =>
        expect(calls.find((c) => c.url.includes('/finance/work-log'))!.url).toMatch(
          /clients=g1.*&project=p1$/,
        ),
      );
      cleanup();
      const many = serve((url) => (url.includes('/work-log') ? { body: logPage() } : undefined));
      renderIn(<WorkLogCard view={{ kind: 'all', clients: ['g1', 'g2'] }} />);
      await waitFor(() => expect(many.some((c) => c.url.includes('/finance/work-log'))).toBe(true));
      expect(screen.queryByTestId('finance-project-filter')).not.toBeInTheDocument();
      expect(many.find((c) => c.url.includes('/finance/work-log'))!.url).not.toContain('project=');
    });

    it('does not count eGrant tím as a client on /finance: one client with it keeps the pill', async () => {
      localStorage.setItem(
        'spolu.filters.a1.finance.workLog.project.g1',
        JSON.stringify({ project: 'p1' }),
      );
      const group = (id: string, kind: 'client' | 'admin') => ({
        id,
        name: id,
        kind,
        hasLogo: false,
        memberCount: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
        managers: [],
        managedByMe: false,
      });
      const calls = serve((url) => {
        if (url.endsWith('/api/groups'))
          return { body: [group('team', 'admin'), group('g1', 'client')] };
        return url.includes('/work-log') ? { body: logPage() } : picker(url);
      });
      renderIn(<WorkLogCard view={{ kind: 'all', clients: ['g1', 'team'] }} />);
      expect(await screen.findByText('Project: Kultúra 2026')).toBeInTheDocument();
      await waitFor(() =>
        expect(
          calls.some(
            (c) =>
              c.url.includes('/finance/work-log') &&
              /clients=g1(%2C|,)team/.test(c.url) &&
              c.url.endsWith('&project=p1'),
          ),
        ).toBe(true),
      );
    });
  });
});
