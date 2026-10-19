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
import type { Me, MessageSearchPage, SearchMessageHit, SearchResults } from '@spolu/shared';
import { SearchTrigger } from '@/components/search-trigger';
import { i18n } from '@/i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import {
  messageItems,
  quickActions,
  readRecent,
  rememberRecent,
  resultSections,
  shortMessageDate,
} from './model';

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

const HIT: SearchMessageHit = {
  id: 'm1',
  channelId: 'c1',
  channelKind: 'group',
  parentId: null,
  groupId: 'g1',
  groupName: 'Obec Lúky',
  taskId: null,
  taskTitle: null,
  ticketId: null,
  ticketNumber: null,
  authorName: 'Peter',
  createdAt: '2026-10-19T08:00:00.000Z',
  snippet: 'Zmluva je v prílohe',
  highlights: [[0, 6]],
};
const hit = (id: string, extra: Partial<SearchMessageHit> = {}): SearchMessageHit => ({
  ...HIT,
  id,
  snippet: `Zmluva ${id}`,
  ...extra,
});
const NO_MESSAGES: MessageSearchPage = { hits: [], nextCursor: null, tooBroad: false };

/**
 * `/api/search` answers `results`; `/api/search/messages` the page for its cursor ('' for the
 * first), or a promise that never settles while `messages` is 'pending'.
 */
