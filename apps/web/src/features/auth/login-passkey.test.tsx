import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createAppRouter } from '@/router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

// The WebAuthn side is the browser's (and the e2e test's); here only what the page does with it.
const passkey = vi.hoisted(() => ({
  supported: true,
  autofill: false,
  signIn: vi.fn<(opts?: { autofill?: boolean }) => Promise<void>>(),
  cancel: vi.fn(async () => {}),
}));
vi.mock('@/features/auth/passkey', () => ({
  passkeysSupported: () => passkey.supported,
  passkeyAutofillSupported: async () => passkey.autofill,
  signInWithPasskey: (opts?: { autofill?: boolean }) => passkey.signIn(opts),
  cancelPasskey: () => passkey.cancel(),
  isPasskeyCancel: (e: unknown) => e instanceof Error && e.name === 'NotAllowedError',
}));

const USER = {
  id: 'u1',
  name: 'Jana Nováková',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};

let loggedIn = false;
function mockApi() {
  loggedIn = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/me' && loggedIn
        ? new Response(JSON.stringify(USER), { status: 200 })
        : new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    ),
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
  return { router, user: userEvent.setup() };
}

const t = (key: string) => i18n.t(key);

describe('login with a passkey', () => {
  beforeEach(async () => {
    await setLanguage('en');
    passkey.supported = true;
    passkey.autofill = false;
    passkey.signIn.mockReset();
    passkey.cancel.mockClear();
    mockApi();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers the passkey next to the email code and signs in with it', async () => {
    passkey.signIn.mockImplementation(async () => {
      loggedIn = true;
    });
    const { router, user } = renderAt('/login?redirect=%2Fsettings');
    // The email code stays the default: its field and button come first.
    expect(await screen.findByLabelText(t('login.email'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('login.sendCode') })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('login.passkey.button') }));
    expect(passkey.signIn).toHaveBeenCalledWith({ autofill: false });
    expect(await screen.findByRole('heading', { name: t('nav.settings') })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('a passkey the server refuses points to the email code', async () => {
    passkey.signIn.mockRejectedValue(
      new ApiError('refused', 400, { code: 'PASSKEY_INVALID', message: 'x' }),
    );
    const { user } = renderAt('/login');
    await user.click(await screen.findByRole('button', { name: t('login.passkey.button') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('login.passkey.invalid'));
  });

  it('a cancelled passkey dialog says nothing', async () => {
    passkey.signIn.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const { user } = renderAt('/login');
    await user.click(await screen.findByRole('button', { name: t('login.passkey.button') }));
    await waitFor(() => expect(passkey.signIn).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts the autofill sign-in where the browser supports it', async () => {
    passkey.autofill = true;
    passkey.signIn.mockReturnValue(new Promise(() => {})); // waits for the person
    renderAt('/login');
    const email = await screen.findByLabelText(t('login.email'));
    expect(email).toHaveAttribute('autocomplete', 'username webauthn');
    await waitFor(() => expect(passkey.signIn).toHaveBeenCalledWith({ autofill: true }));
  });

  it('without WebAuthn there is no passkey button and no autofill', async () => {
    passkey.supported = false;
    renderAt('/login');
    expect(await screen.findByLabelText(t('login.email'))).toHaveAttribute('autocomplete', 'email');
    expect(
      screen.queryByRole('button', { name: t('login.passkey.button') }),
    ).not.toBeInTheDocument();
    expect(passkey.signIn).not.toHaveBeenCalled();
  });
});
