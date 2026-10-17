import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkAudience } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { i18n, setLanguage } from '@/i18n';
import { AudienceBuilder } from './audience-builder';
import { ADMIN, EMPTY_AUDIENCE, mockBulkApi, person, reply, type Route } from './test-api';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const COUNT = '/api/bulk-email/audience/count';

const changes = vi.fn<(audience: BulkAudience) => void>();
/** The audience after the last change. */
const latest = () => changes.mock.lastCall![0];
function Harness({ initial }: { initial: BulkAudience }) {
  const [audience, setAudience] = useState(initial);
  return (
    <AudienceBuilder
      audience={audience}
      onChange={(next) => {
        changes(next);
        setAudience(next);
      }}
    />
  );
}

function setup(routes: Route[] = [], initial: BulkAudience = EMPTY_AUDIENCE) {
  const api = mockBulkApi(ADMIN, routes);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, ADMIN as never);
  render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
  return { ...api, user: userEvent.setup() };
}

describe('audience builder', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => vi.unstubAllGlobals());

  // Fake timers: two clicks on a loaded machine may be more than 300 ms apart in real time.
  it('asks for the count once, 300 ms after the last change', async () => {
    const { callsTo } = setup();
    const group = await screen.findByRole('checkbox', { name: 'ABC s.r.o.' });
    await waitFor(() => expect(callsTo('POST', COUNT)).toHaveLength(1));
    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Clients' }));
      });
      await act(() => vi.advanceTimersByTimeAsync(200));
      act(() => {
        fireEvent.click(group);
      });
      await act(() => vi.advanceTimersByTimeAsync(299));
      expect(callsTo('POST', COUNT)).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      await act(() => vi.advanceTimersByTimeAsync(1000));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(callsTo('POST', COUNT)).toHaveLength(2));
    expect(callsTo('POST', COUNT)[1]!.body).toEqual({
      ...EMPTY_AUDIENCE,
      roles: ['client'],
      groupIds: ['g1'],
    });
  });

  it('shows the count and the left-out reasons', async () => {
    setup([
      (url) =>
        url.pathname === COUNT
          ? reply(200, { count: 248, leftOut: { unsubscribed: 3, disabled: 1 } })
          : undefined,
    ]);
    expect(await screen.findByText('248 people get this email')).toBeInTheDocument();
    expect(
      screen.getByText(t('bulkEmail.audience.leftOut', { unsubscribed: 3, disabled: 1 })),
    ).toBeInTheDocument();
  });

  it('adds and leaves out a person by search, and names saved ones', async () => {
    const eva = person({ id: 'u1', name: 'Eva Malá' });
    const jan = person({ id: 'u2', name: 'Ján Veľký' });
    const { user, callsTo } = setup(
      [
        (url) =>
          url.pathname === '/api/bulk-email/people'
            ? reply(200, url.searchParams.get('q') === 'eva' ? [eva] : [jan])
            : undefined,
        (url) =>
          url.pathname === '/api/bulk-email/people/lookup'
            ? reply(200, [person({ id: 'u9', name: 'Saved Person' })])
            : undefined,
      ],
      { ...EMPTY_AUDIENCE, includeUserIds: ['u9'] },
    );
    const include = screen.getByLabelText('Add a person', { selector: 'input' });
    expect(await screen.findByText('Saved Person')).toBeInTheDocument();
    expect(callsTo('POST', '/api/bulk-email/people/lookup')[0]!.body).toEqual({ ids: ['u9'] });

    await user.type(include, 'eva');
    await user.click(await screen.findByRole('button', { name: 'Add Eva Malá' }));
    expect(latest().includeUserIds).toEqual(['u9', 'u1']);

    await user.type(screen.getByLabelText('Leave out a person', { selector: 'input' }), 'jan');
    await user.click(await screen.findByRole('button', { name: 'Add Ján Veľký' }));
    expect(latest().excludeUserIds).toEqual(['u2']);
    const chips = screen.getByRole('list', { name: 'Leave out a person' });
    expect(within(chips).getByText('Ján Veľký')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Eva Malá' }));
    expect(latest().includeUserIds).toEqual(['u9']);
  });

  it('Show recipients pages by 50', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => person({ id: `p${i}` }));
    const { user, callsTo } = setup([
      (url) =>
        url.pathname === COUNT
          ? reply(200, { count: 51, leftOut: { unsubscribed: 0, disabled: 0 } })
          : undefined,
      (url) => {
        if (url.pathname !== '/api/bulk-email/audience/people') return undefined;
        return url.searchParams.get('cursor') === 'c2'
          ? reply(200, { items: [person({ id: 'last', name: 'Zuzana Last' })], nextCursor: null })
          : reply(200, { items: page1, nextCursor: 'c2' });
      },
    ]);
    await screen.findByText('51 people get this email');
    await user.click(screen.getByRole('button', { name: 'Show recipients' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Person p0');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(50);
    await user.click(within(dialog).getByRole('button', { name: 'Show more' }));
    expect(await within(dialog).findByText('Zuzana Last')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(51);
    expect(callsTo('POST', '/api/bulk-email/audience/people?cursor=c2')).toHaveLength(1);
    expect(within(dialog).queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
