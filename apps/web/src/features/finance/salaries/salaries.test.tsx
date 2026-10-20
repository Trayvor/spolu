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
import type { ContractRow, Me, SalaryDetail, SalaryPage } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { i18n, setLanguage } from '@/i18n';
import { SalariesCard } from './salaries-card';
import {
  emptySalaryValue,
  SalarySheet,
  toSalaryBody,
  toSalaryPatch,
  validateSalary,
} from './salary-sheet';

/** Salaries ("Mzdy", 2026-10-21) on the web: the view, its totals and filter, the sheet. */

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });

const salary = (over: Partial<SalaryDetail> = {}): SalaryDetail => ({
  id: 's1',
  payeeId: 'u1',
  payeeName: 'Eva Nováková',
  month: '2026-09',
  amount: eur(250_050),
  note: 'September',
  fileCount: 0,
  documentCount: 0,
  createdBy: 'a1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  files: [],
  documents: [],
  createdByName: 'Fin',
  ...over,
});

const page: SalaryPage = {
  items: [
    salary(),
    salary({ id: 's2', payeeId: 'u2', payeeName: 'Ján Kováč', amount: eur(90_000) }),
  ],
  nextCursor: null,
  totals: {
    total: [{ ...eur(340_050), count: 2 }],
    byAdmin: [
      { payeeId: 'u1', payeeName: 'Eva Nováková', amount: eur(250_050), count: 1 },
      { payeeId: 'u2', payeeName: 'Ján Kováč', amount: eur(90_000), count: 1 },
    ],
    byMonth: [{ month: '2026-09', amount: eur(340_050) }],
  },
};

type Handler = (url: string, init?: RequestInit) => unknown;

