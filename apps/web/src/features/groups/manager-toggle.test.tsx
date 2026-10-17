import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { GroupEvents, type GroupSummary, type NotificationModes } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { notificationModesQuery } from '@/features/notifications/api';
import { GroupBell } from '@/features/notifications/mode-menu';
import { groupsQuery } from './api';
import { ManagerToggle } from './manager-toggle';
import { useManagerEvents } from './use-manager-events';

const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    connected: true,
  }),
}));
const emitManagers = (payload: unknown) => act(() => handlers.get(GroupEvents.managers)?.(payload));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const ME = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin' as const,
  finance: false,
  groups: [],
};
const ACME: GroupSummary = {
  id: 'g1',
  name: 'Acme',
  hasLogo: false,
  memberCount: 3,
  updatedAt: '2026-10-15T10:00:00.000Z',
  managers: [{ id: 'a2', name: 'Peter' }],
  managedByMe: false,
};
const MODES: NotificationModes = {
  defaultMode: null,
  roleDefault: 'mentions',
  overrides: {},
  managerSet: [],
};

type Reply = { status: number; body?: unknown };
/** A held answer: `release` sends it. */
function held() {
  let release!: (reply: Reply) => void;
  const promise = new Promise<Reply>((resolve) => (release = resolve));
  return { promise, release };
}

function answer(managedByMe: boolean, mode: string) {
  return {
    status: 200,
    body: {
      managers: managedByMe
        ? [
            { id: 'a1', name: 'Jana' },
            { id: 'a2', name: 'Peter' },
          ]
        : [{ id: 'a2', name: 'Peter' }],
      managedByMe,
      mode,
    },
  };
}

