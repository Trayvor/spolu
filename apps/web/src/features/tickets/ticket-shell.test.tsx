import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { RequestersList } from '@/features/groups/requesters-list';
import { ADMIN, REQUESTER, fakeSocket, item, mockTicketApi, reply } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const mine = (url: URL) =>
  url.pathname === '/api/tickets/mine'
    ? reply(200, { items: [item({ id: 'k1', subject: 'My problem' })], nextCursor: null })
    : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the ticket shell', () => {
  it('ziadatel-only user lands on /tickets and has only Tickets in the header', async () => {
    mockTicketApi(REQUESTER, [mine]);
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: t('tickets.mine.title') })).toBeVisible();
    expect(router.state.location.pathname).toBe('/tickets');
    expect(await screen.findByText('My problem')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    const links = within(header)
      .getAllByRole('link')
      .map((l) => l.textContent);
    // The brand link, then Tickets: no group, tasks or knowledge links.
    expect(links).toEqual([expect.stringContaining('Help'), t('nav.tickets')]);
  });

  it('admin header has Tickets next to Tasks', async () => {
    mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/tickets/global'
          ? reply(200, { items: [], nextCursor: null })
          : undefined,
    ]);
    renderAt('/tickets');
    await screen.findByRole('heading', { name: t('tickets.global.title') });
    const names = within(screen.getByRole('banner'))
      .getAllByRole('link')
      .map((l) => l.textContent);
    const tasks = names.indexOf(t('nav.tasks'));
    expect(tasks).toBeGreaterThan(-1);
    expect(names[tasks + 1]).toBe(t('nav.tickets'));
  });
});

describe('Requesters section', () => {
  it('lists ziadatel members with remove/restore for admins', async () => {
    const { calls } = mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/groups/g1/requesters'
          ? reply(200, [{ id: 'z1', name: 'Žofia', email: 'z@x.sk' }])
          : undefined,
      (url) =>
        url.pathname === '/api/groups/g1/requesters/removed'
          ? reply(200, [{ id: 'z2', name: 'Peter', email: 'p@x.sk' }])
          : undefined,
      (url, init) =>
        url.pathname.startsWith('/api/groups/g1/members/') && init?.method !== 'GET'
          ? reply(204)
          : undefined,
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RequestersList groupId="g1" admin />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: t('group.requesters.title') })).toBeVisible();
    expect(screen.getByText('Žofia')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('group.members.remove') }));
    await waitFor(() => expect(calls).toContain('DELETE /api/groups/g1/members/z1'));
    await userEvent.click(screen.getByText(t('group.requesters.removedTitle', { count: 1 })));
    await userEvent.click(screen.getByRole('button', { name: t('group.members.restore') }));
    await waitFor(() => expect(calls).toContain('POST /api/groups/g1/members/z2/restore'));
  });

  it('clients see the requesters without actions', async () => {
    mockTicketApi(REQUESTER, [
      (url) =>
        url.pathname === '/api/groups/g1/requesters'
          ? reply(200, [{ id: 'z1', name: 'Žofia', email: 'z@x.sk' }])
          : undefined,
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RequestersList groupId="g1" admin={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Žofia')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
