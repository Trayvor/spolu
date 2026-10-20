import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me, NotificationGroupsPage, NotificationModes } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { ClientTable } from './client-table';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const ADMIN: Me = {
  id: 'a1',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const MODES: NotificationModes = {
  defaultMode: null,
  roleDefault: 'mentions',
  overrides: { g1: 'all' },
  managerSet: ['g1'],
  adminGroupId: 'team',
};
const PAGE: NotificationGroupsPage = {
  managed: [{ id: 'g1', name: 'Alfa', kind: 'client', managed: true, watching: true }],
  items: [
    { id: 'g2', name: 'Beta', kind: 'client', managed: false, watching: false },
    { id: 'team', name: 'eGrant tím', kind: 'admin', managed: false, watching: null },
  ],
  nextCursor: null,
};

function setup(page: NotificationGroupsPage = PAGE, me: Me = ADMIN) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${String(init.body)}` : ''}`);
    if (url.startsWith('/api/me/notification-groups')) {
      const q = new URL(url, 'http://x').searchParams.get('q');
      if (q) return json({ managed: [], items: [], nextCursor: null });
      return json(page);
    }
    if (url === '/api/notifications/modes') return json(MODES);
    if (init?.method === 'PUT') return new Response(null, { status: 204 });
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, me);
  render(
    <QueryClientProvider client={queryClient}>
      <ClientTable admin={me.role !== 'client'} />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

describe('the client table of /settings/notifications', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the managed clients first, each with its mode and new tickets', async () => {
    setup();
    const managed = await screen.findByRole('heading', {
      name: 'Clients you are the account owner of',
    });
    expect(within(managed.closest('section')!).getByText('Alfa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other clients' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Alfa Mode' })).toHaveValue('all'),
    );
    expect(screen.getByRole('combobox', { name: 'Beta Mode' })).toHaveValue('mentions');
    expect(screen.getByRole('checkbox', { name: 'New tickets of Alfa: notify me' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'New tickets of Beta: notify me' }),
    ).not.toBeChecked();
    // The admin group has no tickets.
    expect(screen.queryByRole('checkbox', { name: /eGrant tím/ })).toBeNull();
    expect(screen.getByRole('button', { name: /All clients/ })).toBeInTheDocument();
  });

  it('saves a mode and new tickets at once', async () => {
    const { calls, user } = setup();
    const beta = await screen.findByRole('combobox', { name: 'Beta Mode' });
    await waitFor(() => expect(beta).toHaveValue('mentions'));
    await user.selectOptions(beta, 'off');
    await waitFor(() =>
      expect(calls).toContain('PUT /api/groups/g2/notification-mode {"mode":"off"}'),
    );
    const box = screen.getByRole('checkbox', { name: 'New tickets of Beta: notify me' });
    await user.click(box);
    await waitFor(() =>
      expect(calls).toContain('PUT /api/groups/g2/ticket-watch {"watching":true}'),
    );
    await waitFor(() => expect(box).toBeChecked());
  });

  it('searches, and says when nothing matches', async () => {
    const { calls, user } = setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search clients' }), 'zz');
    await waitFor(() => expect(calls).toContain('GET /api/me/notification-groups?q=zz'));
    expect(await screen.findByText('No client matches the search.')).toBeInTheDocument();
  });

  it('a client sees their groups, without search or "All clients"', async () => {
    const me: Me = { ...ADMIN, role: 'client' };
    setup(
      {
        managed: [],
        items: [{ id: 'g1', name: 'Alfa', kind: 'client', managed: false, watching: true }],
        nextCursor: null,
      },
      me,
    );
    expect(await screen.findByRole('heading', { name: 'Your clients' })).toBeInTheDocument();
    expect(await screen.findByText('Alfa')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Other clients' })).toBeNull();
  });
});
