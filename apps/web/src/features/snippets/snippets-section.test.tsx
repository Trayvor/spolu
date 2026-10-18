import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Snippet } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { SnippetsSection } from './snippets-section';

const SNIPPETS: Snippet[] = [
  {
    id: 's1',
    title: 'Ďakujeme',
    body: 'Ďakujeme, {{name}}.',
    shared: false,
    mine: true,
    authorName: 'Ada',
    updatedAt: '2026-10-18T10:00:00.000Z',
  },
  {
    id: 's2',
    title: 'Prístup',
    body: 'Potrebujeme prístup.',
    shared: true,
    mine: false,
    authorName: 'Ben',
    updatedAt: '2026-10-18T10:00:00.000Z',
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(createStatus = 201) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = new URL(input, 'http://localhost').pathname;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (method === 'GET') return json(SNIPPETS);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST' && createStatus !== 201) {
        return json({ error: 'snippet_limit' }, createStatus);
      }
      return json({ ...SNIPPETS[0], ...body }, method === 'POST' ? 201 : 200);
    }),
  );
  return calls;
}

function renderSection() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SnippetsSection />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeAll(async () => {
  await setLanguage('en');
  await loadNamespace('snippets');
});
afterEach(() => vi.unstubAllGlobals());

describe('SnippetsSection (F7)', () => {
  it('lists own and shared replies; only the own one can be edited or deleted', async () => {
    stub();
    renderSection();
    const own = (await screen.findByText('Ďakujeme')).closest('li')!;
    expect(within(own).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    const shared = screen.getByText('Prístup').closest('li')!;
    expect(within(shared).getByText('Shared by Ben')).toBeInTheDocument();
    expect(within(shared).queryByRole('button', { name: 'Edit' })).toBeNull();
    // The placeholder is shown literally, not interpolated.
    expect(screen.getAllByText(/\{\{name\}\}/).length).toBeGreaterThan(0);
  });

  it('adds a shared reply', async () => {
    const calls = stub();
    const user = renderSection();
    await screen.findByText('Ďakujeme');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Prístup do eGrantu');
    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'Pošlite nám prístup.');
    await user.click(screen.getByRole('checkbox', { name: /Share with all admins/ }));
    await user.click(screen.getByRole('button', { name: 'Save reply' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/snippets',
        body: { title: 'Prístup do eGrantu', body: 'Pošlite nám prístup.', shared: true },
      }),
    );
  });

  it('asks for both fields, and says when the limit is reached', async () => {
    stub(409);
    const user = renderSection();
    await screen.findByText('Ďakujeme');
    await user.click(screen.getByRole('button', { name: 'Save reply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Fill in the name and the text.');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'A');
    await user.type(screen.getByRole('textbox', { name: 'Text' }), 'B');
    await user.click(screen.getByRole('button', { name: 'Save reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('(200)');
  });

  it('deletes an own reply after the inline confirmation', async () => {
    const calls = stub();
    const user = renderSection();
    const own = (await screen.findByText('Ďakujeme')).closest('li')!;
    await user.click(within(own).getByRole('button', { name: 'Delete' }));
    const confirm = within(own).getByRole('group', { name: 'Delete the reply “Ďakujeme”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/api/snippets/s1', body: undefined }),
    );
  });
});
