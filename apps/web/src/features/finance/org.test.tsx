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
import type { ContractRow, FinanceItemDetail, FinanceOverviewDto, Me } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { i18n, setLanguage } from '@/i18n';
import { ItemSheet } from './documents/item-sheet';
import {
  emptyItemValue,
  fromItem,
  toOrgBody,
  toPatch,
  validateItem,
  type ItemFormValue,
} from './documents/item-form';
import { newShareRow, sharesBalance, splitEvenly } from './documents/shares-field';
import { OverviewCard } from './overview-card';
import { ContractsCard } from './system/contracts-card';

/** Phase 32 E on the web: expenses, contracts of several clients, the ledger, the overview. */

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const shared = (over: Partial<FinanceItemDetail> = {}): FinanceItemDetail => ({
  id: 'sc1',
  groupId: null,
  type: 'contract',
  folderId: null,
  title: 'Spoločný grant',
  contract: {
    contractNumber: null,
    amount: { amountMinor: 300_000, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2099-12-31',
    shared: {
      payerName: 'Mikroregión Horehronie',
      total: { amountMinor: 300_000, currency: 'EUR' },
      shares: [
        { groupId: 'g1', groupName: 'Obec Alfa', amountMinor: 100_000 },
        { groupId: 'g2', groupName: 'Obec Beta', amountMinor: 200_000 },
      ],
    },
  },
  expense: null,
  fileCount: 0,
  hasUpcomingReminder: false,
  createdBy: 'a1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  body: '',
  files: [],
  createdByName: 'Eva',
  ...over,
});

const value = (over: Partial<ItemFormValue> = {}): ItemFormValue => ({
  ...emptyItemValue(),
  ...over,
});

describe('shares: balance and even split', () => {
  it('tells how far the typed shares are from the amount, in cents', () => {
    const rows = [
      { ...newShareRow('g1'), amount: '1 000' },
      { ...newShareRow('g2'), amount: '999,99' },
    ];
    expect(sharesBalance('2 000', rows, 'EUR')).toEqual({ total: 200_000, allocated: 199_999 });
    expect(sharesBalance('x', rows, 'EUR')).toBeNull();
    expect(sharesBalance('10', [{ ...newShareRow('g1'), amount: 'abc' }], 'EUR')).toBeNull();
  });

  it('splits evenly so the cents always add up', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(300_000, 2)).toEqual([150_000, 150_000]);
    expect(splitEvenly(5, 0)).toEqual([]);
    const parts = splitEvenly(1_000_001, 7);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_001);
  });
});

