import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import type { ContractRow, HoursRankingPage, Me, PaidRankingPage, RatesDto } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { setLanguage } from '@/i18n';
import { financeKey } from '../api';
import { EntryDialog } from '../manual-entry-dialog';
import { logEntry, logMonth, logPage } from '../test-data';
import { WorkLogCard } from '../work-log-card';
import { ContractsCard } from './contracts-card';
import { HoursRankingCard } from './hours-ranking-card';
import { PaidRankingCard } from './paid-ranking-card';

const view = { kind: 'all', clients: [] } as const;
const year2026 = { from: '2026-01', to: '2026-12' };

type Handler = (url: string) => unknown;

/** `fetch` answering by URL (404 for anything else); records every URL. */
function serve(handler: Handler) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(input);
      const body = handler(input);
      return new Response(JSON.stringify(body ?? { error: 'not_found' }), {
        status: body === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return urls;
}

function renderIn(ui: ReactNode) {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const tab = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/finance' });
  const task = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/tasks/$taskId' });
  const router = createRouter({
    routeTree: root.addChildren([tab, task]),
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

function contract(over: Partial<ContractRow> = {}): ContractRow {
  return {
    id: 'c1',
    groupId: 'g1',
    groupName: 'Obec Lúčky',
    hasLogo: false,
    groupUpdatedAt: '2026-01-01T00:00:00.000Z',
    type: 'contract',
    folderId: null,
    title: 'Servis 2026',
    contract: {
      contractNumber: 'Z-12',
      amount: { amountMinor: 1_200_000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2099-12-31',
      shared: null,
    },
    fileCount: 1,
    expense: null,
    hasUpcomingReminder: false,
    createdBy: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const rates: RatesDto = {
  admins: [
    { userId: 'u1', name: 'Eva', active: true, current: null, history: [] },
    { userId: 'u2', name: 'Ján', active: true, current: null, history: [] },
  ],
};

describe('the system-wide cards (part D)', () => {
  beforeEach(async () => {
    await setLanguage('en');
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keys the all-clients view by its client filter', () => {
    expect(financeKey({ kind: 'all', clients: ['g1', 'g2'] }, 'contracts')).toEqual([
      'finance',
      'all',
      'contracts',
      'g1,g2',
    ]);
    expect(financeKey({ kind: 'group', groupId: 'g1' }, 'overview', 'x')).toEqual([
      'finance',
      'g1',
      'overview',
      'x',
    ]);
  });

  it('lists contracts with their client, links each to its tab, sorts and searches', async () => {
    const urls = serve((url) =>
      url.startsWith('/api/finance/contracts')
        ? {
            items: url.includes('q=servis')
              ? [contract({ id: 'n1', type: 'note', title: 'Servis memo', contract: null })]
              : [contract()],
            nextCursor: null,
          }
        : undefined,
    );
    const { user } = renderIn(<ContractsCard view={view} range={year2026} />);
    const row = await screen.findByTestId('contract-row');
    expect(within(row).getByText('Obec Lúčky')).toBeInTheDocument();
    expect(within(row).getByText('Z-12')).toBeInTheDocument();
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/groups/g1/finance?item=c1');
    expect(urls.at(-1)).toContain('sort=start&dir=desc&from=2026-01&to=2026-12');

    await user.selectOptions(screen.getByLabelText('Sort contracts'), 'end');
    await waitFor(() => expect(urls.at(-1)).toContain('sort=end&dir=asc'));

    await user.type(screen.getByLabelText('Search contracts, documents and notes'), 'servis');
    expect(await screen.findByText('Servis memo')).toBeInTheDocument();
    expect(screen.getByText('(note)')).toBeInTheDocument();
    // A search covers every document and note, whatever the page period.
    expect(urls.at(-1)).toContain('q=servis');
    expect(urls.at(-1)).not.toContain('from=');
  });

  it('ranks clients by money paid with their share, for a year or a month', async () => {
    const page: PaidRankingPage = {
      rows: [
        {
          rank: 1,
          groupId: 'g1',
          groupName: 'Alfa',
          hasLogo: false,
          groupUpdatedAt: '',
          amountMinor: 750_000,
        },
        {
          rank: 2,
          groupId: 'g2',
          groupName: 'Beta',
          hasLogo: false,
          groupUpdatedAt: '',
          amountMinor: 250_000,
        },
      ],
      total: 1_000_000,
      max: 750_000,
      nextCursor: null,
    };
    const urls = serve((url) => (url.startsWith('/api/finance/rankings/paid') ? page : undefined));
    renderIn(<PaidRankingCard view={view} range={year2026} />);
    const rows = await screen.findAllByTestId('ranking-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Alfa')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('75%')).toBeInTheDocument();
    expect(urls.at(-1)).toContain('from=2026-01&to=2026-12&currency=EUR');
  });

  it('the paid ranking over all time sends no months', async () => {
    const urls = serve((url) =>
      url.startsWith('/api/finance/rankings/paid')
        ? { rows: [], total: 0, max: 0, nextCursor: null }
        : undefined,
    );
    renderIn(<PaidRankingCard view={view} range={null} />);
    expect(await screen.findByText(/No contract of the chosen clients/)).toBeInTheDocument();
    expect(urls.at(-1)).toBe('/api/finance/rankings/paid?currency=EUR');
  });

  it('ranks by hours or money, filters by admin and names the time without a client', async () => {
    const page: HoursRankingPage = {
      rows: [
        {
          rank: 1,
          groupId: null,
          groupName: '',
          hasLogo: false,
          groupUpdatedAt: '',
          minutes: 600,
          cost: null,
          missingRateMinutes: 600,
        },
        {
          rank: 2,
          groupId: 'g1',
          groupName: 'Alfa',
          hasLogo: false,
          groupUpdatedAt: '',
          minutes: 90,
          cost: 9000,
          missingRateMinutes: 0,
        },
      ],
      max: 600,
      nextCursor: null,
    };
    const urls = serve((url) => {
      if (url.startsWith('/api/finance/rankings/hours')) return page;
      if (url === '/api/finance/rates') return rates;
      return undefined;
    });
    const { user } = renderIn(<HoursRankingCard view={view} range={year2026} />);
    const rows = await screen.findAllByTestId('ranking-row');
    expect(within(rows[0]!).getByText('Without client')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('10 h without a rate')).toBeInTheDocument();
    expect(urls.find((u) => u.includes('/rankings/hours'))).toMatch(
      /from=2026-01&to=2026-12&sort=hours/,
    );

    await user.click(screen.getByRole('radio', { name: 'Money' }));
    await waitFor(() => expect(urls.at(-1)).toContain('sort=cost'));
    await user.selectOptions(await screen.findByLabelText('Admin'), 'u2');
    await waitFor(() => expect(urls.at(-1)).toContain('admin=u2'));
  });

  it('the all-clients work log names each entry’s client and the month’s top clients', async () => {
    serve((url) =>
      url.startsWith('/api/finance/work-log')
        ? logPage({
            entries: [
              logEntry({ groupId: null, groupName: null, workedOn: '2026-10-02' }),
              logEntry({ groupId: 'g1', groupName: 'Alfa', workedOn: '2026-10-01' }),
            ],
            months: [
              {
                ...logMonth('2026-10', 120),
                topClients: [
                  { groupId: 'g1', name: 'Alfa', minutes: 60 },
                  { groupId: null, name: '', minutes: 60 },
                ],
              },
            ],
          })
        : url === '/api/finance/rates'
          ? rates
          : undefined,
    );
    renderIn(<WorkLogCard view={view} />);
    const entries = await screen.findAllByTestId('work-log-entry');
    expect(entries.map((e) => e.textContent)).toEqual([
      expect.stringContaining('Alfa'),
      expect.stringContaining('Without client'),
    ]);
    const top = screen.getByTestId('work-log-top-clients');
    expect(top).toHaveTextContent('Most hours: Alfa 1 h, Without client 1 h');
  });

  it('"Add time" on /finance picks a client or Without client and posts to the system route', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') {
          sent.push({ url: input, method, body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify({ id: 'e1' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        const body =
          input === '/api/finance/rates'
            ? rates
            : input === '/api/groups'
              ? [
                  {
                    id: 'g1',
                    name: 'Alfa',
                    hasLogo: false,
                    memberCount: 1,
                    updatedAt: '',
                    managers: [],
                    managedByMe: false,
                  },
                ]
              : undefined;
        return new Response(JSON.stringify(body ?? { error: 'not_found' }), {
          status: body === undefined ? 404 : 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onClose = vi.fn();
    const { user } = renderIn(<EntryDialog view={view} onClose={onClose} />);
    const clientSelect = await screen.findByLabelText('Client');
    await user.selectOptions(await screen.findByLabelText('Admin'), 'u1');
    await user.type(screen.getByLabelText('Time spent'), '1:30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose the client, or “Without client”.')).toBeInTheDocument();
    expect(sent).toEqual([]);

    await waitFor(() => expect(within(clientSelect).getByText('Alfa')).toBeInTheDocument());
    await user.selectOptions(clientSelect, 'Without client');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toEqual([
      {
        url: '/api/finance/time-entries',
        method: 'POST',
        body: expect.objectContaining({ groupId: null, userId: 'u1', minutes: 90 }),
      },
    ]);
  });
});
