import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useRef } from 'react';
import type { Me, SearchResults } from '@spolu/shared';
import { SearchTrigger } from '@/components/search-trigger';
import { i18n } from '@/i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { quickActions, readRecent, resultSections } from './model';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ADMIN: Me = {
  id: 'a1',
  email: 'a@x.sk',
  name: 'Ad Min',
  role: 'admin',
  finance: false,
  groups: [],
};
const CLIENT: Me = {
  id: 'c1',
  email: 'c@x.sk',
  name: 'Jana',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Obec Lúky', role: 'client', hasLogo: false, updatedAt: '' }],
};

const RESULTS: SearchResults = {
  groups: [{ id: 'g1', name: 'Obec Lúky', kind: 'client' }],
  tickets: [
    {
      id: 'k1',
      number: 4821,
      subject: 'Chyba v žiadosti',
      status: 'new',
      groupId: 'g1',
      groupName: 'Obec Lúky',
    },
  ],
  tasks: [{ id: 't1', title: 'Rozpočet', done: false, groupId: 'g1', groupName: 'Obec Lúky' }],
  knowledge: [],
  projects: [],
};

const calls: string[] = [];

function stubApi(results: SearchResults = RESULTS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(`${url.pathname}${url.search}`);
      const body = url.pathname === '/api/search' ? results : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function Where() {
  const href = useRouterState({ select: (s) => s.location.href });
  return <output data-testid="where">{href}</output>;
}

/** A trapped panel under the palette, like the task panel on a phone. */
function TrappedPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, false);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Panel">
      <button type="button">Panel button</button>
    </div>
  );
}

function renderApp(user: Me, path = '/', panel = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['session'], user);
  const root = createRootRoute({
    component: () => (
      <>
        <SearchTrigger />
        {panel && <TrappedPanel />}
        <Where />
        <Outlet />
      </>
    ),
  });
  const page = (p: string) =>
    createRoute({ getParentRoute: () => root, path: p, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([
      page('/'),
      page('/settings'),
      page('/tasks'),
      page('/tickets'),
      page('/tickets/$ticketId'),
      page('/groups/$groupId/chat'),
      page('/groups/$groupId/tasks/$taskId'),
      page('/groups/$groupId/tasks/new'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the command palette', () => {
  it('opens with Cmd+K and Ctrl+K and closes with Escape', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(ADMIN);
    await screen.findByRole('button', { name: t('nav.search') });
    await user.keyboard('{Meta>}k{/Meta}');
    const box = await screen.findByRole('combobox', { name: t('search.title') });
    expect(box).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('keeps Tab inside the palette over a trapped panel (the focus-trap stack)', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(ADMIN, '/', true);
    await screen.findByRole('button', { name: t('nav.search') });
    await user.keyboard('{Control>}k{/Control}');
    const box = await screen.findByRole('combobox', { name: t('search.title') });
    const palette = box.closest('dialog')!;
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(palette.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('lists hits per type; the arrow keys move and Enter opens the active hit', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(ADMIN);
    await user.click(await screen.findByRole('button', { name: t('nav.search') }));
    const box = await screen.findByRole('combobox');
    await user.type(box, 'luky');
    const groups = await screen.findByRole('group', { name: t('search.sections.groups') });
    expect(within(groups).getByRole('option', { name: /Obec Lúky/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(calls).toContain('/api/search?q=luky');
    // Down: the ticket; Down: the task; Down wraps to the group; Up goes back to the task.
    await user.keyboard('{ArrowDown}');
    const ticket = screen.getByRole('option', { name: /Chyba v žiadosti/ });
    expect(ticket).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', ticket.id);
    expect(within(ticket).getByText('#4821')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('option', { name: /Rozpočet/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/groups/g1/tasks/t1'));
    expect(screen.queryByRole('combobox')).toBeNull();
    // The opened hit is a recent item now.
    expect(readRecent(ADMIN.id).map((i) => i.key)).toEqual(['task:t1']);
  });

  it('a click on a hit navigates to its screen', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(ADMIN);
    await user.click(await screen.findByRole('button', { name: t('nav.search') }));
    await user.type(await screen.findByRole('combobox'), '4821');
    await user.click(await screen.findByRole('option', { name: /Chyba v žiadosti/ }));
    await waitFor(() => expect(where()).toBe('/tickets/k1'));
  });

  it('empty, it shows recent items and the quick actions; "New task" inside a group', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(CLIENT, '/groups/g1/chat');
    await user.click(await screen.findByRole('button', { name: t('nav.search') }));
    const actions = await screen.findByRole('group', { name: t('search.sections.actions') });
    const names = within(actions)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names[0]).toBe(t('search.actions.newTask'));
    expect(names).toContain(t('nav.settings'));
    // No search request for an empty query.
    expect(calls.filter((c) => c.startsWith('/api/search'))).toEqual([]);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/groups/g1/tasks/new'));
  });

  it('says when nothing was found', async () => {
    stubApi({ groups: [], tickets: [], tasks: [], knowledge: [], projects: [] });
    const user = userEvent.setup();
    renderApp(CLIENT);
    await user.click(await screen.findByRole('button', { name: t('nav.search') }));
    await user.type(await screen.findByRole('combobox'), 'qqqq');
    expect(await screen.findByText(t('search.empty', { q: 'qqqq' }))).toBeInTheDocument();
  });
});

describe('the palette model', () => {
  it('links every hit to its screen; a person without a group is left out', () => {
    const sections = resultSections({
      ...RESULTS,
      knowledge: [{ id: 'n1', title: 'Pokyny', type: 'note', groupId: 'g1', groupName: 'Obec' }],
      projects: [
        {
          id: 'e1',
          kind: 'event',
          name: 'Kontrola',
          projectId: 'p1',
          projectName: 'Projekt',
          groupId: 'g1',
          groupName: 'Obec',
        },
      ],
      people: [
        {
          id: 'u1',
          name: 'Jana',
          email: 'j@x.sk',
          role: 'client',
          groupId: 'g1',
          groupName: 'Obec',
        },
        { id: 'u2', name: 'Bez', email: 'b@x.sk', role: 'client', groupId: null, groupName: null },
        { id: 'u3', name: 'Admin', email: 'a@x.sk', role: 'admin', groupId: null, groupName: null },
      ],
    });
    const links = Object.fromEntries(sections.flatMap((s) => s.items.map((i) => [i.key, i.link])));
    expect(links).toEqual({
      'group:g1': { to: '/groups/$groupId/chat', params: { groupId: 'g1' } },
      'ticket:k1': { to: '/tickets/$ticketId', params: { ticketId: 'k1' } },
      'task:t1': { to: '/groups/$groupId/tasks/$taskId', params: { groupId: 'g1', taskId: 't1' } },
      'knowledge:n1': {
        to: '/groups/$groupId/knowledge',
        params: { groupId: 'g1' },
        search: { k: 'n1' },
      },
      'event:e1': {
        to: '/groups/$groupId/overview',
        params: { groupId: 'g1' },
        search: { project: 'p1' },
      },
      'person:u1': { to: '/groups/$groupId/members', params: { groupId: 'g1' } },
      'person:u3': { to: '/admins' },
    });
  });

  it('admins get their sections as actions; clients Home and Settings', () => {
    expect(quickActions(ADMIN, undefined).map((a) => a.labelKey)).toContain('nav.bulkEmail');
    expect(quickActions(CLIENT, undefined).map((a) => a.labelKey)).toEqual([
      'nav.home',
      'nav.settings',
    ]);
  });
});
