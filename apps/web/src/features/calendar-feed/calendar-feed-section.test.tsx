import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CalendarFeed, CalendarFeedInclude } from '@spolu/shared';
import { i18n } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { CalendarFeedSection } from './calendar-feed-section';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const URL1 = 'https://help.example/api/public/calendar/AAAA/help.ics';
const URL2 = 'https://help.example/api/public/calendar/BBBB/help.ics';
const ALL = { events: true, tasks: true, calls: true };

const feedOf = (url: string, include: CalendarFeedInclude = ALL, over = {}): CalendarFeed => ({
  url,
  webcalUrl: url.replace('https://', 'webcal://'),
  googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace('https://', 'webcal://'))}`,
  include,
  createdAt: '2026-10-19T10:00:00.000Z',
  lastFetchedAt: null,
  ...over,
});

function setup(options: { feed?: CalendarFeed | null; status?: number } = {}) {
  let feed = options.feed ?? null;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (method !== 'GET') calls.push({ method, url, body });
      if (options.status) return json({ error: 'forbidden' }, options.status);
      if (url === '/api/me/calendar-feed' && method === 'GET') return json({ feed });
      if (url === '/api/me/calendar-feed' && method === 'PUT') {
        const created = feed === null;
        feed = feed ? { ...feed, include: body.include } : feedOf(URL1, body.include);
        return json({ feed }, created ? 201 : 200);
      }
      if (url === '/api/me/calendar-feed/rotate') {
        feed = feedOf(URL2, feed!.include);
        return json({ feed });
      }
      if (url === '/api/me/calendar-feed' && method === 'DELETE') {
        feed = null;
        return new Response(null, { status: 204 });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CalendarFeedSection />
    </QueryClientProvider>,
  );
  return { calls, view, user: userEvent.setup() };
}

describe('CalendarFeedSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('sk');
    await loadAllNamespaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without a feed shows the switches and creates one', async () => {
    const { calls, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Vytvoriť odkaz na kalendár' }));
    expect(calls).toEqual([
      { method: 'PUT', url: '/api/me/calendar-feed', body: { include: ALL } },
    ]);
    expect(await screen.findByDisplayValue(URL1)).toBeInTheDocument();
  });

  it('a switch before creating changes what the new feed shows', async () => {
    const { calls, user } = setup();
    await user.click(await screen.findByLabelText('Hovory'));
    expect(calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Vytvoriť odkaz na kalendár' }));
    expect(calls[0]!.body).toEqual({ include: { ...ALL, calls: false } });
  });

  it('shows the same three switches to admins and clients', async () => {
    setup();
    await screen.findByText('Čo sa má zobrazovať:');
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual([
      'Udalosti projektov',
      'Termíny mojich úloh',
      'Hovory',
    ]);
  });

  it('shows the link, copies it and offers Google and webcal links', async () => {
    const feed = feedOf(URL1);
    const { user } = setup({ feed });
    expect(await screen.findByDisplayValue(URL1)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kopírovať' }));
    // user-event stands in for the clipboard
    expect(await navigator.clipboard.readText()).toBe(URL1);
    expect(await screen.findByRole('button', { name: 'Skopírované' })).toBeInTheDocument();
    const google = screen.getByRole('link', { name: 'Pridať do Google Kalendára' });
    expect(google).toHaveAttribute('href', feed.googleUrl);
    expect(google).toHaveAttribute('target', '_blank');
    expect(google).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Pridať do Apple alebo Outlook' })).toHaveAttribute(
      'href',
      feed.webcalUrl,
    );
    expect(screen.getByText(/Nezdieľajte ho/)).toBeInTheDocument();
  });

  it('a switch change saves at once', async () => {
    const { calls, user } = setup({ feed: feedOf(URL1) });
    await user.click(await screen.findByLabelText('Hovory'));
    expect(calls).toEqual([
      { method: 'PUT', url: '/api/me/calendar-feed', body: { include: { ...ALL, calls: false } } },
    ]);
    expect(await screen.findByText('Uložené')).toBeInTheDocument();
    expect(screen.getByLabelText('Hovory')).not.toBeChecked();
  });

  it('rotate asks first, then shows the new URL', async () => {
    const { calls, user } = setup({ feed: feedOf(URL1) });
    await user.click(await screen.findByRole('button', { name: 'Vytvoriť nový odkaz' }));
    expect(screen.getByRole('dialog', { name: 'Vytvoriť nový odkaz?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Vytvoriť nový odkaz' }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Vytvoriť nový odkaz')!,
    );
    expect(calls).toEqual([{ method: 'POST', url: '/api/me/calendar-feed/rotate' }]);
    expect(await screen.findByDisplayValue(URL2)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('revoke asks first and returns to the empty state', async () => {
    const { calls, user } = setup({ feed: feedOf(URL1) });
    await user.click(await screen.findByRole('button', { name: 'Zrušiť odber' }));
    const dialog = screen.getByRole('dialog', { name: 'Zrušiť odber kalendára?' });
    await user.click(
      [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Zrušiť odber')!,
    );
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/me/calendar-feed' }]);
    expect(
      await screen.findByRole('button', { name: 'Vytvoriť odkaz na kalendár' }),
    ).toBeInTheDocument();
  });

  it('shows when the calendar last fetched it', async () => {
    setup({ feed: feedOf(URL1) });
    expect(await screen.findByText('Kalendár odkaz zatiaľ nenačítal.')).toBeInTheDocument();
  });

  it('shows the last fetch time when there is one', async () => {
    setup({ feed: feedOf(URL1, ALL, { lastFetchedAt: '2026-10-19T12:05:00.000Z' }) });
    expect(await screen.findByText(/^Naposledy načítané kalendárom: /)).toBeInTheDocument();
  });

  it('renders nothing for a person without a feed (403)', async () => {
    const { view } = setup({ status: 403 });
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  });
});
