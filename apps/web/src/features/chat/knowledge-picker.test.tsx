import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MESSAGE_MAX_KNOWLEDGE } from '@spolu/shared';
import { i18n } from '@/i18n';
import KnowledgePicker, { type PickedKnowledge } from './knowledge-picker';

const items = Array.from({ length: 12 }, (_, i) => ({
  id: `k${i}`,
  type: 'note',
  title: `Item ${i}`,
  folderPath: [],
  groupId: 'g1',
  visibility: 'public',
  excerpt: '',
  url: null,
  file: null,
  fileCount: 0,
  nextReminderAt: null,
  upcomingCount: 0,
  lastReminderAt: null,
  createdBy: { id: 'u1', name: 'Ada' },
  createdAt: '2026-10-17T10:00:00.000Z',
  updatedAt: '2026-10-17T10:00:00.000Z',
  folderId: null,
}));

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items, nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

function renderPicker(props: { picked?: PickedKnowledge[]; max?: number }) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <KnowledgePicker
        groupId="g1"
        picked={props.picked ?? []}
        max={props.max}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KnowledgePicker limit', () => {
  it('defaults to the chat message cap', async () => {
    stubApi();
    renderPicker({});
    const boxes = await screen.findAllByRole('checkbox');
    for (const box of boxes.slice(0, MESSAGE_MAX_KNOWLEDGE)) await userEvent.click(box);
    expect(boxes[MESSAGE_MAX_KNOWLEDGE]).toBeDisabled();
  });

  it('takes a larger cap and counts the already picked items', async () => {
    stubApi();
    const already: PickedKnowledge[] = Array.from({ length: 7 }, (_, i) => ({
      id: `k${i}`,
      available: true,
      type: 'note',
      title: `Item ${i}`,
      folderPath: [],
    }));
    renderPicker({ picked: already, max: 10 });
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes[7]).toBeEnabled();
    await userEvent.click(boxes[7]!);
    await userEvent.click(boxes[8]!);
    await userEvent.click(boxes[9]!);
    expect(boxes[10]).toBeDisabled();
    expect(screen.getByText(i18n.t('chat.knowledge.limit', { count: 10 }))).toBeInTheDocument();
  });
});
