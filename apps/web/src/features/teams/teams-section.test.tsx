import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { KnowledgeItemDto, TeamsLink, TeamsMeetingState } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { TeamsSection } from './teams-section';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ITEM = {
  id: 'k1',
  meetingDetail: { meetingUrl: 'https://teams.microsoft.com/meet/123456789' },
} as unknown as KnowledgeItemDto;

const LINK: TeamsLink = {
  origin: 'help',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
  organizerName: 'Jana Admin',
  durationMinutes: 60,
  recordAutomatically: true,
  transcriptState: 'available',
  lastError: null,
  lastCheckedAt: null,
  nextCheckAt: null,
  invitationUrl: 'https://help.egrant.sk/m/AbCdEfGhIjKlMnOpQrStUv',
};

type Call = { url: string; method: string; body: unknown };

function mockApi(state: TeamsMeetingState | 404, answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/knowledge/k1/teams' && method === 'GET') {
        return state === 404
          ? new Response('{"error":"not_found"}', { status: 404 })
          : Response.json(state);
      }
      if (url === '/api/knowledge/k1/teams/people') {
        return Response.json([
          { id: 'c1', name: 'Klient Firmy', email: 'klient@firma.sk', isAdmin: false },
        ]);
      }
      const key = `${method} ${url}`;
      if (key in answers) {
        const answer = answers[key] as { status?: number; body: unknown };
        return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChanged = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TeamsSection item={ITEM} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onChanged };
}

describe('Teams block (T1)', () => {
  beforeAll(async () => {
    await setLanguage('en');
    await loadNamespace('teams');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing while Teams is not configured (404)', async () => {
    const calls = mockApi(404);
    renderSection();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('teams-section')).toBeNull();
  });

  it('creates a meeting with nobody preselected: only the picked people and typed emails', async () => {
    const created: TeamsMeetingState = { link: { ...LINK, transcriptState: 'waiting' } };
    const calls = mockApi(
      { link: null },
      {
        'POST /api/knowledge/k1/teams/meeting': { status: 201, body: created },
      },
    );
    const { user, onChanged } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.create') }));
    const person = await screen.findByRole('checkbox', { name: /Klient Firmy/ });
    expect(person).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: new RegExp(t('teams.create.record')) }),
    ).toBeChecked();
    expect(screen.getByText(t('teams.public.recorded'))).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(t('teams.create.addEmail')), 'nope');
    await user.click(screen.getByRole('button', { name: t('teams.create.add') }));
    expect(screen.getByText(t('teams.create.invalidEmail'))).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(t('teams.create.addEmail')));
    await user.type(
      screen.getByPlaceholderText(t('teams.create.addEmail')),
      'Guest@Partner.sk{Enter}',
    );
    await user.click(person);
    await user.click(screen.getByRole('button', { name: t('teams.create.submit') }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      durationMinutes: 60,
      attendees: [
        { email: 'klient@firma.sk', name: 'Klient Firmy' },
        { email: 'guest@partner.sk' },
      ],
      recordAutomatically: true,
    });
    expect(await screen.findByText(t('teams.block.state_waiting'))).toBeInTheDocument();
  });

  it('shows a clear error when the admin is not a Teams organizer', async () => {
    mockApi(
      { link: null },
      {
        'POST /api/knowledge/k1/teams/meeting': {
          status: 403,
          body: { error: 'teams_not_organizer' },
        },
      },
    );
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.create') }));
    await user.click(await screen.findByRole('button', { name: t('teams.create.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('teams.errors.teams_not_organizer'),
    );
  });

  it('connects a pasted link, prefilled with the meeting link', async () => {
    const calls = mockApi(
      { link: null },
      {
        'POST /api/knowledge/k1/teams/connect': {
          body: { link: { ...LINK, origin: 'linked', invitationUrl: null } },
        },
      },
    );
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.connect') }));
    expect(screen.getByRole('textbox', { name: t('teams.connectForm.url') })).toHaveValue(
      'https://teams.microsoft.com/meet/123456789',
    );
    await user.click(screen.getByRole('button', { name: t('teams.connectForm.submit') }));
    expect(await screen.findByText(t('teams.block.origin_linked'))).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      url: 'https://teams.microsoft.com/meet/123456789',
    });
    expect(screen.queryByRole('button', { name: t('teams.block.copyInvitation') })).toBeNull();
  });

  it('says when the Teams meeting already belongs to another record', async () => {
    mockApi(
      { link: null },
      {
        'POST /api/knowledge/k1/teams/connect': {
          status: 409,
          body: { error: 'teams_meeting_linked' },
        },
      },
    );
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.connect') }));
    await user.click(screen.getByRole('button', { name: t('teams.connectForm.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('teams.errors.teams_meeting_linked'),
    );
  });

  it('a connected meeting offers Replace when Teams has a transcript, and Disconnect asks first', async () => {
    const calls = mockApi(
      { link: LINK },
      {
        'POST /api/knowledge/k1/teams/check': {
          body: { link: { ...LINK, transcriptState: 'imported' } },
        },
      },
    );
    const { user } = renderSection();
    expect(await screen.findByText(t('teams.block.state_available'))).toBeInTheDocument();
    expect(
      screen.getByText(t('teams.block.organizer', { name: 'Jana Admin' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('teams.block.replace') }));
    expect(await screen.findByText(t('teams.block.state_imported'))).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ replace: true });

    await user.click(screen.getByRole('button', { name: t('teams.block.disconnect') }));
    expect(screen.getByText(t('teams.block.disconnectConfirm'))).toBeInTheDocument();
  });

  it('a call of a series: "also for the following meetings" (on) and the plan with Stop', async () => {
    const planned: TeamsMeetingState = {
      link: { ...LINK, transcriptState: 'waiting' },
      series: { planned: true, organizerName: 'Jana Admin', lastError: null },
    };
    const calls = mockApi(
      { link: null, series: { planned: false, organizerName: null, lastError: null } },
      {
        'POST /api/knowledge/k1/teams/meeting': { status: 201, body: planned },
        'DELETE /api/knowledge/k1/teams/series': { status: 204, body: null },
      },
    );
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.create') }));
    const following = await screen.findByRole('checkbox', {
      name: new RegExp(t('teams.create.following')),
    });
    expect(following).toBeChecked();
    await user.click(screen.getByRole('button', { name: t('teams.create.submit') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ following: true });
    expect(
      await screen.findByText(t('teams.series.planned', { name: 'Jana Admin' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('teams.series.stop') }));
    await user.click(
      within(screen.getByTestId('teams-series')).getAllByRole('button', {
        name: t('teams.series.stop'),
      })[0]!,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/teams/series'))).toBe(
        true,
      ),
    );
  });

  it('a single call shows no "following" choice', async () => {
    mockApi({ link: null });
    const { user } = renderSection();
    await user.click(await screen.findByRole('button', { name: t('teams.block.create') }));
    await screen.findByRole('button', { name: t('teams.create.submit') });
    expect(
      screen.queryByRole('checkbox', { name: new RegExp(t('teams.create.following')) }),
    ).toBeNull();
  });
});
