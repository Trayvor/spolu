import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { sessionQuery } from './use-session';
import { SignedInFrame } from './authed-layout';

const imported = vi.fn();
vi.mock('@/features/admin-home/admin-shell', () => {
  imported();
  return { AdminSidebar: () => <aside>admin-sidebar</aside> };
});

const ADMIN: Me = {
  id: 'a1',
  name: 'Ada',
  email: 'a@x.sk',
  role: 'admin',
  finance: false,
  groups: [],
};
const CLIENT: Me = {
  id: 'c1',
  name: 'Cyril',
  email: 'c@x.sk',
  role: 'client',
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};

let wide = true;
const original = window.matchMedia;

function renderFrame(me: Me) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <SignedInFrame>
        <p>page</p>
      </SignedInFrame>
    </QueryClientProvider>,
  );
}

describe('SignedInFrame', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({
      matches: wide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('never for a client', async () => {
    wide = true;
    renderFrame(CLIENT);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('admin-sidebar')).toBeNull();
    expect(screen.getByText('page')).toBeInTheDocument();
    // First in the file: the mocked chunk was never imported.
    expect(imported).not.toHaveBeenCalled();
  });

  it('the sidebar shows for an admin at 1024 px', async () => {
    wide = true;
    renderFrame(ADMIN);
    expect(await screen.findByText('admin-sidebar')).toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });

  it('not under 1024 px', async () => {
    wide = false;
    renderFrame(ADMIN);
    expect(screen.getByText('page')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('admin-sidebar')).toBeNull();
  });
});
