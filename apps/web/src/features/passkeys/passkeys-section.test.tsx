import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Passkey } from '@spolu/shared';
import { i18n } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { PasskeysSection } from './passkeys-section';

// The browser's WebAuthn dialog: the e2e test drives a virtual authenticator.
const browser = vi.hoisted(() => ({
  supported: true,
  create: vi.fn<(options: unknown) => Promise<unknown>>(),
}));
vi.mock('./webauthn', () => ({
  canCreatePasskeys: () => browser.supported,
  createPasskeyResponse: (options: unknown) => browser.create(options),
  isPasskeyCancel: (e: unknown) => e instanceof Error && e.name === 'NotAllowedError',
}));

const ME = {
  id: 'u1',
  name: 'Jana',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const OPTIONS = { challenge: 'abc', rp: { id: 'localhost', name: 'Help by eGrant' } };
const RESPONSE = { id: 'cred', type: 'public-key', response: {} };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const passkey = (over: Partial<Passkey> = {}): Passkey => ({
  id: 'p1',
  name: 'Work laptop',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastUsedAt: null,
  ...over,
});

function setup(options: { list?: Passkey[]; stale?: boolean; limit?: boolean } = {}) {
  let list = options.list ?? [];
  let stale = options.stale ?? false;
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/me') return json(ME);
      if (url === '/api/me/passkeys' && method === 'GET') return json(list);
      if (url === '/api/me/passkeys/options') {
        if (options.limit) return json({ error: 'passkey_limit' }, 409);
        const code = (body as { code?: string }).code;
        if (stale && code === undefined) return json({ error: 'reauth_required' }, 403);
        if (stale && code !== '123456') return json({ error: 'invalid_code' }, 400);
        stale = false;
        return json(OPTIONS);
      }
      if (url === '/api/me/passkeys/reauth') return new Response(null, { status: 204 });
      if (url === '/api/me/passkeys' && method === 'POST') {
        const created = passkey({ id: 'p2', name: (body as { name: string }).name });
        list = [...list, created];
        return json(created, 201);
      }
      if (url.startsWith('/api/me/passkeys/') && method === 'DELETE') {
        list = list.filter((p) => p.id !== url.split('/').pop());
        return new Response(null, { status: 204 });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PasskeysSection />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

describe('PasskeysSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
    await loadAllNamespaces();
  });
  beforeEach(() => {
    browser.supported = true;
    browser.create.mockReset();
    browser.create.mockResolvedValue(RESPONSE);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the passkeys with when they were added and last used', async () => {
    setup({
      list: [
        passkey(),
        passkey({ id: 'p3', name: 'Phone', lastUsedAt: '2026-10-18T09:00:00.000Z' }),
      ],
    });
    expect(await screen.findByText('Work laptop')).toBeInTheDocument();
    expect(screen.getByText(t('passkeys.list.neverUsed'))).toBeInTheDocument();
    expect(screen.getByText(/^Last used/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Added/)).toHaveLength(2);
  });

  it('adds a passkey with a fresh session', async () => {
    const { calls, user } = setup();
    await screen.findByText(t('passkeys.list.empty'));
    await user.type(screen.getByLabelText(t('passkeys.add.name')), 'Phone');
    await user.click(screen.getByRole('button', { name: t('passkeys.add.submit') }));
    expect(await screen.findByText('Phone')).toBeInTheDocument();
    expect(browser.create).toHaveBeenCalledWith(OPTIONS);
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/me/passkeys')?.body).toEqual({
      name: 'Phone',
      response: RESPONSE,
    });
    expect(screen.getByRole('status')).toHaveTextContent(t('passkeys.add.added'));
  });

  it('a stale session asks for the emailed code first', async () => {
    const { calls, user } = setup({ stale: true });
    await screen.findByText(t('passkeys.list.empty'));
    await user.type(screen.getByLabelText(t('passkeys.add.name')), 'Phone');
    await user.click(screen.getByRole('button', { name: t('passkeys.add.submit') }));

    const code = await screen.findByLabelText(t('passkeys.reauth.code'));
    expect(screen.getByText(t('passkeys.reauth.intro', { email: ME.email }))).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/me/passkeys/reauth')).toBe(true);
    expect(browser.create).not.toHaveBeenCalled();

    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: t('passkeys.reauth.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('passkeys.reauth.wrong'));

    await user.clear(screen.getByLabelText(t('passkeys.reauth.code')));
    await user.type(screen.getByLabelText(t('passkeys.reauth.code')), '123456');
    await user.click(screen.getByRole('button', { name: t('passkeys.reauth.submit') }));
    expect(await screen.findByText('Phone')).toBeInTheDocument();
  });

  it('needs a name, and says when the limit is reached', async () => {
    const { user } = setup({ limit: true });
    await screen.findByText(t('passkeys.list.empty'));
    await user.click(screen.getByRole('button', { name: t('passkeys.add.submit') }));
    expect(screen.getByRole('alert')).toHaveTextContent(t('passkeys.add.nameRequired'));
    await user.type(screen.getByLabelText(t('passkeys.add.name')), 'Phone');
    await user.click(screen.getByRole('button', { name: t('passkeys.add.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Delete one before adding another/);
  });

  it('a cancelled browser dialog adds nothing and says nothing', async () => {
    browser.create.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const { calls, user } = setup();
    await screen.findByText(t('passkeys.list.empty'));
    await user.type(screen.getByLabelText(t('passkeys.add.name')), 'Phone');
    await user.click(screen.getByRole('button', { name: t('passkeys.add.submit') }));
    await waitFor(() => expect(browser.create).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/me/passkeys')).toBe(false);
  });

  it('deletes a passkey after a confirmation', async () => {
    const { user } = setup({ list: [passkey()] });
    await user.click(await screen.findByRole('button', { name: t('passkeys.list.delete') }));
    expect(screen.getByText(t('passkeys.list.confirm'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('passkeys.list.deleteConfirm') }));
    expect(await screen.findByText(t('passkeys.list.empty'))).toBeInTheDocument();
  });

  it('a browser without passkeys gets a note instead of the form', async () => {
    browser.supported = false;
    setup({ list: [passkey()] });
    expect(await screen.findByText(t('passkeys.add.unsupported'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('passkeys.add.submit') }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('Work laptop')).toBeInTheDocument();
  });
});