/** `send` answers each manager request in order. */
function setup(
  send: (method: string) => Promise<Reply> | Reply,
  { group = ACME, modes = MODES }: { group?: GroupSummary; modes?: NotificationModes } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = ({ status, body }: Reply) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (url === '/api/groups/g1/managers/me') return reply(await send(init?.method ?? 'GET'));
    if (url === '/api/notifications/modes') return reply({ status: 200, body: modes });
    if (url === '/api/groups') return reply({ status: 200, body: [group] });
    return reply({ status: 404, body: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(sessionQuery.queryKey, ME);
  queryClient.setQueryData(groupsQuery.queryKey, [group]);
  queryClient.setQueryData(notificationModesQuery.queryKey, modes);
  const onRowClick = vi.fn();
  function Row() {
    useManagerEvents();
    const { data } = useQuery(groupsQuery);
    const g = data?.[0];
    if (!g) return null;
    return (
      <div onClick={onRowClick}>
        <ManagerToggle group={g} />
        <GroupBell groupId={g.id} />
      </div>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Row />
    </QueryClientProvider>,
  );
  const managerCalls = () =>
    fetchMock.mock.calls
      .filter(([u]) => u === '/api/groups/g1/managers/me')
      .map(([, i]) => (i as RequestInit).method);
  return { queryClient, fetchMock, onRowClick, managerCalls, user: userEvent.setup() };
}

const toggle = () =>
  screen.getByRole('button', { name: t('groups.managers.toggleLabel', { name: 'Acme' }) });
const bell = (mode: string) =>
  screen.findByRole('button', {
    name: t('notifications.mode.bellLabel', { mode: t(`notifications.mode.${mode}`) }),
  });

describe('ManagerToggle', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => {
    vi.unstubAllGlobals();
    handlers.clear();
  });

  it('shows Manage with aria-pressed false and Managing with aria-pressed true', async () => {
    setup(() => answer(false, 'mentions'));
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).toHaveTextContent(t('groups.managers.manage'));
    vi.unstubAllGlobals();
    setup(() => answer(false, 'mentions'), { group: { ...ACME, id: 'g1', managedByMe: true } });
    const managing = screen.getAllByRole('button', {
      name: t('groups.managers.toggleLabel', { name: 'Acme' }),
    })[1];
    expect(managing).toHaveAttribute('aria-pressed', 'true');
    expect(managing).toHaveTextContent(t('groups.managers.managing'));
  });

  it('clicking does not navigate', async () => {
    const { user, onRowClick } = setup(() => answer(true, 'all'));
    await user.click(toggle());
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('the click updates at once while PUT is pending', async () => {
    const put = held();
    const { user, managerCalls } = setup(() => put.promise);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveTextContent(t('groups.managers.managing'));
    await bell('all');
    expect(managerCalls()).toEqual(['PUT']);
  });

  it('a failed PUT rolls back and shows the error', async () => {
    const { user } = setup(() => ({ status: 500, body: { error: 'internal' } }));
    await user.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('groups.managers.error'));
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    await bell('mentions');
  });

  it('a second click while the first is pending is applied after it, and the final state matches the last click', async () => {
    const put = held();
    const del = held();
    const { user, managerCalls } = setup((method) =>
      method === 'PUT' ? put.promise : del.promise,
    );
    await user.click(toggle());
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    // Only the first request is out; the second waits for it.
    expect(managerCalls()).toEqual(['PUT']);
    put.release(answer(true, 'all'));
    await waitFor(() => expect(managerCalls()).toEqual(['PUT', 'DELETE']));
    // The PUT's answer does not flip the toggle back.
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    del.release(answer(false, 'mentions'));
    await waitFor(() => expect(managerCalls()).toEqual(['PUT', 'DELETE']));
    await bell('mentions');
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    // Back where the burst started: no toast.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(t('groups.managers.stopped', { name: 'Acme' }))).toBeNull();
  });

  it('an event that arrives mid-burst does not flip aria-pressed', async () => {
    const put = held();
    const del = held();
    const { user, managerCalls } = setup((method) =>
      method === 'PUT' ? put.promise : del.promise,
    );
    await user.click(toggle());
    await user.click(toggle());
    // The server's event for the PUT arrives while the DELETE is still to come.
    emitManagers({
      groupId: 'g1',
      managers: [
        { id: 'a1', name: 'Jana' },
        { id: 'a2', name: 'Peter' },
      ],
    });
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    put.release(answer(true, 'all'));
    await waitFor(() => expect(managerCalls()).toEqual(['PUT', 'DELETE']));
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    // A third click goes from what the user asked for (false), not from the event.
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    del.release(answer(false, 'mentions'));
    await waitFor(() => expect(managerCalls()).toEqual(['PUT', 'DELETE', 'PUT']));
  });

  it('a failed request refetches the groups and the modes', async () => {
    const { user, fetchMock } = setup(() => ({ status: 500, body: { error: 'internal' } }));
    const gets = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;
    await user.click(toggle());
    await screen.findByRole('alert');
    await waitFor(() => {
      expect(gets('/api/groups')).toBeGreaterThan(0);
      expect(gets('/api/notifications/modes')).toBeGreaterThan(0);
    });
  });

  it('becoming manager sets the bell to all and toasts with the notifications line', async () => {
    const { user, queryClient } = setup(() => answer(true, 'all'));
    await user.click(toggle());
    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        `${t('groups.managers.started', { name: 'Acme' })} ${t('groups.managers.startedMode')}`,
      ),
    );
    await bell('all');
    const modes = queryClient.getQueryData<NotificationModes>(notificationModesQuery.queryKey);
    expect(modes?.overrides.g1).toBe('all');
    expect(modes?.managerSet).toEqual(['g1']);
    const groups = queryClient.getQueryData<GroupSummary[]>(groupsQuery.queryKey);
    expect(groups?.[0]?.managers.map((m) => m.id)).toEqual(['a1', 'a2']);
  });

  it('stopping with an own mode toasts without the notifications line', async () => {
    const { user } = setup(() => answer(false, 'off'), {
      group: {
        ...ACME,
        managedByMe: true,
        managers: [...ACME.managers, { id: 'a1', name: 'Jana' }],
      },
      modes: { ...MODES, overrides: { g1: 'off' } },
    });
    await user.click(toggle());
    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status).toHaveTextContent(t('groups.managers.stopped', { name: 'Acme' })),
    );
    expect(status).not.toHaveTextContent(/Notifications:/);
    await bell('off');
  });

  it('stopping after the manager row toasts the mode it falls back to', async () => {
    const { user } = setup(() => answer(false, 'mentions'), {
      group: { ...ACME, managedByMe: true },
      modes: { ...MODES, overrides: { g1: 'all' }, managerSet: ['g1'] },
    });
    await user.click(toggle());
    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status).toHaveTextContent(
        t('groups.managers.stoppedMode', { mode: t('notifications.mode.mentions') }),
      ),
    );
    await bell('mentions');
  });
});
