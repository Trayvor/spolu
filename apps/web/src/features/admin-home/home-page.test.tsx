import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AdminEvents,
  TicketEvents,
  type AssignedTask,
  type HomeTicket,
  type Me,
  type MentionItem,
} from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { HomePage } from './home-page';
import { renderWithRouter } from './test-router';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  connected: true,
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
  emit: vi.fn(),
};
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const task = (over: Partial<AssignedTask> & { id: string; title: string }): AssignedTask => ({
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  urgent: false,
  dueDate: null,
  bucketKind: 'todo',
  ...over,
});

const mention = (over: Partial<MentionItem> & { messageId: string }): MentionItem => ({
  channelId: 'c1',
  taskId: null,
  ticketId: null,
  parentId: null,
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  authorName: 'Jana',
  excerpt: '@Vlad can you check',
  createdAt: '2026-10-16T08:00:00.000Z',
  ...over,
});

const ticket = (over: Partial<HomeTicket> & { id: string; number: number }): HomeTicket => ({
  subject: 'Budget question',
  excerpt: null,
  status: 'in_progress',
  groupId: 'g1',
  groupName: 'ABC s.r.o.',
  dueDate: null,
  createdAt: '2026-10-16T08:00:00.000Z',
  hasAssignee: false,
  ...over,
});

type Answers = Partial<
  Record<'tasks' | 'tickets' | 'mentions' | 'reminders' | 'sidebar', unknown>
> & {
  fail?: string[];
};

