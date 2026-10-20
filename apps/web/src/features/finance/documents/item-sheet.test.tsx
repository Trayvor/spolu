import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { FileInfo, FinanceItemDetail } from '@spolu/shared';
import { uploadFileTo } from '@/features/files/upload';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn(), uploadFileTo: vi.fn() }));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = { id: 'a1', name: 'Eva', email: 'e@x.sk', role: 'admin', finance: true, groups: [] };
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  inviteUrl: 'https://spolu.test/join/x',
};
const SAVED: FinanceItemDetail = {
  id: 'c9',
  groupId: 'g1',
  type: 'contract',
  folderId: null,
  title: 'Zmluva o dielo',
  contract: {
    contractNumber: null,
    amount: { amountMinor: 1_200_000, currency: 'EUR' },
    startsOn: '2030-01-01',
    endsOn: '2030-12-31',
    shared: null,
  },
  fileCount: 0,
  expense: null,
  hasUpcomingReminder: false,
  createdBy: 'a1',
  createdAt: '2026-10-17T10:00:00.000Z',
  updatedAt: '2026-10-17T10:00:00.000Z',
  body: '',
  files: [],
  createdByName: 'Eva',
};

/** Contracts v2 (ADR 0066): a master with a contract under it, a schedule and a document. */
const MASTER: FinanceItemDetail = {
  ...SAVED,
  id: 'm1',
  title: 'Rámcová zmluva',
  parent: null,
  children: [
    {
      id: 'c2',
      groupId: 'g1',
      title: 'Dodatok 1',
      contractNumber: null,
      startsOn: '2030-01-01',
      endsOn: '2030-06-30',
    },
  ],
  schedule: {
    frequency: 'monthly',
    everyMonths: 1,
    amount: { amountMinor: 60_000, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2026-03-31',
    dates: null,
  },
  payments: {
    periods: [
      {
        dueOn: '2026-01-01',
        until: '2026-02-01',
        expected: { amountMinor: 60_000, currency: 'EUR' },
        received: { amountMinor: 60_000, currency: 'EUR' },
        status: 'paid',
      },
      {
        dueOn: '2026-02-01',
        until: '2026-03-01',
        expected: { amountMinor: 60_000, currency: 'EUR' },
        received: { amountMinor: 20_000, currency: 'EUR' },
        status: 'partial',
      },
      {
        dueOn: '2026-03-01',
        until: null,
        expected: { amountMinor: 60_000, currency: 'EUR' },
        received: { amountMinor: 0, currency: 'EUR' },
        status: 'unpaid',
      },
    ],
    dueToDate: { amountMinor: 180_000, currency: 'EUR' },
    received: { amountMinor: 80_000, currency: 'EUR' },
    upcoming: { amountMinor: 0, currency: 'EUR' },
    nextDueOn: null,
    unpaidCount: 1,
    partialCount: 1,
  },
  documents: [
    {
      id: 'd1',
      groupId: 'g1',
      title: 'Faktúra 1/2026',
      payment: { amount: { amountMinor: 60_000, currency: 'EUR' }, paidOn: '2026-01-10' },
    },
  ],
};
const CHOICES = [
  {
    id: 'm1',
    groupId: 'g1',
    title: 'Rámcová zmluva',
    contractNumber: 'R-1',
    startsOn: '2030-01-01',
    endsOn: '2030-12-31',
    parentId: null,
    hasChildren: true,
  },
  {
    id: 'c2',
    groupId: 'g1',
    title: 'Dodatok 1',
    contractNumber: null,
    startsOn: '2030-01-01',
    endsOn: '2030-06-30',
    parentId: 'm1',
    hasChildren: false,
  },
];

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/people') return reply(200, []);
    if (url === '/api/groups/g1/finance/folders') return reply(200, []);
    if (url === '/api/groups/g1/finance/items' && init?.method === 'POST') return reply(201, SAVED);
    if (url.startsWith('/api/groups/g1/finance/items'))
      return reply(200, { items: [], nextCursor: null });
    // The tab reads an item as its client sees it (Phase 32 E, `?group=`).
    if (url === '/api/finance/items/c9?group=g1') return reply(200, SAVED);
    if (url === '/api/finance/items/m1?group=g1') return reply(200, MASTER);
    if (url === '/api/finance/items/c2?group=g1') {
      return reply(200, { ...SAVED, id: 'c2', title: 'Dodatok 1' });
    }
    if (url === '/api/finance/contract-choices?group=g1') return reply(200, CHOICES);
    if (url === '/api/finance-items/c9/reminders') {
      return reply(200, { times: [], recipients: [], subscribed: true, canEdit: true });
    }
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the finance item sheet', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a new contract checks its fields, then saves the item and its proposed reminder', async () => {
    const fetchMock = mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: ['/groups/g1/finance'] }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('financeDocuments.card.new') }));
    await user.click(within(await screen.findByRole('menu')).getAllByRole('menuitem')[0]!);
    const sheet = await screen.findByTestId('finance-item-sheet', {}, { timeout: 5000 });
    const create = within(sheet).getByRole('button', { name: t('financeDocuments.sheet.create') });

    await user.click(create);
    expect(
      within(sheet).getByText(t('financeDocuments.form.errors.titleRequired')),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(t('financeDocuments.form.errors.amountInvalid')),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(t('financeDocuments.form.errors.startRequired')),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await user.type(
      within(sheet).getByLabelText(t('financeDocuments.form.title')),
      'Zmluva o dielo',
    );
    await user.type(within(sheet).getByLabelText(t('financeDocuments.form.amount')), '12 000');
    await user.type(
      within(sheet).getByLabelText(t('financeDocuments.form.startsOn')),
      '2030-01-01',
    );
    await user.type(within(sheet).getByLabelText(t('financeDocuments.form.endsOn')), '2030-12-31');
    // The proposal follows the end date: 30 days before, at 09:00.
    expect(within(sheet).getByDisplayValue('2030-12-01')).toBeInTheDocument();
    await user.click(create);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/finance-items/c9/reminders')).toBe(
        true,
      ),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      type: 'contract',
      title: 'Zmluva o dielo',
      body: '',
      folderId: null,
      fileIds: [],
      contractNumber: null,
      amount: { amountMinor: 1_200_000, currency: 'EUR' },
      startsOn: '2030-01-01',
      endsOn: '2030-12-31',
      projectId: null,
      parentId: null,
      schedule: null,
    });
    const put = fetchMock.mock.calls.find(
      ([u, init]) => u === '/api/finance-items/c9/reminders' && init?.method === 'PUT',
    )!;
    const body = JSON.parse(String(put[1]!.body)) as { times: { at: string }[] };
    expect(body.times).toHaveLength(1);
    expect(new Date(body.times[0]!.at).getDate()).toBe(1);
    await waitFor(() =>
      expect((router.state.location.search as Record<string, unknown>).item).toBe('c9'),
    );
  });

  it('Create waits for an upload: aria-disabled with a reason, ignored, then enabled', async () => {
    let finish!: (file: FileInfo) => void;
    vi.mocked(uploadFileTo).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const fetchMock = mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: ['/groups/g1/finance'] }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('financeDocuments.card.new') }));
    await user.click(within(await screen.findByRole('menu')).getAllByRole('menuitem')[0]!);
    const sheet = await screen.findByTestId('finance-item-sheet', {}, { timeout: 5000 });
    const create = within(sheet).getByRole('button', { name: t('financeDocuments.sheet.create') });
    await user.upload(within(sheet).getByTestId('finance-file-input'), new File(['x'], 'a.pdf'));
    await waitFor(() => expect(create).toHaveAttribute('aria-disabled', 'true'));
    expect(create).toHaveAccessibleDescription(t('forms.files.waiting'));
    await user.click(create);
    expect(within(sheet).queryByText(t('financeDocuments.form.errors.titleRequired'))).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await act(async () =>
      finish({
        id: 'f1',
        name: 'a.pdf',
        mime: 'application/pdf',
        size: 1,
        width: null,
        height: null,
        hasPreview: false,
      }),
    );
    await waitFor(() => expect(create).toHaveAttribute('aria-disabled', 'false'));
  });

  it('a master shows the contracts under it, its expected payments and its documents', async () => {
    mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: ['/groups/g1/finance?item=m1'] }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const sheet = await screen.findByTestId('finance-item-sheet', {}, { timeout: 5000 });
    const children = await within(sheet).findByTestId('contract-children');
    expect(within(children).getByText('Dodatok 1')).toBeInTheDocument();
    const schedule = within(sheet).getByTestId('contract-schedule');
    expect(schedule).toHaveTextContent(/\+\D*600[.,]00/);
    for (const status of ['paid', 'partial', 'unpaid']) {
      expect(
        within(schedule).getAllByRole('img', {
          name: t(`financeDocuments.contracts.status.${status}`),
        }),
      ).toHaveLength(1);
    }
    expect(within(sheet).getByTestId('contract-documents')).toHaveTextContent('Faktúra 1/2026');
    // Opening a contract under it changes `?item=`.
    await userEvent.setup().click(within(children).getByRole('button', { name: 'Dodatok 1' }));
    await waitFor(() =>
      expect((router.state.location.search as Record<string, unknown>).item).toBe('c2'),
    );
  });

  it('a new contract sends its master and a monthly schedule', async () => {
    const fetchMock = mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter(
      queryClient,
      createMemoryHistory({ initialEntries: ['/groups/g1/finance'] }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('financeDocuments.card.new') }));
    await user.click(within(await screen.findByRole('menu')).getAllByRole('menuitem')[0]!);
    const sheet = await screen.findByTestId('finance-item-sheet', {}, { timeout: 5000 });
    await user.type(within(sheet).getByLabelText(t('financeDocuments.form.title')), 'Dodatok 2');
    await user.type(within(sheet).getByLabelText(t('financeDocuments.form.amount')), '0');
    await user.type(
      within(sheet).getByLabelText(t('financeDocuments.form.startsOn')),
      '2030-01-01',
    );
    await user.type(within(sheet).getByLabelText(t('financeDocuments.form.endsOn')), '2030-12-31');
    const master = within(sheet).getByLabelText(t('financeDocuments.contracts.master'), {
      exact: false,
    });
    // A contract under a master is no choice.
    await waitFor(() => expect(within(master).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(master, 'm1');
    const schedule = within(sheet).getByTestId('schedule-field');
    await user.selectOptions(
      within(schedule).getByLabelText(t('financeDocuments.contracts.frequencyLabel')),
      'monthly',
    );
    await user.click(
      within(sheet).getByRole('button', { name: t('financeDocuments.sheet.create') }),
    );
    expect(
      within(sheet).getByText(t('financeDocuments.contracts.errors.amount')),
    ).toBeInTheDocument();
    await user.type(
      within(schedule).getByLabelText(t('financeDocuments.contracts.perPeriod')),
      '600',
    );
    await user.type(
      within(schedule).getByLabelText(t('financeDocuments.contracts.scheduleStarts')),
      '2030-01-31',
    );
    await user.click(
      within(sheet).getByRole('button', { name: t('financeDocuments.sheet.create') }),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      amount: { amountMinor: 0, currency: 'EUR' },
      parentId: 'm1',
      schedule: {
        frequency: 'monthly',
        everyMonths: null,
        amountMinor: 60_000,
        startsOn: '2030-01-31',
        endsOn: null,
      },
    });
  });
});
