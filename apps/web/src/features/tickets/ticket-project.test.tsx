import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { TicketDto } from '@spolu/shared';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { filterFromSearch, validateTicketsSearch, writeFilter } from './search';
import { ADMIN, CLIENT, REQUESTER, fakeSocket, item, mockTicketApi, reply, ticket } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const PROJECT = { id: 'p1', name: 'Kultúra 2026', color: 'blue' as const };
const EVENT = { id: 'e1', name: 'Kickoff', occursOn: '2099-11-04' };
const pickerRoutes = [
  (url: URL) =>
    url.pathname === '/api/groups/g1/projects/picker'
      ? reply(200, [
          { ...PROJECT, status: 'active' },
          { id: 'p2', name: 'Šport', color: 'pink', status: 'active' },
        ])
      : undefined,
  (url: URL) =>
    url.pathname === '/api/projects/p1/events/picker'
      ? reply(200, [{ ...EVENT, source: 'manual' }])
      : undefined,
  (url: URL) =>
    url.pathname === '/api/groups/g1'
      ? reply(200, { id: 'g1', name: 'ABC s.r.o.', egrantUrl: '', hasLogo: false, updatedAt: '' })
      : undefined,
];

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

function ticketRoute(dto: () => TicketDto) {
  return (url: URL, init?: RequestInit) =>
    url.pathname === '/api/tickets/k1' && (init?.method ?? 'GET') === 'GET'
      ? reply(200, dto())
      : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a ticket’s project and event (Phase 33 part P2)', () => {
  it('a client sets the project, then the event; each saves at once', async () => {
    let current = ticket({ canAssign: true });
    const { calls, fetchMock } = mockTicketApi(CLIENT, [
      ...pickerRoutes,
      (url, init) => {
        if (url.pathname !== '/api/tickets/k1/project' || init?.method !== 'PUT') return undefined;
        const body = JSON.parse(String(init.body)) as { projectId: string; eventId: string | null };
        current = ticket({
          canAssign: true,
          project: body.projectId ? PROJECT : null,
          event: body.eventId ? EVENT : null,
        });
        return reply(200, current);
      },
      ticketRoute(() => current),
    ]);
    renderAt('/tickets/k1');
    await screen.findByText('Cannot submit the application', {}, { timeout: 5000 });
    const project = await screen.findByRole('combobox', { name: t('tickets.fields.project') });
    expect(screen.queryByRole('combobox', { name: t('tickets.fields.event') })).toBeNull();
    await userEvent.click(project);
    await screen.findByRole('option', { name: 'Kultúra 2026' });
    await userEvent.selectOptions(project, 'p1');
    await waitFor(() => expect(calls).toContain('PUT /api/tickets/k1/project'));
    const puts = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => init?.method === 'PUT' && String(url).endsWith('/tickets/k1/project'),
      );
    expect(JSON.parse(String(puts()[0]![1]!.body))).toEqual({ projectId: 'p1', eventId: null });
    const event = await screen.findByRole('combobox', { name: t('tickets.fields.event') });
    await userEvent.click(event);
    await screen.findByRole('option', { name: /Kickoff/ });
    await userEvent.selectOptions(event, 'e1');
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(JSON.parse(String(puts()[1]![1]!.body))).toEqual({ projectId: 'p1', eventId: 'e1' });
    await waitFor(() => expect(event).toHaveValue('e1'));
  });

  it('a žiadateľ sees the project’s name only, no select', async () => {
    mockTicketApi(REQUESTER, [
      ticketRoute(() =>
        ticket({ tasks: null, project: { ...PROJECT, color: null }, event: null }),
      ),
    ]);
    renderAt('/tickets/k1');
    expect(await screen.findByText('Kultúra 2026')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: t('tickets.fields.project') })).toBeNull();
  });

  it('a ticket without a client has no project field', async () => {
    mockTicketApi(ADMIN, [
      ticketRoute(() => ticket({ canAssign: true, groupId: null, groupName: null })),
    ]);
    renderAt('/tickets/k1');
    await screen.findByRole('heading', { name: t('tickets.noClient.title') });
    expect(screen.queryByRole('combobox', { name: t('tickets.fields.project') })).toBeNull();
  });
});

