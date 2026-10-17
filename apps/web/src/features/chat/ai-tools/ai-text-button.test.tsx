import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiToolsInfo } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { AiTextButton } from './ai-text-button';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(tools: AiToolsInfo, answer: (body: Record<string, unknown>) => Response) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/ai-tools')) return json(tools);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posts.push(body);
      return answer(body);
    }),
  );
  return posts;
}

/** The button around a plain textarea standing in for the composer's draft. */
function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <textarea aria-label="Draft" value={text} onChange={(e) => setText(e.target.value)} />
      <AiTextButton target={{ kind: 'channel', id: 'c1' }} getText={() => text} setText={setText} />
    </>
  );
}

function renderButton(initial = 'ahoj ako sa mas') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const draft = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' });
const openMenu = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'AI tools' }));

beforeAll(async () => {
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('AiTextButton', () => {
  it('is hidden when the channel offers no text tools', async () => {
    stub({ text: false, translate: null, voice: true }, () => json({}));
    renderButton();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'AI tools' })).not.toBeInTheDocument();
  });

  it('replaces the draft with the fixed text, and Undo brings the old one back', async () => {
    const posts = stub({ text: true, translate: null, voice: false }, () =>
      json({ text: 'Ahoj, ako sa máš?' }),
    );
    renderButton();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: /Translate/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix mistakes' }));
    await waitFor(() => expect(draft().value).toBe('Ahoj, ako sa máš?'));
    expect(posts).toEqual([{ action: 'fix', text: 'ahoj ako sa mas' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(draft().value).toBe('ahoj ako sa mas');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('Undo goes away once the draft is edited', async () => {
    stub({ text: true, translate: null, voice: false }, () => json({ text: 'Formal text' }));
    renderButton();
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make it formal' }));
    await screen.findByRole('button', { name: 'Undo' });
    await userEvent.type(draft(), '!');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('offers Translate to English and to the client language off .sk', async () => {
    const posts = stub({ text: true, translate: { clientLanguage: 'cs' }, voice: false }, () =>
      json({ text: 'Ahoj' }),
    );
    renderButton('hello');
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Translate to English' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Translate to Czech' }));
    await waitFor(() => expect(draft().value).toBe('Ahoj'));
    expect(posts).toEqual([{ action: 'translate', target: 'client', text: 'hello' }]);
  });

  it('keeps the draft and says so when the AI fails or is rate-limited', async () => {
    let status = 502;
    stub({ text: true, translate: null, voice: false }, () => json({ error: 'x' }, status));
    renderButton();
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix mistakes' }));
    expect(await screen.findByText("The AI couldn't rewrite the text. Try again.")).toBeVisible();
    expect(draft().value).toBe('ahoj ako sa mas');
    status = 429;
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix mistakes' }));
    expect(await screen.findByText('Too many requests. Try again in a minute.')).toBeVisible();
  });

  it('disables the actions while the draft is empty', async () => {
    stub({ text: true, translate: null, voice: false }, () => json({ text: 'x' }));
    renderButton('  ');
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Fix mistakes' })).toHaveAttribute('data-disabled');
  });
});