const calls: string[] = [];
function mockApi(answers: Answers = {}) {
  calls.length = 0;
  const defaults: Record<string, unknown> = {
    tasks: {
      total: 37,
      urgent: 5,
      items: [
        task({ id: 't1', title: 'Fix budget table', urgent: true, dueDate: '2026-10-01' }),
        task({ id: 't2', title: 'Upload invoices', dueDate: '2999-10-22', groupId: 'g2' }),
        task({ id: 't3', title: 'Report', groupName: 'Krok' }),
      ],
    },
    tickets: {
      total: 25,
      fresh: 2,
      noAssignee: 1,
      items: [
        ticket({ id: 'k1', number: 41, status: 'new', subject: 'Login fails' }),
        ticket({
          id: 'k2',
          number: 42,
          status: 'new',
          subject: null,
          excerpt: 'Where is the form',
          groupId: null,
          groupName: null,
        }),
        ticket({ id: 'k3', number: 7, dueDate: '2026-10-01' }),
      ],
    },
    mentions: {
      total: 3,
      items: [
        mention({ messageId: 'm1' }),
        mention({ messageId: 'm2', parentId: 'r1' }),
        mention({ messageId: 'm3', taskId: 'tk1', channelId: 'tc1' }),
      ],
    },
    reminders: {
      available: true,
      nextWeek: 3,
      items: [
        {
          id: 'rt1',
          at: '2026-10-21T07:00:00.000Z',
          title: 'Call the auditor',
          groupId: 'g1',
          groupName: 'ABC s.r.o.',
          target: { kind: 'knowledge', itemId: 'k1' },
        },
      ],
    },
    sidebar: [
      {
        groupId: 'g1',
        name: 'ABC s.r.o.',
        hasLogo: false,
        updatedAt: '2026-10-15T10:00:00.000Z',
        managed: true,
        unread: 4,
        assigned: 2,
      },
      {
        groupId: 'g2',
        name: 'Obec Lúky',
        hasLogo: false,
        updatedAt: '2026-10-15T10:00:00.000Z',
        managed: false,
        unread: 0,
        assigned: 0,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const name = url.replace('/api/me/home/', '');
      if (answers.fail?.includes(name)) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      if (name in defaults) {
        return new Response(JSON.stringify(answers[name as keyof Answers] ?? defaults[name]), {
          status: 200,
        });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

let wide = true;
const original = window.matchMedia;

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = {
    id: 'a1',
    name: 'Vlad Herasymenko',
    email: 'v@x.sk',
    role: 'admin',
    groups: [],
  };
  queryClient.setQueryData(sessionQuery.queryKey, me);
  return renderWithRouter(
    () => <HomePage />,
    '/',
    (node: ReactNode) => <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

describe('HomePage', () => {
  beforeEach(async () => {
    await setLanguage('en');
    handlers.clear();
    window.matchMedia = vi.fn(() => ({
      matches: wide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    wide = true;
  });

  it('greets by first name', async () => {
    mockApi();
    await renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Vlad$/);
  });

  it('assigned rows link to the task; overdue date uses error ink; Show all 37 links to the global board with assignee=me and all clients', async () => {
    mockApi();
    await renderHome();
    const card = await screen.findByRole('region', { name: t('adminHome.cards.assigned.title') });
    const row = await within(card).findByRole('link', { name: /Fix budget table/ });
    expect(row).toHaveAttribute('href', '/groups/g1/tasks/t1');
    expect(within(row).getByText(t('adminHome.cards.urgent'))).toBeInTheDocument();
    expect(within(row).getByText('1 Oct')).toHaveClass('text-error-ink');
    expect(within(card).getByText('22 Oct')).not.toHaveClass('text-error-ink');
    expect(within(card).getByText(t('adminHome.cards.assigned.noDate'))).toHaveClass(
      'text-muted-foreground',
    );
    expect(within(card).getByText('37')).toBeInTheDocument();
    expect(within(card).getByText('5 urgent')).toBeInTheDocument();
    const all = await within(card).findByRole('link', { name: 'Show all 37' });
    await waitFor(() => expect(all).toHaveAttribute('href', '/tasks?assignee=me&clients=all'));
  });

  it('the Tickets card comes first: rows link to the ticket, New is marked, no client is named', async () => {
    mockApi();
    await renderHome();
    const card = await screen.findByRole('region', { name: t('adminHome.cards.tickets.title') });
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    expect(regions[0]).toBe(card.getAttribute('aria-labelledby'));
    const first = await within(card).findByRole('link', { name: /Login fails/ });
    expect(first).toHaveAttribute('href', '/tickets/k1');
    expect(first).toHaveTextContent('#41');
    expect(within(first).getByText(t('adminHome.cards.tickets.new'))).toBeInTheDocument();
    const noClient = within(card).getByRole('link', { name: /Where is the form/ });
    expect(noClient).toHaveTextContent(t('adminHome.cards.tickets.noClient'));
    const progress = within(card).getByRole('link', { name: /#7/ });
    expect(within(progress).queryByText(t('adminHome.cards.tickets.new'))).toBeNull();
    expect(within(progress).getByText('1 Oct')).toHaveClass('text-error-ink');
    expect(within(card).getByText('25')).toBeInTheDocument();
    expect(within(card).getByText('2 new')).toBeInTheDocument();
    expect(within(card).getByText('1 without assignee')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Show all tickets' })).toHaveAttribute(
      'href',
      '/tickets',
    );
    // The tasks card is now named for what it holds.
    expect(
      screen.getByRole('region', { name: t('adminHome.cards.assigned.title') }),
    ).toHaveTextContent('My tasks');
  });

  it('a ticket event refetches the Tickets card after 2 s', async () => {
    mockApi();
    await renderHome();
    await screen.findByRole('link', { name: /Login fails/ });
    const count = () => calls.filter((u) => u === '/api/me/home/tickets').length;
    const before = count();
    vi.useFakeTimers();
    act(() =>
      handlers.get(TicketEvents.updated)?.forEach((fn) => fn({ ticketId: 'k1', groupId: 'g1' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    vi.useRealTimers();
    await waitFor(() => expect(count()).toBe(before + 1));
  });

  it('mentions link to the message, with the thread for a reply and the task chat for a task message', async () => {
    mockApi();
    await renderHome();
    const card = await screen.findByRole('region', { name: t('adminHome.cards.mentions.title') });
    const links = await within(card).findAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/groups/g1/chat?message=m1&c=c1',
      '/groups/g1/chat?thread=r1&message=m2&c=c1',
      '/groups/g1/tasks/tk1?tab=chat&message=m3&c=tc1',
    ]);
    expect(links[0]).toHaveTextContent('Jana');
    expect(links[0]).toHaveTextContent('@Vlad can you check');
  });

  it('a reminder links to its knowledge item', async () => {
    mockApi();
    await renderHome();
    const card = await screen.findByRole('region', { name: t('adminHome.cards.reminders.title') });
    expect(await within(card).findByRole('link', { name: /Call the auditor/ })).toHaveAttribute(
      'href',
      '/groups/g1/knowledge?k=k1',
    );
  });

  it('reminders card absent with available false; mentions spans the row', async () => {
    mockApi({ reminders: { available: false } });
    await renderHome();
    const mentions = await screen.findByRole('region', {
      name: t('adminHome.cards.mentions.title'),
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: t('adminHome.cards.reminders.title') }),
      ).toBeNull(),
    );
    expect(mentions.parentElement).toHaveClass('grid-cols-1');
  });

  it('one failing card does not hide the others', async () => {
    mockApi({ fail: ['mentions'] });
    await renderHome();
    const broken = await screen.findByRole('region', { name: t('adminHome.cards.mentions.title') });
    expect(await within(broken).findByRole('alert')).toHaveTextContent(
      t('adminHome.shell.loadError'),
    );
    expect(await screen.findByRole('link', { name: /Fix budget table/ })).toBeInTheDocument();
  });

  it('under 1024 px: four tiles, a tile opens its sheet, and the client list follows', async () => {
    wide = false;
    mockApi();
    await renderHome();
    const tiles = await screen.findAllByRole('button', { name: /:/ });
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toHaveTextContent(t('adminHome.cards.tickets.title'));
    expect(tiles[1]).toHaveTextContent(t('adminHome.cards.assigned.title'));
    expect(screen.queryByRole('region', { name: t('adminHome.cards.assigned.title') })).toBeNull();
    expect(await screen.findByRole('link', { name: /Obec Lúky/ })).toHaveClass('h-12');
    await waitFor(() => expect(tiles[3]).toHaveAccessibleName(/Mentions: 3 unread/));
    await userEvent.click(tiles[3]!);
    const sheet = await screen.findByRole('dialog', { name: t('adminHome.cards.mentions.title') });
    expect(within(sheet).getAllByRole('link')).toHaveLength(3);
    await userEvent.click(within(sheet).getByRole('button', { name: t('adminHome.cards.back') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('three tiles without reminders', async () => {
    wide = false;
    mockApi({ reminders: { available: false } });
    await renderHome();
    await screen.findByRole('link', { name: /Obec Lúky/ });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /:/ })).toHaveLength(3));
  });

  it('an admin:activity refetches the cards after 2 s', async () => {
    mockApi();
    await renderHome();
    await screen.findByRole('link', { name: /Fix budget table/ });
    const before = calls.filter((u) => u === '/api/me/home/tasks').length;
    vi.useFakeTimers();
    act(() =>
      handlers.get(AdminEvents.activity)?.forEach((fn) => fn({ groupId: 'g1', kind: 'task' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(calls.filter((u) => u === '/api/me/home/tasks').length).toBe(before);
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    await waitFor(() =>
      expect(calls.filter((u) => u === '/api/me/home/tasks').length).toBe(before + 1),
    );
    expect(calls.filter((u) => u === '/api/me/home/mentions').length).toBeGreaterThan(1);
  });
});
