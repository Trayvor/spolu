import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import type { PublicMeeting } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { googleLink, icsLink, outlookLink } from './calendar-links';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const MEETING: PublicMeeting = {
  title: 'Kickoff Mesto X',
  startsAt: '2030-01-10T09:00:00.000Z',
  endsAt: '2030-01-10T10:00:00.000Z',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0',
  recorded: true,
};

function mockApi(reply: { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r =
        url === `/api/public/meetings/${TOKEN}`
          ? reply
          : url === '/api/me'
            ? { status: 401, body: { error: 'unauthorized' } }
            : { status: 404, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key);

describe('public meeting page (Teams T1)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the title, Join, the calendar links and the recording notice without signing in', async () => {
    mockApi({ status: 200, body: MEETING });
    renderAt(`/m/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: MEETING.title })).toBeInTheDocument();
    expect(screen.getByText(t('teams.public.recorded'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('teams.public.join') })).toHaveAttribute(
      'href',
      MEETING.joinUrl,
    );
    expect(screen.getByRole('link', { name: t('teams.public.ics') })).toHaveAttribute(
      'href',
      `/api/public/meetings/${TOKEN}/invite.ics?lang=en`,
    );
    const outlook = screen.getByRole('link', { name: t('teams.public.outlook') });
    expect(outlook.getAttribute('href')).toMatch(/^https:\/\/outlook\.office\.com\//);
    const google = screen.getByRole('link', { name: t('teams.public.google') });
    expect(google.getAttribute('href')).toMatch(/^https:\/\/calendar\.google\.com\//);
  });

  it('asks search engines not to index the page, also when the link is invalid', async () => {
    const robots = () =>
      document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
    mockApi({ status: 200, body: MEETING });
    renderAt(`/m/${TOKEN}`);
    await screen.findByRole('heading', { name: MEETING.title });
    expect(robots()).toBe('noindex');
    cleanup();
    expect(robots()).toBeNull();
    mockApi({ status: 404, body: { error: 'not_found' } });
    renderAt(`/m/${TOKEN}`);
    await screen.findByRole('alert');
    expect(robots()).toBe('noindex');
  });

  it('a meeting without automatic recording says it may be recorded', async () => {
    mockApi({ status: 200, body: { ...MEETING, recorded: false } });
    renderAt(`/m/${TOKEN}`);
    expect(await screen.findByText(t('teams.public.mayRecord'))).toBeInTheDocument();
  });

  it('an invalid link says so', async () => {
    mockApi({ status: 404, body: { error: 'not_found' } });
    renderAt(`/m/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('teams.public.invalid'));
  });
});

describe('calendar links', () => {
  it('Outlook and Google get the title, UTC times, the description and the join link', () => {
    const outlook = new URL(outlookLink(MEETING, 'Notice'));
    expect(Object.fromEntries(outlook.searchParams)).toMatchObject({
      subject: MEETING.title,
      startdt: MEETING.startsAt,
      enddt: MEETING.endsAt,
      body: 'Notice',
      location: MEETING.joinUrl,
    });
    const google = new URL(googleLink(MEETING, 'Notice'));
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      action: 'TEMPLATE',
      text: MEETING.title,
      dates: '20300110T090000Z/20300110T100000Z',
      details: 'Notice',
      location: MEETING.joinUrl,
    });
    expect(icsLink('a/b', 'sk')).toBe('/api/public/meetings/a%2Fb/invite.ics?lang=sk');
  });
});
