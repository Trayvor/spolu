import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiToolsInfo, LinkedKnowledge } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { DescriptionField } from './description-field';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const NOW = '2026-10-17T10:00:00.000Z';
const summary = (id: string, title: string) => ({
  id,
  groupId: 'g1',
  type: 'note',
  visibility: 'public',
  title,
  excerpt: '',
  url: null,
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Anna' },
  createdAt: NOW,
  updatedAt: NOW,
  folderId: null,
  folderPath: [],
});

/** Stubs the group's routes; records every call as "METHOD /path". */
function stub(tools: AiToolsInfo = { text: true, translate: null, voice: true }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        path: url.pathname,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname === '/api/groups/g1/ai-tools') return json(tools);
      if (url.pathname === '/api/groups/g1/ai-text') return json({ text: 'Formal text.' });
      if (url.pathname === '/api/groups/g1/people') return json([]);
      if (url.pathname === '/api/groups/g1/knowledge') {
        return json({
          items: [summary('k1', 'Postup'), summary('k2', 'Kontakty')],
          nextCursor: null,
        });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  return calls;
}

function Harness({
  initial = '',
  linked,
  onValue,
}: {
  initial?: string;
  linked?: LinkedKnowledge;
  onValue?: (v: { text: string; linked?: LinkedKnowledge }) => void;
}) {
  const [text, setText] = useState(initial);
  const [items, setItems] = useState<LinkedKnowledge | undefined>(linked);
  return (
    <DescriptionField
      id="d"
      groupId="g1"
      value={text}
      onChange={(next) => {
        setText(next);
        onValue?.({ text: next, linked: items });
      }}
      label="Description"
      editLabel="Edit description"
      knowledge={
        items && {
          items,
          onChange: (next) => {
            setItems(next);
            onValue?.({ text, linked: next });
          },
        }
      }
    />
  );
}

function renderField(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const editor = () => screen.findByRole('textbox', { name: 'Description' });

beforeAll(async () => {
  await setLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('DescriptionField', () => {
  it('shows a saved text rendered, and loads the editor only on Edit', async () => {
    stub();
    const user = renderField({ initial: 'Check **totals**' });
    expect(screen.getByText('totals').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    const box = await editor();
    expect(box).toHaveTextContent('Check totals');
    await waitFor(() => expect(box).toHaveFocus());
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    for (const name of ['Bold', 'Italic', 'Link', 'Quote', 'Code']) {
      expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens an empty field in the editor; Enter makes a new line, never a send', async () => {
    stub();
    const onValue = vi.fn();
    const user = renderField({ onValue });
    const box = await editor();
    await user.click(box);
    await user.type(box, 'one{Enter}two');
    expect(onValue).toHaveBeenLastCalledWith({ text: 'one\ntwo', linked: undefined });
  });

  it('the AI button calls the group route and replaces the text', async () => {
    const calls = stub({ text: true, translate: null, voice: false });
    const onValue = vi.fn();
    const user = renderField({ initial: 'ahoj', onValue });
    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await editor();
    await user.click(await screen.findByRole('button', { name: 'AI tools' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make it formal' }));
    await waitFor(() =>
      expect(onValue).toHaveBeenLastCalledWith({ text: 'Formal text.', linked: undefined }),
    );
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/groups/g1/ai-text',
      body: { action: 'formal', text: 'ahoj' },
    });
    // Undo brings the text back.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onValue).toHaveBeenLastCalledWith({ text: 'ahoj', linked: undefined });
  });

  it('shows the microphone when the group offers voice', async () => {
    stub({ text: false, translate: null, voice: true });
    renderField();
    await editor();
    expect(await screen.findByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI tools' })).toBeNull();
  });

  it('attaches knowledge from the picker and removes it again', async () => {
    stub();
    const onValue = vi.fn();
    const user = renderField({ linked: [], onValue });
    await editor();
    await user.click(screen.getByRole('button', { name: 'Attach from Knowledge' }));
    await user.click(await screen.findByRole('checkbox', { name: /Postup/ }));
    await user.click(screen.getByRole('button', { name: 'Attach (1)' }));
    const list = await screen.findByRole('list', { name: 'Attached knowledge items' });
    expect(within(list).getByText('Postup')).toBeInTheDocument();
    expect(onValue).toHaveBeenLastCalledWith({
      text: '',
      linked: [{ id: 'k1', available: true, type: 'note', title: 'Postup', folderPath: [] }],
    });
    await user.click(screen.getByRole('button', { name: 'Remove Postup' }));
    expect(onValue).toHaveBeenLastCalledWith({ text: '', linked: [] });
  });

  it('keeps an unavailable item listed until it is removed', async () => {
    stub();
    const user = renderField({ initial: 'Text', linked: [{ id: 'gone', available: false }] });
    expect(await screen.findByText('Item unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    await editor();
    expect(screen.getByRole('button', { name: 'Remove Item unavailable' })).toBeInTheDocument();
  });
});