function stubApi(
  results: SearchResults = RESULTS,
  messages: Record<string, MessageSearchPage> | 'pending' = { '': NO_MESSAGES },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/search/messages') {
        if (messages === 'pending') return new Promise<Response>(() => {});
        const page = messages[url.searchParams.get('cursor') ?? ''] ?? NO_MESSAGES;
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
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
    expect(calls).toContain(
      '/api/search?q=luky&types=groups,tickets,tasks,knowledge,projects,people',
    );
    expect(calls).toContain('/api/search/messages?q=luky&limit=5');
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

describe('messages in the palette (2026-10-19)', () => {
  const openPalette = async (user: ReturnType<typeof userEvent.setup>, q: string) => {
    await user.click(await screen.findByRole('button', { name: t('nav.search') }));
    const box = await screen.findByRole('combobox');
    await user.type(box, q);
    return box;
  };

  it('lists message hits last with highlighted fragments; Enter opens the chat at the message', async () => {
    stubApi(
      { groups: [], tickets: [], tasks: [], knowledge: [], projects: [] },
      { '': { ...NO_MESSAGES, hits: [HIT] } },
    );
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'zmluva');
    const section = await screen.findByRole('group', { name: t('search.sections.messages') });
    const option = within(section).getByRole('option');
    expect(option.querySelector('mark')?.textContent).toBe('Zmluva');
    expect(option.textContent).toContain('Peter · Obec Lúky');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/groups/g1/chat?message=m1&c=c1'));
  });

  it('message hits are not remembered among recent items', async () => {
    stubApi(RESULTS, { '': { ...NO_MESSAGES, hits: [HIT] } });
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'zmluva');
    const section = await screen.findByRole('group', { name: t('search.sections.messages') });
    await user.click(within(section).getByRole('option'));
    await waitFor(() => expect(where()).toContain('message=m1'));
    expect(readRecent(ADMIN.id)).toEqual([]);
    rememberRecent(ADMIN.id, messageItems([HIT], t, 'sk')[0]!);
    expect(readRecent(ADMIN.id)).toEqual([]);
  });

  it('"Zobraziť ďalšie správy" loads the next page into the section', async () => {
    const first = [1, 2, 3, 4, 5].map((i) => hit(`a${i}`));
    stubApi(
      { groups: [], tickets: [], tasks: [], knowledge: [], projects: [] },
      {
        '': { hits: first, nextCursor: 'n1', tooBroad: false },
        n1: { hits: [hit('b1'), hit('b2')], nextCursor: null, tooBroad: false },
      },
    );
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'zmluva');
    const more = await screen.findByRole('option', { name: t('search.messages.more') });
    // The more row is an option: the arrow keys reach it, Enter runs it.
    for (let i = 0; i < 5; i++) await user.keyboard('{ArrowDown}');
    expect(more).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    const section = screen.getByRole('group', { name: t('search.sections.messages') });
    await waitFor(() => expect(within(section).getAllByRole('option')).toHaveLength(7));
    expect(calls).toContain('/api/search/messages?q=zmluva&limit=20&cursor=n1');
    // The last page: no more row; the first new hit is selected; the palette stays open.
    expect(screen.queryByRole('option', { name: t('search.messages.more') })).toBeNull();
    expect(within(section).getByRole('option', { name: /Zmluva b1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('says "V správach sa hľadá od 3 znakov." for two-letter terms and sends no message request', async () => {
    stubApi();
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'ab');
    expect(await screen.findByText(t('search.messages.minLength'))).toBeInTheDocument();
    await screen.findByRole('group', { name: t('search.sections.groups') });
    expect(calls.filter((c) => c.startsWith('/api/search/messages'))).toEqual([]);
  });

  it('says "Príliš veľa správ. Spresnite hľadanie." on tooBroad', async () => {
    stubApi(RESULTS, { '': { hits: [], nextCursor: null, tooBroad: true } });
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'dobry den');
    expect(await screen.findByText(t('search.messages.tooBroad'))).toBeInTheDocument();
  });

  it('the other sections render while messages are still loading', async () => {
    stubApi(RESULTS, 'pending');
    const user = userEvent.setup();
    renderApp(ADMIN);
    await openPalette(user, 'luky');
    const groups = await screen.findByRole('group', { name: t('search.sections.groups') });
    expect(within(groups).getByRole('option', { name: /Obec Lúky/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: t('search.sections.messages') })).toBeNull();
  });
});

describe('the palette model: messages', () => {
  it('a reply opens its thread; a task chat hit the task panel; a ticket chat the ticket', () => {
    const [reply, task, ticket] = messageItems(
      [
        hit('r1', { parentId: 'root' }),
        hit('t1', { channelKind: 'task', taskId: 'task1', taskTitle: 'Rozpočet' }),
        hit('k1', { channelKind: 'ticket', ticketId: 'tk1', ticketNumber: 42, authorName: null }),
      ],
      t,
      'sk',
    );
    expect(reply!.link).toEqual({
      to: '/groups/$groupId/chat',
      params: { groupId: 'g1' },
      search: { thread: 'root', message: 'r1', c: 'c1' },
    });
    expect(reply!.detail).toContain(`Obec Lúky · ${t('search.messages.thread')}`);
    expect(task!.link).toEqual({
      to: '/groups/$groupId/tasks/$taskId',
      params: { groupId: 'g1', taskId: 'task1' },
      search: { tab: 'chat', message: 't1', c: 'c1' },
    });
    expect(task!.detail).toContain(t('search.messages.task', { title: 'Rozpočet' }));
    expect(ticket!.link).toMatchObject({ to: '/tickets/$ticketId', params: { ticketId: 'tk1' } });
    expect(ticket!.detail?.startsWith(t('search.messages.deletedAuthor'))).toBe(true);
    expect(ticket!.detail).toContain(t('search.messages.ticket', { number: 42 }));
    expect(task!.highlights).toEqual([[0, 6]]);
  });

  it('the short date: today the time, yesterday the word, else the date', () => {
    const now = new Date(2026, 9, 19, 15, 0);
    expect(shortMessageDate(new Date(2026, 9, 19, 9, 5).toISOString(), 'sk', now)).toMatch(
      /9:05|09:05/,
    );
    expect(shortMessageDate(new Date(2026, 9, 18, 23, 0).toISOString(), 'sk', now)).toBe('včera');
    expect(shortMessageDate(new Date(2026, 9, 1).toISOString(), 'sk', now)).not.toMatch(/2026/);
    expect(shortMessageDate(new Date(2025, 9, 1).toISOString(), 'sk', now)).toMatch(/2025/);
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
