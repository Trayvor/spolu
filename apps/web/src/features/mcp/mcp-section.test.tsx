import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { McpConnection, McpToken } from '@spolu/shared';
import { i18n } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { McpSection } from './mcp-section';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const token = (over: Partial<McpToken> = {}): McpToken => ({
  id: 't1',
  name: 'Claude laptop',
  prefix: 'spolu_mcp_Ab3d',
  scope: 'read',
  createdAt: '2026-10-18T08:00:00.000Z',
  expiresAt: '2027-01-16T08:00:00.000Z',
  lastUsedAt: null,
  expired: false,
  ...over,
});

const connection = (over: Partial<McpConnection> = {}): McpConnection => ({
  id: 'g1',
  clientName: 'Claude',
  redirectHost: 'claude.ai',
  scope: 'write',
  createdAt: '2026-10-18T08:00:00.000Z',
  lastUsedAt: '2026-10-18T09:00:00.000Z',
  ...over,
});

function setup(
  options: { tokens?: McpToken[]; connections?: McpConnection[]; createStatus?: number } = {},
) {
  let tokens = options.tokens ?? [];
  let connections = options.connections ?? [];
  const posts: unknown[] = [];
  const deletes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/me/mcp/tokens' && method === 'GET') return json(tokens);
      if (url === '/api/me/mcp/connections' && method === 'GET') return json(connections);
      if (url.startsWith('/api/me/mcp/connections/') && method === 'DELETE') {
        const id = url.split('/').pop()!;
        deletes.push(id);
        connections = connections.filter((c) => c.id !== id);
        return new Response(null, { status: 204 });
      }
      if (url === '/api/me/mcp/audit') {
        return json([
          {
            id: 'a1',
            tool: 'create_task',
            targetId: 'x',
            ok: false,
            status: 403,
            createdAt: '2026-10-18T09:00:00.000Z',
            tokenName: 'Claude laptop',
          },
        ]);
      }
      if (url === '/api/me/mcp/tokens' && method === 'POST') {
        posts.push(JSON.parse(init!.body as string));
        if (options.createStatus) return json({ error: 'mcp_token_limit' }, options.createStatus);
        const item = token({ id: 't2', name: 'New', scope: 'write' });
        tokens = [item, ...tokens];
        return json({ token: 'spolu_mcp_SECRET123', item }, 201);
      }
      if (url.startsWith('/api/me/mcp/tokens/') && method === 'DELETE') {
        const id = url.split('/').pop()!;
        deletes.push(id);
        tokens = tokens.filter((t) => t.id !== id);
        return new Response(null, { status: 204 });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <McpSection />
    </QueryClientProvider>,
  );
  return { posts, deletes, user: userEvent.setup() };
}

describe('McpSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
    await loadAllNamespaces();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the tokens and the refused AI change', async () => {
    setup({ tokens: [token()] });
    expect(await screen.findByText('Claude laptop', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Not used yet')).toBeInTheDocument();
    expect(await screen.findByText('create_task')).toBeInTheDocument();
    expect(screen.getByText('refused')).toBeInTheDocument();
  });

  it('creates a token, shows it once with the Claude Code command', async () => {
    const { posts, user } = setup();
    await screen.findByText('No tokens yet. Create one to connect an assistant.');
    await user.type(screen.getByLabelText('Name'), 'New');
    await user.click(screen.getByLabelText(/Read and change/));
    await user.selectOptions(screen.getByLabelText('Valid for'), '30');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(posts).toEqual([{ name: 'New', scope: 'write', expiresInDays: 30 }]);
    expect(await screen.findByDisplayValue('spolu_mcp_SECRET123')).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http help .*\/mcp/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue('spolu_mcp_SECRET123')).not.toBeInTheDocument();
  });

  it('asks for a name and explains the token limit', async () => {
    const { posts, user } = setup({ createStatus: 409 });
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name for the token.');
    expect(posts).toEqual([]);
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/10 active tokens/));
  });

  it('shows how to connect Claude with the address, and disconnects a connection', async () => {
    const { deletes, user } = setup({ connections: [connection()] });
    expect(await screen.findByText('Claude', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Read and change, claude.ai')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect assistant' }));
    expect(deletes).toEqual(['g1']);
    expect(await screen.findByText('No assistant connected yet.')).toBeInTheDocument();
  });

  it('revokes a token after a confirm', async () => {
    const { deletes, user } = setup({ tokens: [token()] });
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke token' }));
    expect(deletes).toEqual(['t1']);
    expect(
      await screen.findByText('No tokens yet. Create one to connect an assistant.'),
    ).toBeInTheDocument();
  });
});
