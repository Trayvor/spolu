import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, type ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HomeWorkload, WorkloadAdmin, WorkloadClient } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { renderWithRouter } from './test-router';
import { WorkloadCard } from './workload-card';

const zero = { openTasks: 0, overdueTasks: 0, openTickets: 0, unseen: 0 };

const client = (over: Partial<WorkloadClient>): WorkloadClient => ({
  ...zero,
  groupId: 'g1',
  name: 'Mesto Senec',
  internal: false,
  ...over,
});

const admin = (over: Partial<WorkloadAdmin> & { userId: string; name: string }): WorkloadAdmin => ({
  ...zero,
  self: false,
  clients: [],
  moreClients: null,
  ...over,
});

const answer = (over: Partial<HomeWorkload> = {}): HomeWorkload => ({
  today: '2026-10-21',
  week: null,
  admins: [
    admin({
      userId: 'u2',
      name: 'Peter Kováč',
      openTasks: 11,
      overdueTasks: 5,
      openTickets: 2,
      clients: [
        client({ openTasks: 6, overdueTasks: 4, openTickets: 1 }),
        client({
          groupId: 'ga',
          name: 'eGrant tím',
          internal: true,
          openTasks: 3,
          overdueTasks: 1,
        }),
        client({ groupId: null, name: null, openTickets: 1 }),
      ],
      moreClients: { count: 3, ...zero, openTasks: 2 },
    }),
    admin({ userId: 'u1', name: 'Vlad', self: true, openTasks: 4, openTickets: 1, unseen: 2 }),
  ],
  ...over,
});

