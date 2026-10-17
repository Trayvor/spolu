import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { FinanceFolder, FinanceItem } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import type { ItemSheetTarget } from './documents/item-sheet';

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false };
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));
vi.mock('@/features/chat/chat-tab-badge', () => ({ ChatTabBadge: () => null }));
vi.mock('@/features/tasks/tasks-tab-badge', () => ({ TasksTabBadge: () => null }));

// The sheet has its own tests (the form's); here it shows its target and its callbacks.
vi.mock('./documents/item-sheet', () => ({
  ItemSheet: ({
    target,
    onClose,
  }: {
    target: ItemSheetTarget;
    onClose: (createdId?: string) => void;
  }) => (
    <div role="dialog" aria-label="finance-sheet">
      <p>{target.mode === 'view' ? `view:${target.id}` : `create:${target.type}`}</p>
      <button onClick={() => onClose()}>sheet-close</button>
    </div>
  ),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = {
  id: 'a1',
  name: 'Eva',
  email: 'eva@example.com',
  role: 'admin',
  finance: true,
  groups: [],
};
const GROUP = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  inviteUrl: 'https://spolu.test/join/x',
};

const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const ITEMS: FinanceItem[] = [
  {
    id: 'c1',
    groupId: 'g1',
    type: 'contract',
    folderId: null,
    title: 'Údržba webu',
    contract: {
      contractNumber: 'Z-7',
      amount: { amountMinor: 1_200_000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: soon,
    },
    fileCount: 0,
    hasUpcomingReminder: true,
    createdBy: 'a1',
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  },
  {
    id: 'n1',
    groupId: 'g1',
    type: 'note',
    folderId: null,
    title: 'Poznámka k platbe',
    contract: null,
    fileCount: 2,
    hasUpcomingReminder: false,
    createdBy: 'a1',
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
  },
];
const FOLDERS: FinanceFolder[] = [
  { id: 'f1', groupId: 'g1', parentId: null, name: 'Zmluvy 2026', createdAt: '', updatedAt: '' },
];

function mockApi() {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/groups/g1') return reply(200, GROUP);
    if (url === '/api/groups/g1/finance/folders') return reply(200, FOLDERS);
    if (url.startsWith('/api/groups/g1/finance/items')) {
      const type = new URL(url, 'http://x').searchParams.get('type');
      return reply(200, { items: ITEMS.filter((i) => !type || i.type === type), nextCursor: null });
    }
    return reply(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTab(path = '/groups/g1/finance') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const card = async () =>
  (await screen.findByRole('heading', { name: t('finance.cards.documents') })).closest(
    'section',
  ) as HTMLElement;

describe('the Documents card', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists folders first, then items; a contract shows its number, period, amount and marks', async () => {
    mockApi();
    renderTab();
    const section = await card();
    await within(section).findByText('Údržba webu');
    const rows = [
      ...within(section).getAllByTestId('finance-folder-row'),
      ...within(section).getAllByTestId('finance-item-row'),
    ];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Zmluvy 2026'),
      expect.stringContaining('Údržba webu'),
      expect.stringContaining('Poznámka k platbe'),
    ]);
    const contract = rows[1]!;
    expect(contract).toHaveTextContent('Z-7');
    expect(contract).toHaveTextContent(/12,000\.00/);
    expect(contract).toHaveTextContent(t('financeDocuments.row.endingSoon'));
    expect(contract).toHaveTextContent(t('financeDocuments.row.noFile'));
    expect(within(contract).getByText(t('financeDocuments.row.reminder'))).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent(t('financeDocuments.row.files', { count: 2 }));
  });

  it('the type filter lists flat by kind', async () => {
    const fetchMock = mockApi();
    const { user } = renderTab();
    const section = await card();
    await within(section).findByText('Údržba webu');
    const pills = within(section).getByRole('group', { name: t('financeDocuments.card.filters') });
    await user.click(
      within(pills).getByRole('button', { name: t('financeDocuments.card.contracts') }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/finance/items?type=contract'),
      ).toBe(true),
    );
    await waitFor(() => expect(within(section).queryByText('Poznámka k platbe')).toBeNull());
    // No folders in a flat list.
    expect(within(section).queryByText('Zmluvy 2026')).toBeNull();
  });

  it('"New" offers Contract, Document, Note and Folder; a contract opens the sheet', async () => {
    mockApi();
    const { user } = renderTab();
    const section = await card();
    await user.click(within(section).getByRole('button', { name: t('financeDocuments.card.new') }));
    const menu = await screen.findByRole('menu');
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual([
      expect.stringContaining(t('financeDocuments.kinds.contract')),
      expect.stringContaining(t('financeDocuments.kinds.document')),
      expect.stringContaining(t('financeDocuments.kinds.note')),
      expect.stringContaining(t('financeDocuments.kinds.folder')),
    ]);
    await user.click(within(menu).getAllByRole('menuitem')[0]!);
    expect(await screen.findByText('create:contract')).toBeInTheDocument();
  });

  it('opens an item from ?item= (a notification link) and closes back', async () => {
    mockApi();
    const { router, user } = renderTab('/groups/g1/finance?item=c1');
    expect(await screen.findByText('view:c1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'sheet-close' }));
    await waitFor(() => expect(screen.queryByText('view:c1')).toBeNull());
    expect((router.state.location.search as Record<string, unknown>).item).toBeUndefined();
  });

  it('opening a folder shows its breadcrumbs', async () => {
    const fetchMock = mockApi();
    const { user } = renderTab();
    const section = await card();
    await within(section).findByText('Údržba webu');
    await user.click(within(section).getByTestId('finance-folder-row'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => u === '/api/groups/g1/finance/items?folder=f1'),
      ).toBe(true),
    );
    const crumbs = within(section).getByRole('navigation');
    expect(within(crumbs).getByText('Zmluvy 2026')).toHaveAttribute('aria-current', 'page');
  });
});
