import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/i18n';
import { AdminSidebar } from './admin-shell';
import { writeCollapsed } from './sidebar-collapse';
import { renderWithRouter } from './test-router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
}));

const t = (key: string) => i18n.t(key);
const SIDEBAR = [
  {
    groupId: 'g1',
    name: 'ABC s.r.o.',
    hasLogo: false,
    updatedAt: '2026-10-15T10:00:00.000Z',
    managed: true,
    unread: 2,
    unseenTasks: 1,
    unseenTickets: 0,
    nameRank: 1,
  },
];

function mockApi(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/me/home/sidebar') {
        return new Response(JSON.stringify(status === 200 ? SIDEBAR : { error: 'x' }), {
          status,
        });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

const renderSidebar = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    () => <AdminSidebar />,
    '/',
    (node: ReactNode) => <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
};

describe('AdminSidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    writeCollapsed(false);
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('collapse is remembered', async () => {
    mockApi();
    const first = await renderSidebar();
    await screen.findByRole('link', { name: /ABC/ });
    const button = screen.getByRole('button', { name: t('adminHome.sidebar.collapse') });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: t('adminHome.sidebar.expand') })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('searchbox')).toBeNull();
    first.unmount();
    await renderSidebar();
    expect(
      await screen.findByRole('button', { name: t('adminHome.sidebar.expand') }),
    ).toBeInTheDocument();
  });

  it('localStorage throwing still renders expanded', async () => {
    mockApi();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderSidebar();
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('adminHome.sidebar.collapse') }));
    expect(screen.getByRole('button', { name: t('adminHome.sidebar.expand') })).toBeInTheDocument();
  });

  it('an error shows the retry line only in the sidebar', async () => {
    mockApi(500);
    await renderSidebar();
    expect(await screen.findByRole('alert')).toHaveTextContent(t('adminHome.shell.loadError'));
    expect(screen.getByRole('button', { name: t('adminHome.shell.retry') })).toBeInTheDocument();
  });
});