function serve(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return new Response(body === null ? null : JSON.stringify(body ?? { error: 'not_found' }), {
        status: body === undefined ? 404 : body === null ? 204 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function renderIn(ui: ReactNode, path = '/finance') {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const finance = createRoute({ getParentRoute: () => root, path: '/finance' });
  const router = createRouter({
    routeTree: root.addChildren([finance]),
    history: createMemoryHistory({ initialEntries: [path] }),
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
    router,
    user: userEvent.setup(),
  };
}

const payees = [
  { id: 'u1', name: 'Eva Nováková' },
  { id: 'u2', name: 'Ján Kováč' },
];

beforeEach(async () => {
  await setLanguage('en');
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the salary form', () => {
  it('needs an admin, a month and an amount; sends integer cents', () => {
    expect(Object.keys(validateSalary(emptySalaryValue(), t)).sort()).toEqual([
      'amount',
      'month',
      'payeeId',
    ]);
    const value = { ...emptySalaryValue('u1'), month: '2026-09', amount: '2 500,50', note: 'x' };
    expect(validateSalary(value, t)).toEqual({});
    expect(toSalaryBody(value)).toEqual({
      payeeId: 'u1',
      month: '2026-09',
      amount: { amountMinor: 250_050, currency: 'EUR' },
      note: 'x',
      fileIds: [],
    });
    expect(validateSalary({ ...value, amount: '-1' }, t)).toHaveProperty('amount');
  });

  it('an edit sends only what changed, with its version', () => {
    const s = salary();
    const loaded = {
      payeeId: 'u1',
      month: '2026-09',
      amount: '2500.5',
      currency: 'EUR' as const,
      note: 'September',
      fileIds: [],
    };
    expect(toSalaryPatch(s, loaded)).toEqual({ updatedAt: s.updatedAt });
    expect(toSalaryPatch(s, { ...loaded, month: '2026-10', amount: '2600' })).toEqual({
      updatedAt: s.updatedAt,
      month: '2026-10',
      amount: { amountMinor: 260_000, currency: 'EUR' },
    });
  });
});

describe('the Mzdy view', () => {
  it('lists the salaries with totals per admin and month; the admin filter goes to the query', async () => {
    const calls = serve((url) => {
      if (url === '/api/finance/payees') return payees;
      if (url.startsWith('/api/finance/salaries')) return page;
      return undefined;
    });
    const onOpen = vi.fn();
    const { user } = renderIn(
      <SalariesCard
        range={{ from: '2026-01', to: '2026-12' }}
        title="Items"
        onOpen={onOpen}
        onCreate={() => {}}
      />,
    );
    const rows = await screen.findAllByTestId('salary-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Eva Nováková');
    expect(rows[0]).toHaveTextContent('September 2026');
    expect(rows[0]).toHaveTextContent('−€2,501');
    const totals = screen.getByTestId('salary-totals');
    expect(totals).toHaveTextContent(t('financeOrg.salaries.count', { count: 2 }));
    expect(totals).toHaveTextContent('€3,401');
    expect(totals).toHaveTextContent('Ján Kováč');
    expect(calls.some((c) => c.url === '/api/finance/salaries?from=2026-01&to=2026-12')).toBe(true);
    await user.selectOptions(screen.getByLabelText(t('financeOrg.salaries.admin')), 'Ján Kováč');
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/finance/salaries?admin=u2&from='))).toBe(
        true,
      ),
    );
    const fresh = await screen.findAllByTestId('salary-row');
    await user.click(within(fresh[0]!).getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('says when the period has no salaries', async () => {
    serve((url) => {
      if (url === '/api/finance/payees') return payees;
      if (url.startsWith('/api/finance/salaries')) {
        return { items: [], nextCursor: null, totals: { total: [], byAdmin: [], byMonth: [] } };
      }
      return undefined;
    });
    renderIn(
      <SalariesCard
        range={{ from: '2026-01', to: '2026-12' }}
        title="Items"
        onOpen={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(await screen.findByText(t('financeOrg.salaries.empty'))).toBeInTheDocument();
  });
});

describe('the salary sheet', () => {
  it('creates a salary in integer cents', async () => {
    const calls = serve((url, init) => {
      if (url === '/api/finance/payees') return payees;
      if (url === '/api/finance/salaries' && init?.method === 'POST') return salary();
      return undefined;
    });
    const onClose = vi.fn();
    const { user } = renderIn(
      <SalarySheet
        target={{ mode: 'create' }}
        defaultPayee="u1"
        onClose={onClose}
        onUnavailable={() => {}}
      />,
    );
    const sheet = await screen.findByTestId('salary-sheet');
    await within(sheet).findByRole('option', { name: 'Eva Nováková' });
    await user.type(within(sheet).getByLabelText(t('financeOrg.salaries.month')), '2026-09');
    await user.type(within(sheet).getByLabelText(t('financeOrg.salaries.amount')), '2500,50');
    await user.click(
      within(sheet).getByRole('button', { name: t('financeDocuments.sheet.create') }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('s1'));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      payeeId: 'u1',
      month: '2026-09',
      amount: { amountMinor: 250_050, currency: 'EUR' },
      note: '',
      fileIds: [],
    });
  });

  it('links a found document and unlinks a linked one', async () => {
    const document: ContractRow = {
      id: 'd1',
      groupId: null,
      type: 'document',
      folderId: null,
      title: 'Výplatná páska',
      contract: null,
      expense: null,
      fileCount: 0,
      hasUpcomingReminder: false,
      createdBy: 'a1',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      groupName: '',
      hasLogo: false,
      groupUpdatedAt: '',
    };
    const linked = salary({
      documents: [{ id: 'd2', title: 'Zmluva o mzde', groupId: null, groupName: null }],
    });
    const calls = serve((url, init) => {
      if (url === '/api/finance/payees') return payees;
      if (url === '/api/finance/salaries/s1') return linked;
      if (url.startsWith('/api/finance/contracts')) return { items: [document], nextCursor: null };
      if (url === '/api/finance/salaries/s1/documents' && init?.method === 'POST') {
        return { linked: true };
      }
      if (url === '/api/finance/salaries/s1/documents/d2' && init?.method === 'DELETE') return null;
      return undefined;
    });
    const { user } = renderIn(
      <SalarySheet
        target={{ mode: 'view', id: 's1' }}
        onClose={() => {}}
        onUnavailable={() => {}}
      />,
    );
    const section = await screen.findByTestId('linked-documents');
    expect(await within(section).findByText('Zmluva o mzde')).toBeInTheDocument();
    await user.click(
      within(section).getByRole('button', { name: t('financeOrg.salaries.linkDocument') }),
    );
    await user.type(
      within(section).getByLabelText(t('financeOrg.salaries.searchDocuments')),
      'páska',
    );
    await within(section).findByText('Výplatná páska');
    expect(calls.some((c) => c.url.includes('type=document') && c.url.includes('q='))).toBe(true);
    await user.click(within(section).getByRole('button', { name: t('financeOrg.salaries.link') }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.init?.method === 'POST' && JSON.parse(String(c.init.body)).documentId === 'd1',
        ),
      ).toBe(true),
    );
    await user.click(
      within(section).getByRole('button', {
        name: t('financeOrg.salaries.unlinkLabel', { name: 'Zmluva o mzde' }),
      }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.init?.method === 'DELETE' && c.url === '/api/finance/salaries/s1/documents/d2',
        ),
      ).toBe(true),
    );
  });
});
