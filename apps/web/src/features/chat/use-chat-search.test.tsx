import { act, render, screen } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { useChatSearch } from './use-chat-search';

const probe = {} as { api: ReturnType<typeof useChatSearch> };
function Probe() {
  const api = useChatSearch('c1');
  useEffect(() => {
    probe.api = api;
  });
  return (
    <p>
      thread={api.thread ?? '-'} message={api.message ?? '-'} unscoped={String(api.unscoped)}
    </p>
  );
}

async function renderAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const chat = createRoute({
    getParentRoute: () => root,
    path: '/groups/$groupId/chat',
    component: Probe,
  });
  const router = createRouter({
    routeTree: root.addChildren([chat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText(/thread=/);
  return router;
}

describe('useChatSearch', () => {
  it('reads thread and message of its own channel from the URL', async () => {
    await renderAt('/groups/g1/chat?thread=r-1&message=m-2&c=c1');
    expect(screen.getByText('thread=r-1 message=m-2 unscoped=false')).toBeInTheDocument();
  });

  it("ignores another channel's params", async () => {
    await renderAt('/groups/g1/chat?thread=r-1&message=m-2&c=c9');
    expect(screen.getByText('thread=- message=- unscoped=false')).toBeInTheDocument();
  });

  it('params without a channel are unscoped until adopted', async () => {
    const router = await renderAt('/groups/g1/chat?thread=r-1&x=1');
    expect(screen.getByText('thread=- message=- unscoped=true')).toBeInTheDocument();
    const length = router.history.length;
    await act(() => probe.api.adopt());
    expect(router.state.location.search).toEqual({ thread: 'r-1', x: 1, c: 'c1' });
    expect(router.history.length).toBe(length);
    expect(screen.getByText('thread=r-1 message=- unscoped=false')).toBeInTheDocument();
  });

  it('setThread opens and closes a thread and keeps the other params', async () => {
    const router = await renderAt('/groups/g1/chat?message=m-2&c=c1&x=1');
    await act(() => probe.api.setThread('r-1'));
    expect(router.state.location.pathname).toBe('/groups/g1/chat');
    expect(router.state.location.search).toEqual({ message: 'm-2', c: 'c1', x: 1, thread: 'r-1' });
    await act(() => probe.api.setThread(undefined));
    expect(router.state.location.search).toEqual({ message: 'm-2', c: 'c1', x: 1 });
    expect(screen.getByText('thread=- message=m-2 unscoped=false')).toBeInTheDocument();
  });

  it("opening a thread replaces another channel's params", async () => {
    const router = await renderAt('/groups/g1/chat?thread=t-9&message=m-9&c=c9');
    await act(() => probe.api.setThread('r-1'));
    expect(router.state.location.search).toEqual({ thread: 'r-1', c: 'c1' });
  });

  it('clearMessage drops only the message and replaces the history entry; c goes with the last param', async () => {
    const router = await renderAt('/groups/g1/chat?thread=r-1&message=m-2&c=c1');
    const length = router.history.length;
    await act(() => probe.api.clearMessage());
    expect(router.state.location.search).toEqual({ thread: 'r-1', c: 'c1' });
    expect(router.history.length).toBe(length);
    await act(() => probe.api.setThread(undefined));
    expect(router.state.location.search).toEqual({});
  });
});
