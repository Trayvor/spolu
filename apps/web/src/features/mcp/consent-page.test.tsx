import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { McpConsentInfo } from '@spolu/shared';
import { i18n } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { ConsentPage, readAuthorizeParams } from './consent-page';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const params = {
  response_type: 'code',
  client_id: 'mcpc_1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  state: '1e5',
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
};

const consent = (over: Partial<Extract<McpConsentInfo, { kind: 'consent' }>> = {}) => ({
  kind: 'consent' as const,
  clientName: 'Claude',
  redirectHost: 'claude.ai',
  requestedScope: 'write' as const,
  consentToken: 'exp.mac',
  limitReached: false,
  ...over,
});

function setup(info: { status?: number; body: unknown }, decision = { status: 200, body: {} }) {
  const posts: unknown[] = [];
  const gets: string[] = [];
  const assign = vi.fn();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        gets.push(url);
        return json(info.body, info.status ?? 200);
      }
      posts.push(JSON.parse(init!.body as string));
      return json(decision.body, decision.status);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConsentPage params={params} navigate={assign} />
    </QueryClientProvider>,
  );
  return { posts, gets, assign, user: userEvent.setup() };
}

describe('ConsentPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
    await loadAllNamespaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the parameters as the strings the client sent', () => {
    expect(readAuthorizeParams('?state=1e5&client_id=a&other=x')).toEqual({
      state: '1e5',
      client_id: 'a',
    });
  });

  it('shows who asks and where it returns, and approves with the chosen scope', async () => {
    const target = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=1e5';
    const { posts, gets, assign, user } = setup(
      { body: consent() },
      { status: 200, body: { redirectTo: target } },
    );
    expect(await screen.findByText('Claude wants to use Help as you')).toBeInTheDocument();
    expect(gets[0]).toContain('state=1e5');
    expect(screen.getByText('After your answer you return to claude.ai.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Read and change/)).toBeChecked();
    await user.click(screen.getByLabelText(/Read only/));
    await user.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(posts).toEqual([{ params, consentToken: 'exp.mac', approve: true, scope: 'read' }]);
    expect(assign).toHaveBeenCalledWith(target);
  });

  it('offers only read when the client asked only for read, and denies', async () => {
    const target = 'https://claude.ai/api/mcp/auth_callback?error=access_denied';
    const { posts, assign, user } = setup(
      { body: consent({ requestedScope: 'read' }) },
      { status: 200, body: { redirectTo: target } },
    );
    await screen.findByText('Claude wants to use Help as you');
    expect(screen.queryByLabelText(/Read and change/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(posts).toEqual([{ params, consentToken: 'exp.mac', approve: false, scope: 'read' }]);
    expect(assign).toHaveBeenCalledWith(target);
  });

  it('tells a non-admin and an invalid link apart, and never leaves the site for them', async () => {
    const first = setup({ status: 403, body: { error: 'forbidden' } });
    expect(
      await screen.findByText('Only admins can connect an AI assistant to Help.'),
    ).toBeInTheDocument();
    expect(first.assign).not.toHaveBeenCalled();
  });

  it('says a link is invalid', async () => {
    const { assign } = setup({ status: 400, body: { error: 'invalid_redirect_uri' } });
    expect(await screen.findByText(/This connection link is not valid/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('explains the connection limit', async () => {
    setup({ body: consent({ limitReached: true }) });
    expect(await screen.findByText(/You have 10 connected assistants/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow access' })).toBeDisabled();
  });
});