let calls = 0;
function mockApi(body: HomeWorkload | 'fail') {
  calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/api/me/home/workload') throw new Error(`unexpected ${url}`);
      calls++;
      return body === 'fail'
        ? new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

async function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderWithRouter(
    () => (
      <Suspense fallback={null}>
        <WorkloadCard />
      </Suspense>
    ),
    '/',
    (node: ReactNode) => <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Vyťaženie tímu' });
  return view;
}

/** An admin's own row (not their clients', whose link labels name them too). */
const adminRow = (name: RegExp) =>
  screen
    .getByRole('button', { name: new RegExp(`rozpis podľa klientov: ${name.source}`) })
    .closest('tr')!;

describe('WorkloadCard', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a row per admin in the order sent, with the counts', async () => {
    mockApi(answer());
    await renderCard();
    await screen.findByText('Peter Kováč');
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    const peter = rows.findIndex((r) => r.includes('Peter Kováč'));
    const vlad = rows.findIndex((r) => r.includes('Vlad'));
    expect(peter).toBeGreaterThan(0);
    expect(vlad).toBeGreaterThan(peter);
    const cells = within(adminRow(/Peter Kováč/)).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['11', '5', '2', '0']);
  });

  it("marks the viewer's row with (vy)", async () => {
    mockApi(answer());
    await renderCard();
    expect(await screen.findByText('(vy)')).toBeInTheDocument();
    expect(within(adminRow(/Vlad/)).getByText('(vy)')).toBeInTheDocument();
  });

  it('shows Po termíne above 0 in the overdue colour and 0 muted', async () => {
    mockApi(answer());
    await renderCard();
    await screen.findByText('Peter Kováč');
    const [, overdue] = within(adminRow(/Peter Kováč/)).getAllByRole('cell');
    expect(overdue!.className).toContain('text-error-ink');
    const [, none] = within(adminRow(/Vlad/)).getAllByRole('cell');
    expect(none!.className).toContain('text-muted-foreground');
  });

  it("expands and collapses an admin's clients", async () => {
    mockApi(answer());
    await renderCard();
    const button = await screen.findByRole('button', {
      name: 'Zobraziť rozpis podľa klientov: Peter Kováč',
    });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const controls = button.getAttribute('aria-controls')!;
    expect(document.getElementById(controls)).not.toBeVisible();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Skryť rozpis podľa klientov: Peter Kováč');
    for (const name of ['Mesto Senec', 'eGrant tím', 'Bez klienta']) {
      expect(screen.getByText(name)).toBeVisible();
    }
    await userEvent.click(button);
    expect(screen.getByText('Mesto Senec')).not.toBeVisible();
    expect(calls).toBe(1);
  });

  it('shows the more row with the summed counts', async () => {
    mockApi(answer());
    await renderCard();
    await userEvent.click(
      await screen.findByRole('button', { name: /Zobraziť rozpis podľa klientov: Peter/ }),
    );
    const more = screen.getByRole('row', { name: /a 3 ďalší klienti/ });
    expect(within(more).getAllByRole('cell')[0]).toHaveTextContent('2');
    expect(within(more).queryByRole('link')).toBeNull();
  });

  it('links task numbers to the board with the admin and client', async () => {
    mockApi(answer());
    await renderCard();
    await userEvent.click(
      await screen.findByRole('button', { name: /Zobraziť rozpis podľa klientov: Peter/ }),
    );
    const senec = screen.getByRole('row', { name: /Mesto Senec/ });
    expect(
      within(senec).getByRole('link', { name: 'Úlohy: Peter Kováč, Mesto Senec' }),
    ).toHaveAttribute('href', '/tasks?clients=g1&assignee=u2');
    expect(
      within(senec).getByRole('link', { name: 'Úlohy po termíne: Peter Kováč, Mesto Senec' }),
    ).toHaveAttribute('href', '/tasks?clients=g1&assignee=u2&due=overdue');
    // Another admin's Tikety is plain text; "Bez klienta" has no link at all.
    expect(within(senec).queryByRole('link', { name: /^Tikety/ })).toBeNull();
    expect(within(screen.getByRole('row', { name: /Bez klienta/ })).queryByRole('link')).toBeNull();
    // The admin row: every client.
    expect(
      within(adminRow(/Peter Kováč/)).getByRole('link', {
        name: 'Úlohy: Peter Kováč, všetci klienti',
      }),
    ).toHaveAttribute('href', '/tasks?clients=all&assignee=u2');
    // The viewer's own Tikety links to the ticket list.
    expect(
      within(adminRow(/Vlad/)).getByRole('link', { name: 'Tikety: všetci klienti' }),
    ).toHaveAttribute('href', '/tickets?assignee=me&clients=all');
    expect(
      within(adminRow(/Vlad/)).getByRole('link', { name: 'Úlohy: Vlad, všetci klienti' }),
    ).toHaveAttribute('href', '/tasks?clients=all&assignee=me');
  });

  it('shows the time column only when the answer has a week', async () => {
    mockApi(answer());
    const first = await renderCard();
    await screen.findByText('Peter Kováč');
    expect(screen.queryByRole('columnheader', { name: 'Tento týždeň' })).toBeNull();
    expect(screen.getByText('Bez deaktivovaných klientov.')).toBeInTheDocument();
    first.unmount();

    const timed = answer({ week: { from: '2026-10-19', until: '2026-10-26' } });
    timed.admins[0]!.minutesThisWeek = 90;
    timed.admins[1]!.minutesThisWeek = 0;
    mockApi(timed);
    await renderCard();
    expect(await screen.findByRole('columnheader', { name: 'Tento týždeň' })).toBeInTheDocument();
    expect(within(adminRow(/Peter Kováč/)).getByText('1 h 30 min')).toBeInTheDocument();
    expect(within(adminRow(/Vlad/)).getByText('–')).toBeInTheDocument();
    expect(
      screen.getByText('Bez deaktivovaných klientov. Čas: zápisy od pondelka do nedele.'),
    ).toBeInTheDocument();
  });

  it('shows the error line with a retry', async () => {
    mockApi('fail');
    await renderCard();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nepodarilo sa');
    mockApi(answer());
    await userEvent.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    await waitFor(() => expect(screen.getByText('Peter Kováč')).toBeInTheDocument());
  });
});
