import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GroupEvents, type GroupManagersEvent, type GroupSummary } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { notificationModesQuery } from '@/features/notifications/api';
import { groupsQuery } from './api';
import { busyGroups } from './manager-busy';
import { useManagerEvents } from './use-manager-events';

const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    connected: true,
  }),
}));

const ME = {
  id: 'a1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin' as const,
  finance: false,
  groups: [],
};
const group = (id: string, managers: GroupSummary['managers']): GroupSummary => ({
  id,
  name: id,
  hasLogo: false,
  memberCount: 1,
  updatedAt: '2026-10-15T10:00:00.000Z',
  managers,
  managedByMe: managers.some((m) => m.id === ME.id),
});

function setup() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, ME);
  queryClient.setQueryData(groupsQuery.queryKey, [group('g1', []), group('g2', [])]);
  queryClient.setQueryData(['groups', 'g1', 'people'], []);
  queryClient.setQueryData(notificationModesQuery.queryKey, {
    defaultMode: null,
    roleDefault: 'mentions',
    overrides: {},
    managerSet: [],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useManagerEvents(), { wrapper });
  const emit = (event: GroupManagersEvent) =>
    act(() => handlers.get(GroupEvents.managers)?.(event));
  return { queryClient, emit, ...view };
}

describe('useManagerEvents', () => {
  afterEach(() => handlers.clear());

  it('an event patches the groups list and invalidates the people query', () => {
    const { queryClient, emit } = setup();
    emit({ groupId: 'g1', managers: [{ id: 'a2', name: 'Peter' }] });
    const groups = queryClient.getQueryData<GroupSummary[]>(groupsQuery.queryKey);
    expect(groups?.[0]?.managers).toEqual([{ id: 'a2', name: 'Peter' }]);
    expect(groups?.[0]?.managedByMe).toBe(false);
    expect(groups?.[1]?.managers).toEqual([]);
    expect(queryClient.getQueryState(['groups', 'g1', 'people'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(notificationModesQuery.queryKey)?.isInvalidated).toBe(false);
  });

  it('an event naming me invalidates modes', () => {
    const { queryClient, emit } = setup();
    emit({ groupId: 'g1', managers: [{ id: 'a1', name: 'Jana' }] });
    const groups = queryClient.getQueryData<GroupSummary[]>(groupsQuery.queryKey);
    expect(groups?.[0]?.managedByMe).toBe(true);
    expect(queryClient.getQueryState(notificationModesQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it('while my toggle for the group is busy, only the people are refreshed', () => {
    const { queryClient, emit } = setup();
    busyGroups.add('g1');
    try {
      emit({ groupId: 'g1', managers: [{ id: 'a1', name: 'Jana' }] });
    } finally {
      busyGroups.delete('g1');
    }
    const groups = queryClient.getQueryData<GroupSummary[]>(groupsQuery.queryKey);
    expect(groups?.[0]?.managers).toEqual([]);
    expect(queryClient.getQueryState(['groups', 'g1', 'people'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(notificationModesQuery.queryKey)?.isInvalidated).toBe(false);
  });

  it('stops listening on unmount', () => {
    const { unmount } = setup();
    expect(handlers.has(GroupEvents.managers)).toBe(true);
    unmount();
    expect(handlers.has(GroupEvents.managers)).toBe(false);
  });
});
