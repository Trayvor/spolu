import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { ADMIN, CLIENT, fakeSocket, mockTicketApi, reply, type Route } from './test-api';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ADMINS = [
  { id: 'a1', name: 'Ada', email: 'a@x.sk', role: 'admin' },
  { id: 'a2', name: 'Boris', email: 'b@x.sk', role: 'admin' },
];

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const routes = (rules: unknown[], onPut?: (body: unknown) => Response): Route[] => [
  (url) =>
    url.pathname === '/api/groups/g1'
      ? reply(200, { id: 'g1', name: 'ABC s.r.o.', egrantUrl: '', hasLogo: false, updatedAt: '' })
      : undefined,
  (url) =>
    url.pathname === '/api/groups/g1/tickets'
      ? reply(200, { items: [], nextCursor: null })
      : undefined,
  (url) =>
    url.pathname === '/api/groups/g1/ticket-watch' ? reply(200, { watching: true }) : undefined,
  (url) => (url.pathname === '/api/admins' ? reply(200, ADMINS) : undefined),
  (url, init) => {
    if (url.pathname !== '/api/groups/g1/ticket-areas') return undefined;
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as unknown;
      return onPut ? onPut(body) : reply(200, { rules: [] });
    }
    return reply(200, { rules });
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('automatic assignees by area (2026-10-21)', () => {
  it('a client never sees the button', async () => {
    const { calls } = mockTicketApi(CLIENT, routes([]));
    renderAt('/groups/g1/tickets');
    expect(await screen.findByText(t('tickets.watch.label'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('tickets.areaRules.open') })).toBeNull();
    expect(calls.some((c) => c.includes('ticket-areas'))).toBe(false);
  });

  it('an admin opens the table, edits, adds and removes rows, and saves it whole', async () => {
    let saved: unknown = null;
    const { calls } = mockTicketApi(
      ADMIN,
      routes([{ area: 'zend.Projekty', user: { id: 'a2', name: 'Boris' } }], (body) => {
        saved = body;
        return reply(200, { rules: [] });
      }),
    );
    renderAt('/groups/g1/tickets');
    await userEvent.click(await screen.findByRole('button', { name: t('tickets.areaRules.open') }));
    const dialog = await screen.findByTestId('area-rules');
    const area1 = await within(dialog).findByRole('textbox', {
      name: t('ticketAreas.areaOf', { n: 1 }),
    });
    expect(area1).toHaveValue('zend.Projekty');
    expect(
      within(dialog).getByRole('combobox', { name: t('ticketAreas.adminOf', { n: 1 }) }),
    ).toHaveValue('a2');

    await userEvent.click(within(dialog).getByRole('button', { name: t('ticketAreas.add') }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: t('ticketAreas.areaOf', { n: 2 }) }),
      ' Platby ',
    );
    // Saving a row without an admin is stopped in the form.
    await userEvent.click(within(dialog).getByRole('button', { name: t('ticketAreas.save') }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t('ticketAreas.incomplete'));
    expect(calls).not.toContain('PUT /api/groups/g1/ticket-areas');
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: t('ticketAreas.adminOf', { n: 2 }) }),
      'a1',
    );
    // Remove the first row.
    await userEvent.click(
      within(dialog).getAllByRole('button', {
        name: new RegExp(`^${t('ticketAreas.remove')}`),
      })[0]!,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('ticketAreas.save') }));
    await waitFor(() => expect(saved).toEqual({ rules: [{ area: 'Platby', userId: 'a1' }] }));
    await waitFor(() => expect(screen.queryByTestId('area-rules')).toBeNull());
  });

  it('a refused save says so and keeps the dialog open', async () => {
    mockTicketApi(
      ADMIN,
      routes([], () => reply(400, { error: 'invalid_assignee' })),
    );
    renderAt('/groups/g1/tickets');
    await userEvent.click(await screen.findByRole('button', { name: t('tickets.areaRules.open') }));
    const dialog = await screen.findByTestId('area-rules');
    expect(await within(dialog).findByText(t('ticketAreas.empty'))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: t('ticketAreas.add') }));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: t('ticketAreas.areaOf', { n: 1 }) }),
      'Projekty',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: t('ticketAreas.adminOf', { n: 1 }) }),
      'a2',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('ticketAreas.save') }));
    expect(await within(dialog).findByText(t('ticketAreas.saveFailed'))).toBeInTheDocument();
  });
});