describe('the item form (Phase 32 E)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('an expense needs its amount and date; a salary its admin, another expense its title', () => {
    const salary = value({ expenseKind: 'salary', amount: '2 500', spentOn: '2026-10-31' });
    expect(validateItem('expense', salary, t)).toMatchObject({
      payeeId: t('financeOrg.errors.payeeRequired'),
    });
    expect(validateItem('expense', { ...salary, payeeId: 'u1' }, t)).toEqual({});
    expect(validateItem('expense', { ...salary, expenseKind: 'other' }, t)).toEqual({
      title: t('financeOrg.errors.whatRequired'),
    });
    expect(
      Object.keys(validateItem('expense', value({ expenseKind: 'other', title: 'X' }), t)).sort(),
    ).toEqual(['amount', 'spentOn']);
    expect(toOrgBody('expense', { ...salary, payeeId: 'u1', title: ' Október ' }, null)).toEqual({
      type: 'expense',
      title: 'Október',
      body: '',
      folderId: null,
      fileIds: [],
      expenseKind: 'salary',
      payeeId: 'u1',
      amount: { amountMinor: 250_000, currency: 'EUR' },
      spentOn: '2026-10-31',
    });
  });

  it('a contract of several clients needs its payer and shares that add up (O1)', () => {
    const base = value({
      owner: 'shared',
      title: 'Grant',
      amount: '3 000',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      payerName: 'Mikroregión',
      shares: [
        { ...newShareRow('g1'), amount: '1 000' },
        { ...newShareRow('g2'), amount: '2 000' },
      ],
    });
    expect(validateItem('contract', base, t, { shared: true })).toEqual({});
    const off = { ...base, shares: [base.shares[0]!, { ...base.shares[1]!, amount: '1 999,99' }] };
    expect(validateItem('contract', off, t, { shared: true })).toEqual({
      shares: t('financeOrg.errors.sharesSum'),
    });
    expect(
      validateItem('contract', { ...base, payerName: ' ', shares: [base.shares[0]!] }, t, {
        shared: true,
      }),
    ).toEqual({
      payerName: t('financeOrg.errors.payerRequired'),
      shares: t('financeOrg.errors.sharesTooFew'),
    });
    expect(
      validateItem('contract', { ...base, shares: [base.shares[0]!, newShareRow('')] }, t, {
        shared: true,
      }),
    ).toEqual({ shares: t('financeOrg.errors.shareClient') });
    expect(toOrgBody('contract', base, 'f1')).toMatchObject({
      type: 'contract',
      payerName: 'Mikroregión',
      amount: { amountMinor: 300_000, currency: 'EUR' },
      shares: [
        { groupId: 'g1', amountMinor: 100_000 },
        { groupId: 'g2', amountMinor: 200_000 },
      ],
    });
  });

  it('an edit of a shared contract sends the shares whole, also when only the amount moved', () => {
    const item = shared();
    const loaded = fromItem(item, 'en');
    expect(loaded.amount).toBe('3000');
    expect(loaded.shares.map((s) => [s.groupId, s.amount])).toEqual([
      ['g1', '1000'],
      ['g2', '2000'],
    ]);
    expect(toPatch(item, loaded)).toEqual({ updatedAt: item.updatedAt });
    const moved = {
      ...loaded,
      amount: '3 500',
      shares: [loaded.shares[0]!, { ...loaded.shares[1]!, amount: '2 500' }],
    };
    expect(toPatch(item, moved)).toEqual({
      updatedAt: item.updatedAt,
      amount: { amountMinor: 350_000, currency: 'EUR' },
      shares: [
        { groupId: 'g1', amountMinor: 100_000 },
        { groupId: 'g2', amountMinor: 250_000 },
      ],
    });
  });
});

type Handler = (url: string, init?: RequestInit) => unknown;

