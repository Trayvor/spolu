import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { ProfileSection } from './profile-section';

const ME: Me = {
  id: 'u1',
  name: 'Eva',
  email: 'eva@example.com',
  role: 'client',
  groups: [{ id: 'g1', name: 'Firma', role: 'client', hasLogo: false, updatedAt: '' }],
};

type Handler = (body: unknown) => Response | Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** `routes` answers "METHOD /api/path"; GET /api/me answers the current session. */
function setup(routes: Record<string, Handler>) {
  let session: Me = ME;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (key === 'GET /api/me') return json(session);
    const handler = routes[key];
    if (!handler) return json({ error: 'not_found' }, 404);
    return handler(init?.body ? JSON.parse(init.body as string) : undefined);
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, ME);
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileSection />
    </QueryClientProvider>,
  );
  const calls = (key: string) =>
    fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key);
  return {
    queryClient,
    calls,
    setSession: (next: Me) => (session = next),
    user: userEvent.setup(),
  };
}

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(screen.getByRole('button', { name: 'Change' }));
  await user.type(screen.getByLabelText('New email address'), email);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  expect(await screen.findByText(`We sent a code to ${email}`)).toBeInTheDocument();
}

describe('ProfileSection', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('saves the name', async () => {
    const { calls, queryClient, user } = setup({
      'PATCH /api/me': (body) => json({ ...ME, ...(body as object) }),
    });
    const field = screen.getByLabelText('Name');
    expect(field).toHaveValue('Eva');
    await user.clear(field);
    await user.type(field, 'Eva Nová');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(JSON.parse(calls('PATCH /api/me')[0]?.[1]?.body as string)).toEqual({
      name: 'Eva Nová',
    });
    expect(queryClient.getQueryData<Me>(sessionQuery.queryKey)?.name).toBe('Eva Nová');
  });

  it('email change: address, code, done, session refreshed', async () => {
    const next = 'new@example.com';
    const { calls, queryClient, setSession, user } = setup({
      'POST /api/me/email-change': () => new Response(null, { status: 204 }),
      'POST /api/me/email-change/confirm': () => {
        setSession({ ...ME, email: next });
        return json({ ...ME, email: next });
      },
    });
    expect(screen.getByText(ME.email)).toBeInTheDocument();
    await reachCodeStep(user, next);
    expect(JSON.parse(calls('POST /api/me/email-change')[0]?.[1]?.body as string)).toEqual({
      newEmail: next,
    });

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(`Your email address is now ${next}`)).toBeInTheDocument();
    expect(JSON.parse(calls('POST /api/me/email-change/confirm')[0]?.[1]?.body as string)).toEqual({
      newEmail: next,
      code: '123456',
    });
    await waitFor(() => expect(calls('GET /api/me').length).toBeGreaterThan(0));
    expect(queryClient.getQueryData<Me>(sessionQuery.queryKey)?.email).toBe(next);
  });

  it('wrong code shows the inline error and keeps the code step', async () => {
    const { user } = setup({
      'POST /api/me/email-change': () => new Response(null, { status: 204 }),
      'POST /api/me/email-change/confirm': () => json({ error: 'invalid_code' }, 400),
    });
    await reachCodeStep(user, 'new@example.com');
    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The code is wrong or has expired');
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('We sent a code to new@example.com')).toBeInTheDocument();
  });

  it('email_taken shows its message', async () => {
    const { user } = setup({
      'POST /api/me/email-change': () => new Response(null, { status: 204 }),
      'POST /api/me/email-change/confirm': () => json({ error: 'email_taken' }, 409),
    });
    await reachCodeStep(user, 'taken@example.com');
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('This address belongs to another account')).toBeInTheDocument();
  });
});
