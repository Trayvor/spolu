import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { GROUPS_PAGE_SIZE } from './groups-page';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ADMIN = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const ACME = {
  id: 'g1',
  name: 'Acme',
  hasLogo: true,
  memberCount: 3,
  updatedAt: '2026-10-15T10:00:00.000Z',
  managers: [
    { id: 'a1', name: 'Jana' },
    { id: 'a2', name: 'Peter Novak' },
    { id: 'a3', name: 'Zora' },
    { id: 'a4', name: 'Zuzana' },
    { id: 'a5', name: 'Zdeno' },
  ],
  managedByMe: true,
};
const BETA = {
  id: 'g2',
  name: 'beta',
  hasLogo: false,
  memberCount: 0,
  updatedAt: '2026-10-15T11:00:00.000Z',
  managers: [],
  managedByMe: false,
};

const ADMINS = [
  { id: 'a1', name: 'Jana', email: 'jana@example.com', role: 'superadmin' },
  { id: 'a2', name: 'Peter Novak', email: 'peter@example.com', role: 'admin' },
  { id: 'a6', name: 'Bara', email: 'bara@example.com', role: 'admin' },
];

const MODES = { defaultMode: null, roleDefault: 'mentions', overrides: {}, managerSet: [] };

function mockApi(
  groups: unknown[],
  listStatus = 200,
  initialModes: unknown = MODES,
  defaultPutStatus = 200,
) {
  let modes = initialModes;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url === '/api/me') return reply(200, ADMIN);
    if (url === '/api/notifications/modes' && !init?.method) return reply(200, modes);
    if (url === '/api/notifications/modes/default' && init?.method === 'PUT') {
      if (defaultPutStatus !== 200) return reply(defaultPutStatus, { error: 'internal' });
      const { mode } = JSON.parse(init.body as string) as { mode: string };
      modes = { ...MODES, defaultMode: mode, overrides: {} };
      return reply(200, modes);
    }
    if (url === '/api/chat/unread') return reply(200, { g1: 4, g2: 0 });
    if (url === '/api/admins') return reply(200, ADMINS);
    if (url === '/api/groups' && (init?.method ?? 'GET') === 'GET')
      return reply(listStatus, listStatus === 200 ? groups : { error: 'internal' });
    if (url === '/api/groups' && init?.method === 'POST') {
      return reply(201, {
        id: 'g3',
        name: 'New',
        egrantUrl: 'https://new.egrant.sk',
        hasLogo: false,
        updatedAt: '2026-10-15T12:00:00.000Z',
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderGroups(url = '/groups') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, user: userEvent.setup() };
}

describe('groups page', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('the admin group is pinned above the list, without managers or members (Phase 34)', async () => {
    const team = {
      ...BETA,
      id: 'team',
      name: 'eGrant tím',
      kind: 'admin',
      managers: [],
      memberCount: 0,
    };
    mockApi([ACME, BETA, team]);
    renderGroups();
    const pinned = await screen.findByText('eGrant tím');
    const card = pinned.closest('[data-admin-group]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByRole('link', { name: /eGrant tím/ })).toHaveAttribute(
      'href',
      '/groups/team',
    );
    expect(within(card).queryByText(t('groups.members', { count: 0 }))).toBeNull();
    expect(within(card).queryByRole('button', { name: t('groups.managers.manage') })).toBeNull();
    expect(card.querySelector('[data-egrant-mark]')).not.toBeNull();
    // It is no client: the count and the list are the two client groups.
    expect(document.querySelector('[data-group-count]')).toHaveTextContent('2');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).not.toContainEqual(
      expect.stringContaining('eGrant tím'),
    );
  });

  it('lists groups with logo or placeholder and member count', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const acme = await screen.findByRole('link', { name: /Acme/ });
    expect(acme).toHaveAttribute('href', '/groups/g1');
    expect(acme.closest('li')).toHaveTextContent(t('groups.members', { count: 3 }));
    // Logo URL carries the version for cache-busting.
    expect(acme.querySelector('img')).toHaveAttribute(
      'src',
      '/api/groups/g1/logo?v=2026-10-15T10%3A00%3A00.000Z',
    );
    const beta = screen.getByRole('link', { name: /beta/ });
    expect(beta.querySelector('img')).toBeNull();
    expect(beta).toHaveTextContent('B'); // first-letter placeholder
  });

  it('shows the unread chat count of each group, nothing at 0', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const acme = await screen.findByRole('link', { name: /Acme/ });
    await waitFor(() => expect(acme).toHaveTextContent(t('chat.unread', { count: 4 })));
    expect(screen.getByRole('link', { name: /beta/ })).not.toHaveTextContent(
      t('chat.unread', { count: 0 }),
    );
  });

  it('shows the empty state', async () => {
    mockApi([]);
    renderGroups();
    expect(await screen.findByText(t('groups.empty'))).toBeInTheDocument();
  });

  it('shows a generic error with a retry button when the list fails', async () => {
    const fetchMock = mockApi([ACME], 500);
    const { user } = renderGroups();
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();
    const listCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/groups').length;
    const before = listCalls();
    await user.click(screen.getByRole('button', { name: t('errors.retry') }));
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  it('Create group opens the inline form; saving closes it and refreshes the list', async () => {
    const fetchMock = mockApi([ACME]);
    const { user } = renderGroups();
    await user.click(await screen.findByRole('button', { name: t('groups.create') }));
    await user.type(screen.getByLabelText(t('groups.form.name')), 'New');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://new.egrant.sk');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() =>
      expect(screen.queryByLabelText(t('groups.form.name'))).not.toBeInTheDocument(),
    );
    const lists = fetchMock.mock.calls.filter(
      ([u, i]) => u === '/api/groups' && !(i as RequestInit | undefined)?.method,
    );
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });

  it('each row has a bell outside the link', async () => {
    mockApi([ACME, BETA]);
    const { user } = renderGroups();
    const acme = await screen.findByRole('link', { name: /Acme/ });
    const bells = await screen.findAllByRole('button', {
      name: t('notifications.mode.bellLabel', { mode: t('notifications.mode.mentions') }),
    });
    expect(bells).toHaveLength(2);
    expect(acme.contains(bells[0] ?? null)).toBe(false);
    await user.click(bells[0] as HTMLElement);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Acme/, hidden: true })).toBeInTheDocument(); // still on /groups
    expect(
      screen.getByRole('heading', { name: t('groups.title'), hidden: true }),
    ).toBeInTheDocument();
  });

  it('All groups shows Mixed when groups differ', async () => {
    mockApi([ACME, BETA], 200, { ...MODES, overrides: { g1: 'off' } });
    renderGroups();
    expect(
      await screen.findByRole('button', {
        name: `${t('notifications.mode.allGroups')} ${t('notifications.mode.mixed')}`,
      }),
    ).toHaveTextContent(t('notifications.mode.mixed'));
  });

  it('choosing in All groups sets every row', async () => {
    const fetchMock = mockApi([ACME, BETA], 200, { ...MODES, overrides: { g1: 'off' } });
    const { user } = renderGroups();
    await user.click(
      await screen.findByRole('button', { name: new RegExp(t('notifications.mode.allGroups')) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: /^All messages/ }));
    const allLabel = t('notifications.mode.bellLabel', { mode: t('notifications.mode.all') });
    await waitFor(() => expect(screen.getAllByRole('button', { name: allLabel })).toHaveLength(2));
    const put = fetchMock.mock.calls.find(([u]) => u === '/api/notifications/modes/default');
    expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({ mode: 'all' });
  });

  it('a failing All groups save rolls back to Mixed and shows the error', async () => {
    mockApi([ACME, BETA], 200, { ...MODES, overrides: { g1: 'off' } }, 500);
    const { user } = renderGroups();
    await user.click(
      await screen.findByRole('button', { name: new RegExp(t('notifications.mode.allGroups')) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: /^All messages/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.generic'));
    expect(
      await screen.findByRole('button', {
        name: `${t('notifications.mode.allGroups')} ${t('notifications.mode.mixed')}`,
      }),
    ).toBeInTheDocument();
  });
  it('rows show up to 3 manager avatars and +N', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const acme = (await screen.findByRole('link', { name: /Acme/ })).closest('li') as HTMLElement;
    const list = within(acme).getByRole('list', {
      name: t('groups.managers.listLabel', { name: 'Acme' }),
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(acme.querySelectorAll('[data-manager-avatars] > span:first-child > span')).toHaveLength(
      3,
    );
    expect(acme).toHaveTextContent(t('groups.managers.more', { count: 2 }));
    // Phones show 2 avatars and +3.
    const avatars = acme.querySelectorAll('[data-manager-avatars] > span:first-child > span');
    expect(avatars[2]).toHaveClass('max-[640px]:hidden');
    expect(acme).toHaveTextContent(t('groups.managers.more', { count: 3 }));
    const controls = acme.querySelector('[data-manager-avatars]')?.parentElement;
    expect(controls).toHaveClass('flex-wrap', 'gap-y-1');
    expect(acme).toHaveTextContent('PN');
    const toggle = within(acme).getByRole('button', {
      name: t('groups.managers.toggleLabel', { name: 'Acme' }),
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('a row with no managers shows no avatars', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const beta = (await screen.findByRole('link', { name: /beta/ })).closest('li') as HTMLElement;
    expect(within(beta).queryByRole('list')).toBeNull();
    expect(beta.querySelector('[data-manager-avatars]')).toBeNull();
    expect(
      within(beta).getByRole('button', {
        name: t('groups.managers.toggleLabel', { name: 'beta' }),
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('the no-manager hint is shown', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    expect(await screen.findByText(t('groups.managers.noManagerHint'))).toBeInTheDocument();
  });

  it('the member count links to the Members tab', async () => {
    mockApi([ACME, BETA]);
    renderGroups();
    const link = await screen.findByRole('link', { name: t('groups.members', { count: 3 }) });
    expect(link).toHaveAttribute('href', '/groups/g1/members');
  });

  it('groups I manage come first, by name inside each part', async () => {
    const cyan = { ...BETA, id: 'g3', name: 'Cyan', managedByMe: true, managers: [ADMINS[0]] };
    mockApi([ACME, BETA, cyan]);
    renderGroups();
    await screen.findByRole('link', { name: /Acme/ });
    const names = screen
      .getAllByRole('link', { name: /Acme|beta|Cyan/ })
      .filter((a) => /^\/groups\/g\d$/.test(a.getAttribute('href') ?? ''))
      .map((a) => a.textContent);
    expect(names.map((n) => n?.match(/Acme|beta|Cyan/)?.[0])).toEqual(['Acme', 'Cyan', 'beta']);
  });

  it('the title shows the count, and "shown of total" with a filter', async () => {
    mockApi([ACME, BETA]);
    const { unmount } = renderGroups();
    await screen.findByRole('link', { name: /Acme/ });
    expect(document.querySelector('[data-group-count]')).toHaveTextContent(/^2$/);
    unmount();
    renderGroups('/groups?manager=me');
    await screen.findByRole('link', { name: /Acme/ });
    expect(screen.queryByRole('link', { name: /beta/ })).toBeNull();
    expect(document.querySelector('[data-group-count]')).toHaveTextContent(
      t('groups.count.filtered', { shown: 1, total: 2 }),
    );
    expect(
      screen.getByRole('button', {
        name: t('groups.filter.label', { name: t('groups.filter.me') }),
      }),
    ).toBeInTheDocument();
  });

  it('picking an admin in the filter shows only the groups they manage', async () => {
    mockApi([ACME, BETA]);
    const { user, router } = renderGroups();
    await user.click(
      await screen.findByRole('button', {
        name: t('groups.filter.label', { name: t('groups.filter.all') }),
      }),
    );
    const menu = await screen.findByRole('menu');
    const options = within(menu)
      .getAllByRole('menuitemradio')
      .map((o) => o.textContent);
    expect(options).toEqual([
      t('groups.filter.all'),
      t('groups.filter.me'),
      t('groups.filter.none'),
      'Bara',
      'Peter Novak',
    ]);
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Peter Novak' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ manager: 'a2' }));
    expect(screen.getByRole('link', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /beta/ })).toBeNull();
  });

  it('an empty filtered list offers Clear filter, which clears the search', async () => {
    mockApi([ACME]);
    const { user, router } = renderGroups('/groups?manager=none');
    expect(await screen.findByText(t('groups.filter.empty'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Acme/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('groups.filter.clear') }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument();
  });

  it('the manager filter comes back on the next visit; Clear filter forgets it', async () => {
    mockApi([ACME]);
    renderGroups('/groups?manager=none');
    expect(await screen.findByText(t('groups.filter.empty'))).toBeInTheDocument();
    cleanup();
    mockApi([ACME]);
    const { user, router } = renderGroups('/groups');
    await waitFor(() => expect(router.state.location.search).toEqual({ manager: 'none' }));
    await user.click(await screen.findByRole('button', { name: t('groups.filter.clear') }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    cleanup();
    mockApi([ACME]);
    renderGroups('/groups');
    expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument();
  });

  it('an id that is not an active admin falls back to every group', async () => {
    mockApi([ACME, BETA]);
    const { router } = renderGroups('/groups?manager=gone');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole('link', { name: /beta/ })).toBeInTheDocument();
    expect(document.querySelector('[data-group-count]')).toHaveTextContent(/^2$/);
  });

  describe('a long list (2026-10-18)', () => {
    // 120 groups nobody manages, named so that they sort by number.
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...BETA,
      id: `m${i}`,
      name: `Client ${String(i).padStart(3, '0')}`,
    }));
    const rows = () => screen.queryAllByRole('link', { name: /Acme|Client \d{3}/ }).length;

    it('draws 50 rows; Show more adds 50 until every group is shown', async () => {
      mockApi([ACME, ...many]);
      const { user } = renderGroups();
      expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument();
      expect(document.querySelector('[data-group-count]')).toHaveTextContent(/^121$/);
      expect(rows()).toBe(GROUPS_PAGE_SIZE);
      expect(screen.queryByRole('link', { name: /Client 049/ })).toBeNull();
      await user.click(screen.getByRole('button', { name: t('groups.showMore', { left: 71 }) }));
      expect(rows()).toBe(100);
      expect(screen.getByRole('link', { name: /Client 098/ })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: t('groups.showMore', { left: 21 }) }));
      expect(rows()).toBe(121);
      expect(screen.getByRole('link', { name: /Client 119/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    });

    it('the filter covers every group and starts again at one page', async () => {
      mockApi([ACME, ...many]);
      const { user, router } = renderGroups();
      await user.click(
        await screen.findByRole('button', { name: t('groups.showMore', { left: 71 }) }),
      );
      expect(rows()).toBe(100);
      await user.click(
        screen.getByRole('button', {
          name: t('groups.filter.label', { name: t('groups.filter.all') }),
        }),
      );
      await user.click(await screen.findByRole('menuitemradio', { name: t('groups.filter.none') }));
      await waitFor(() => expect(router.state.location.search).toEqual({ manager: 'none' }));
      expect(document.querySelector('[data-group-count]')).toHaveTextContent(
        t('groups.count.filtered', { shown: 120, total: 121 }),
      );
      expect(rows()).toBe(GROUPS_PAGE_SIZE);
      expect(screen.queryByRole('link', { name: /Acme/ })).toBeNull();
      expect(
        screen.getByRole('button', { name: t('groups.showMore', { left: 70 }) }),
      ).toBeVisible();
    });

    it('Find a group searches every group, not only the rows drawn', async () => {
      mockApi([ACME, ...many]);
      const { user } = renderGroups();
      const find = await screen.findByRole('searchbox', { name: t('groups.find.label') });
      await user.type(find, 'client 11');
      // Client 110–119, far below the first page.
      expect(rows()).toBe(10);
      expect(screen.getByRole('link', { name: /Client 119/ })).toBeInTheDocument();
      expect(document.querySelector('[data-group-count]')).toHaveTextContent(
        t('groups.count.filtered', { shown: 10, total: 121 }),
      );
      expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
      await user.clear(find);
      await user.type(find, 'nothing like it');
      expect(screen.getByText(t('groups.find.noMatch'))).toBeInTheDocument();
      expect(rows()).toBe(0);
    });

    it('a row mounts its bell menu only on the first click', async () => {
      mockApi([ACME, BETA]);
      const { user } = renderGroups();
      const label = t('notifications.mode.bellLabel', { mode: t('notifications.mode.mentions') });
      const bells = await screen.findAllByRole('button', { name: label });
      expect(bells).toHaveLength(2);
      // Not yet a Radix trigger: no menu state on the buttons.
      for (const bell of bells) expect(bell).not.toHaveAttribute('data-state');
      await user.click(bells[1] as HTMLElement);
      // The click opened the real menu at once; only that row's bell became a Radix trigger.
      expect(await screen.findByRole('menu')).toBeInTheDocument();
      const after = screen.getAllByRole('button', { name: label, hidden: true });
      expect(after[0]).not.toHaveAttribute('data-state');
      expect(after[1]).toHaveAttribute('data-state', 'open');
    });
  });
});