function serve(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return new Response(JSON.stringify(body ?? { error: 'not_found' }), {
        status: body === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function renderIn(ui: ReactNode, path = '/') {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const tab = createRoute({ getParentRoute: () => root, path: '/groups/$groupId/finance' });
  const finance = createRoute({ getParentRoute: () => root, path: '/finance' });
  const router = createRouter({
    routeTree: root.addChildren([tab, finance]),
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

describe('the screens (Phase 32 E)', () => {
  beforeEach(async () => {
    await setLanguage('en');
    localStorage.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a client's tab shows its share and the payer read-only, with a link to Finance (O2, E10)", async () => {
    // What the server answers for `?group=g1`: that client's share only.
    const mine = shared({
      contract: {
        ...shared().contract!,
        amount: { amountMinor: 100_000, currency: 'EUR' },
        shared: {
          ...shared().contract!.shared!,
          shares: [{ groupId: 'g1', groupName: 'Obec Alfa', amountMinor: 100_000 }],
        },
      },
    });
    serve((url) => {
      if (url === '/api/finance/items/sc1?group=g1') return mine;
      if (url === '/api/groups/g1/finance/folders') return [];
      if (url === '/api/groups/g1/people') return [];
      return undefined;
    });
    renderIn(
      <ItemSheet
        owner={{ kind: 'group', groupId: 'g1' }}
        target={{ mode: 'view', id: 'sc1' }}
        folderId={null}
        onClose={() => {}}
        onUnavailable={() => {}}
      />,
      '/groups/g1/finance?item=sc1',
    );
    const sheet = await screen.findByTestId('finance-item-sheet');
    await within(sheet).findByText('Mikroregión Horehronie');
    expect(within(sheet).getByTestId('share-amount')).toHaveTextContent('1,000.00');
    expect(within(sheet).getByText('€3,000.00')).toBeInTheDocument();
    expect(
      within(sheet).queryByRole('button', { name: t('financeDocuments.sheet.edit') }),
    ).toBeNull();
    expect(within(sheet).getByTestId('edit-on-finance')).toHaveAttribute(
      'href',
      '/finance?item=sc1',
    );
    expect(within(sheet).queryByText('Obec Beta')).toBeNull();
  });

  it('the ledger filters by type and opens an organisation item here', async () => {
    const expenseRow: ContractRow = {
      ...shared(),
      id: 'x1',
      type: 'expense',
      title: '',
      contract: null,
      expense: {
        kind: 'salary',
        payeeId: 'u1',
        payeeName: 'Ján Kováč',
        amount: { amountMinor: 250_000, currency: 'EUR' },
        spentOn: '2026-10-31',
      },
      groupName: '',
      hasLogo: false,
      groupUpdatedAt: '',
    };
    const calls = serve((url) => {
      if (url.startsWith('/api/finance/contracts')) {
        return { items: url.includes('type=expense') ? [expenseRow] : [], nextCursor: null };
      }
      if (url === '/api/finance/items/x1')
        return { ...expenseRow, body: '', files: [], createdByName: 'Eva' };
      if (url === '/api/finance/org/folders') return [];
      if (url === '/api/finance/recipients' || url === '/api/finance/payees') return [];
      if (url === '/api/groups') return [];
      if (url === '/api/finance-items/x1/reminders') {
        return { times: [], recipients: [], subscribed: true, canEdit: true };
      }
      return undefined;
    });
    const { user, router } = renderIn(
      <ContractsCard view={{ kind: 'all', clients: [] }} range={null} />,
      '/finance',
    );
    await user.click(
      await screen.findByRole('button', { name: t('financeOrg.ledger.type.expense') }),
    );
    const row = await screen.findByTestId('contract-row');
    expect(row).toHaveTextContent(t('financeOrg.row.organisation'));
    expect(row).toHaveTextContent('Salary: Ján Kováč');
    expect(row).toHaveTextContent('−€2,500');
    expect(calls.some((c) => c.url.includes('type=expense'))).toBe(true);
    await user.click(within(row).getByRole('button', { name: /Salary: Ján Kováč/ }));
    await waitFor(() =>
      expect((router.state.location.search as Record<string, unknown>).item).toBe('x1'),
    );
    const sheet = await screen.findByTestId('finance-item-sheet');
    expect(await within(sheet).findByText(t('financeOrg.form.kinds.salary'))).toBeInTheDocument();
  });

  it('the overview with every client counts the expenses as money out (O3, E17)', async () => {
    const dto: FinanceOverviewDto = {
      from: '2026-01',
      to: '2026-12',
      months: ['2026-01', '2026-02'],
      organisation: true,
      expenses: [
        {
          currency: 'EUR',
          paidOut: 400_000,
          salaryPaidOut: 300_000,
          planned: 50_000,
          byMonth: [{ month: '2026-01', paidOut: 400_000, planned: 0 }],
        },
      ],
      money: [
        {
          currency: 'EUR',
          paid: 1_000_000,
          toBePaid: 0,
          byMonth: [{ month: '2026-01', paid: 1_000_000, toBePaid: 0 }],
        },
      ],
      cost: { total: 900_000, byMonth: [] },
      hours: { minutes: 0, taskCount: 0, ticketCount: 0, missingRateMinutes: 0, byAdmin: [] },
    };
    serve((url) => (url.startsWith('/api/finance/overview') ? dto : undefined));
    renderIn(<OverviewCard view={{ kind: 'all', clients: [] }} />, '/finance');
    const balance = await screen.findByText(t('financeOrg.overview.balance'));
    // Paid 10 000 − paid out 4 000 = 6 000; the cost of work (9 000) is not subtracted.
    expect(balance.parentElement).toHaveTextContent('€6,000');
    expect(
      screen.getByText(t('financeOrg.overview.paidOut', { currency: 'EUR' })).parentElement,
    ).toHaveTextContent('€4,000');
    expect(screen.getByText(/admins' salaries €3,000/)).toBeInTheDocument();
    expect(
      screen.getByText(t('financeOrg.overview.planned', { currency: 'EUR' })).parentElement,
    ).toHaveTextContent('€500');
  });
});
