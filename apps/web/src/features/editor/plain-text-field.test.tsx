import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ADMIN_AI_TARGET } from '@/features/chat/ai-tools/api';
import { setLanguage } from '@/i18n';
import { PlainTextField } from './plain-text-field';
import { toLines } from './plain-text-tools';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(answer: string, tools = { text: true, translate: null, voice: true }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      calls.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname === '/api/ai/admin/ai-tools') return json(tools);
      if (url.pathname === '/api/ai/admin/ai-text') return json({ text: answer });
      return json({ error: 'forbidden' }, 403);
    }),
  );
  return calls;
}

function Harness({ initial, lines }: { initial: string; lines?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <PlainTextField
      id="f"
      label="Decisions"
      value={value}
      onChange={setValue}
      target={ADMIN_AI_TARGET}
      lines={lines}
    />
  );
}

function renderField(initial: string, lines?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} lines={lines} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeAll(async () => {
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('PlainTextField', () => {
  it('toLines keeps one entry per line: no list markers, no blank lines', () => {
    expect(toLines('- one\n\n2. two\n  * three\nplain')).toBe('one\ntwo\nthree\nplain');
  });

  it('shows the textarea at once and the tools after the admin route answers', async () => {
    const calls = stub('x');
    renderField('ahoj');
    expect(screen.getByRole('textbox', { name: 'Decisions' })).toHaveValue('ahoj');
    expect(await screen.findByRole('button', { name: 'AI tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'GET', path: '/api/ai/admin/ai-tools' });
  });

  it('hides the tools when the route offers none (not an admin, AI off)', async () => {
    stub('x', { text: false, translate: null, voice: false });
    renderField('ahoj');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'AI tools' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull();
  });

  it('the AI answer replaces the text, one entry per line in lines mode', async () => {
    const calls = stub('- Approve the budget\n- Hire Anna');
    const user = renderField('approve budget\nhire anna', true);
    await user.click(await screen.findByRole('button', { name: 'AI tools' }));
    await user.click(screen.getByRole('menuitem', { name: 'Fix mistakes' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Decisions' })).toHaveValue(
        'Approve the budget\nHire Anna',
      ),
    );
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/ai/admin/ai-text',
      body: { action: 'fix', text: 'approve budget\nhire anna' },
    });
  });
});
