import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const USER = {
  id: 'u1',
  name: 'Jana Nováková',
  email: 'jana@example.com',
  role: 'admin',
  groupId: null,
};

type Reply = { status: number; body: unknown };
const json = (status: number, body: unknown): Reply => ({ status, body });

/** Fake `fetch`: `/api/me` is 401 until `loggedIn`; auth calls answer from `replies`. */
function mockApi(replies: { send?: Reply; verify?: Reply[]; loggedIn?: boolean } = {}) {
  const state = { loggedIn: replies.loggedIn ?? false };
  const verify = [...(replies.verify ?? [])];
  const fetchMock = vi.fn(async (url: string) => {
    let reply: Reply;
    if (url === '/api/me') {
      reply = state.loggedIn ? json(200, USER) : json(401, { error: 'unauthorized' });
    } else if (url === '/api/auth/email-otp/send-verification-otp') {
      reply = replies.send ?? json(200, { success: true });
    } else if (url === '/api/auth/sign-in/email-otp') {
      reply = verify.shift() ?? json(200, { ok: true });
      if (reply.status === 200) state.loggedIn = true;
    } else {
      reply = json(404, {});
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (path: string) =>
    fetchMock.mock.calls
      .filter(([url]) => url === path)
      .map(
        (call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as unknown,
      );
  return { calls, fetchMock };
}

function renderAt(path: string, userOptions?: Parameters<typeof userEvent.setup>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup(userOptions) };
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

async function toCodeStep(user: ReturnType<typeof userEvent.setup>, email = ' jana@example.com ') {
  await user.type(await screen.findByLabelText(t('login.email')), email);
  await user.click(screen.getByRole('button', { name: t('login.sendCode') }));
  return screen.findByLabelText(t('login.code'));
}

describe('login page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('an anonymous visit to / redirects to /login?redirect=%2F', async () => {
    mockApi();
    const { router } = renderAt('/');
    expect(await screen.findByLabelText(t('login.email'))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.href).toBe('/login?redirect=%2F');
  });

  it('email step sends the trimmed email and shows the code step with the email', async () => {
    const api = mockApi();
    const { user } = renderAt('/login');
    await toCodeStep(user);

    expect(api.calls('/api/auth/email-otp/send-verification-otp')).toEqual([
      { email: 'jana@example.com', type: 'sign-in' },
    ]);
    expect(
      screen.getByText(t('login.codeIntro', { email: 'jana@example.com' })),
    ).toBeInTheDocument();
  });

  it('invalid email shows the field error and sends nothing', async () => {
    const api = mockApi();
    const { user } = renderAt('/login');
    await user.type(await screen.findByLabelText(t('login.email')), 'not-an-email');
    await user.click(screen.getByRole('button', { name: t('login.sendCode') }));

    expect(screen.getByText(t('login.errors.invalidEmail'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('login.email'))).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('/api/auth/email-otp/send-verification-otp')).toEqual([]);
  });

  it('six pasted digits submit the code', async () => {
    const api = mockApi();
    const { user } = renderAt('/login');
    const code = await toCodeStep(user);
    await user.click(code);
    await user.paste('123456');

    await waitFor(() =>
      expect(api.calls('/api/auth/sign-in/email-otp')).toEqual([
        { email: 'jana@example.com', otp: '123456' },
      ]),
    );
  });

  it('keeps digits only', async () => {
    mockApi();
    const { user } = renderAt('/login');
    const code = await toCodeStep(user);
    await user.type(code, '1a2b3');
    expect(code).toHaveValue('123');
  });

  it('INVALID_OTP shows attempts left 2 then 1, the third shows the expired message', async () => {
    mockApi({
      verify: [
        json(400, { message: 'x', code: 'INVALID_OTP' }),
        json(400, { message: 'x', code: 'INVALID_OTP' }),
        json(400, { message: 'x', code: 'INVALID_OTP' }),
      ],
    });
    const { user } = renderAt('/login');
    const code = await toCodeStep(user);
    await user.type(code, '111111');
    expect(await screen.findByText(t('login.errors.wrongCode', { count: 2 }))).toBeInTheDocument();
    expect(code).toHaveValue('');

    await user.type(code, '222222');
    expect(await screen.findByText(t('login.errors.wrongCode', { count: 1 }))).toBeInTheDocument();
    expect(t('login.errors.wrongCode', { count: 1 })).toBe(
      'The code does not match. Attempts left: 1.',
    );

    await user.type(code, '333333');
    expect(await screen.findByText(t('login.errors.expired'))).toBeInTheDocument();
    expect(screen.queryByText(/Attempts left: 0/)).not.toBeInTheDocument();
  });

  it('OTP_EXPIRED shows the expired message', async () => {
    mockApi({ verify: [json(400, { message: 'x', code: 'OTP_EXPIRED' })] });
    const { user } = renderAt('/login');
    await user.type(await toCodeStep(user), '111111');
    expect(await screen.findByText(t('login.errors.expired'))).toBeInTheDocument();
  });

  it('TOO_MANY_ATTEMPTS shows the expired message', async () => {
    mockApi({ verify: [json(403, { message: 'x', code: 'TOO_MANY_ATTEMPTS' })] });
    const { user } = renderAt('/login');
    await user.type(await toCodeStep(user), '111111');
    expect(await screen.findByText(t('login.errors.expired'))).toBeInTheDocument();
  });

  it('ACCOUNT_DISABLED shows the disabled message', async () => {
    mockApi({ verify: [json(403, { message: 'x', code: 'ACCOUNT_DISABLED' })] });
    const { user } = renderAt('/login');
    await user.type(await toCodeStep(user), '111111');
    expect(await screen.findByText(t('login.errors.disabled'))).toBeInTheDocument();
  });

  it('an unknown error shows the generic message', async () => {
    mockApi({ verify: [json(500, { message: 'boom' })] });
    const { user } = renderAt('/login');
    await user.type(await toCodeStep(user), '111111');
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();
  });

  it('429 shows too many attempts', async () => {
    mockApi({ verify: [json(429, { message: 'Too many requests' })] });
    const { user } = renderAt('/login');
    await user.type(await toCodeStep(user), '111111');
    expect(await screen.findByText(t('login.errors.tooMany'))).toBeInTheDocument();
  });

  it('Send again is disabled for 30 s', async () => {
    const api = mockApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderAt('/login', { advanceTimers: vi.advanceTimersByTime });
    await toCodeStep(user);

    const wait = t('login.sendAgainIn', { seconds: 30 });
    expect(screen.getByRole('button', { name: wait })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(
      screen.getByRole('button', { name: t('login.sendAgainIn', { seconds: 20 }) }),
    ).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    const again = screen.getByRole('button', { name: t('login.sendAgain') });
    expect(again).toBeEnabled();

    await user.click(again);
    expect(api.calls('/api/auth/email-otp/send-verification-otp')).toHaveLength(2);
    expect(await screen.findByRole('button', { name: wait })).toBeDisabled();
  });

  it('after Send again the focus moves to the code field', async () => {
    mockApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderAt('/login', { advanceTimers: vi.advanceTimersByTime });
    await toCodeStep(user);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    await user.click(screen.getByRole('button', { name: t('login.sendAgain') }));

    await waitFor(() => expect(screen.getByLabelText(t('login.code'))).toHaveFocus());
  });

  it('a failed resend shows its error without marking the code field invalid', async () => {
    const api = mockApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderAt('/login', { advanceTimers: vi.advanceTimersByTime });
    const code = await toCodeStep(user);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    api.fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 429 }));
    await user.click(screen.getByRole('button', { name: t('login.sendAgain') }));

    expect(await screen.findByText(t('login.errors.tooMany'))).toBeInTheDocument();
    expect(code).not.toHaveAttribute('aria-invalid');
  });

  it('a wrong code marks the code field invalid', async () => {
    mockApi({ verify: [json(400, { message: 'x', code: 'INVALID_OTP' })] });
    const { user } = renderAt('/login');
    const code = await toCodeStep(user);
    await user.type(code, '111111');
    await screen.findByText(t('login.errors.wrongCode', { count: 2 }));
    expect(code).toHaveAttribute('aria-invalid', 'true');
  });

  it('Change email returns to step 1', async () => {
    mockApi();
    const { user } = renderAt('/login');
    await toCodeStep(user);
    await user.click(screen.getByRole('button', { name: t('login.changeEmail') }));

    expect(await screen.findByLabelText(t('login.email'))).toHaveValue('jana@example.com');
    expect(screen.queryByLabelText(t('login.code'))).not.toBeInTheDocument();
  });

  it('success navigates to the redirect target', async () => {
    mockApi();
    const { router, user } = renderAt('/login?redirect=%2Fsettings');
    await user.type(await toCodeStep(user), '123456');

    expect(await screen.findByRole('heading', { name: t('nav.settings') })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('a foreign redirect target lands on the home page (an admin: the dashboard at /)', async () => {
    mockApi();
    const { router, user } = renderAt('/login?redirect=https%3A%2F%2Fevil.example');
    await user.type(await toCodeStep(user), '123456');

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('a signed-in user opening /login is sent home (an admin: the dashboard at /)', async () => {
    mockApi({ loggedIn: true });
    const { router } = renderAt('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