describe('the project filters of the ticket lists', () => {
  it('rows carry the project chip; the group tab filters by project and event in the URL', async () => {
    const { calls } = mockTicketApi(CLIENT, [
      ...pickerRoutes,
      (url) =>
        url.pathname === '/api/groups/g1/tickets'
          ? reply(200, {
              items: [item({ id: 'k1', project: PROJECT, event: EVENT })],
              nextCursor: null,
            })
          : undefined,
    ]);
    const router = renderAt('/groups/g1/tickets');
    const row = (await screen.findByText('Ticket k1')).closest('a')!;
    expect(within(row).getByText('Kultúra 2026, Kickoff')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: t('tickets.filters.project', { name: t('tickets.filters.anyProject') }),
      }),
    );
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Kultúra 2026' }));
    await waitFor(() => expect(calls).toContain('GET /api/groups/g1/tickets?project=p1'));
    expect(router.state.location.search).toMatchObject({ project: 'p1' });
    await userEvent.click(
      screen.getByRole('button', {
        name: t('tickets.filters.event', { name: t('tickets.filters.anyProject') }),
      }),
    );
    await userEvent.click(
      await screen.findByRole('menuitemradio', { name: t('tickets.filters.noEvent') }),
    );
    await waitFor(() =>
      expect(calls).toContain('GET /api/groups/g1/tickets?project=p1&event=none'),
    );
  });

  it('the global view shows the Project pill only with exactly one client, never Event', async () => {
    const { calls } = mockTicketApi(ADMIN, [
      ...pickerRoutes,
      (url) =>
        url.pathname === '/api/tickets/global' ? reply(200, { items: [], nextCursor: null }) : undefined,
    ]);
    renderAt('/tickets?clients=g1&project=p1');
    await screen.findByRole('heading', { name: t('tickets.global.title') });
    await waitFor(() => expect(calls).toContain('GET /api/tickets/global?project=p1&clients=g1'));
    expect(
      await screen.findByRole('button', {
        name: t('tickets.filters.project', { name: 'Kultúra 2026' }),
      }),
    ).toBeInTheDocument();
    const eventPrefix = t('tickets.filters.event', { name: '' });
    expect(screen.queryAllByRole('button').some((b) => b.textContent?.startsWith(eventPrefix))).toBe(
      false,
    );
  });

  it('the global view never sends a project without exactly one client', async () => {
    const { calls } = mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/tickets/global' ? reply(200, { items: [], nextCursor: null }) : undefined,
    ]);
    renderAt('/tickets?clients=g1,g2&project=p1');
    await screen.findByRole('heading', { name: t('tickets.global.title') });
    await waitFor(() => expect(calls).toContain('GET /api/tickets/global?clients=g1%2Cg2'));
    const projectPrefix = t('tickets.filters.project', { name: '' });
    expect(
      screen.queryAllByRole('button').some((b) => b.textContent?.startsWith(projectPrefix)),
    ).toBe(false);
  });

  it('search params: an event only under a chosen project', () => {
    expect(validateTicketsSearch({ project: 'p1', event: 'e1' })).toMatchObject({
      project: 'p1',
      event: 'e1',
    });
    expect(validateTicketsSearch({ event: 'e1' }).event).toBeUndefined();
    expect(filterFromSearch({ project: 'none', event: 'e1' }).event).toBeUndefined();
    const next: Record<string, unknown> = { project: 'old', event: 'old' };
    writeFilter(next, { status: 'open', project: 'p2' });
    expect(next).toEqual({ project: 'p2' });
  });
});
