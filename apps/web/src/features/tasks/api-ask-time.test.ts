import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { moveTask } from './api';
import { clearTimeAsks, useTimeAsk } from './time-queue';

const card = {
  id: 't1',
  groupId: 'g1',
  bucketId: 'b-done',
  position: 'a0',
  title: 'Budget',
  createdBy: { id: 'u1', name: 'Eva' },
  assignees: [],
  dueDate: null,
  urgent: false,
  link: null,
  completedAt: '2026-10-17T10:00:00.000Z',
  createdAt: '2026-10-17T09:00:00.000Z',
  updatedAt: '2026-10-17T09:00:00.000Z',
  sourceMessageId: null,
  project: null,
  event: null,
  fileCount: 0,
  upcomingReminders: 0,
  knowledgeCount: 0,
};

function answer(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe('askTime in the board answers (Phase 32)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTimeAsks();
  });

  it('a move answering askTime queues the time dialog; the card has no askTime', async () => {
    answer({ ...card, askTime: true });
    const queue = renderHook(() => useTimeAsk());
    const moved = await moveTask('t1', { bucketId: 'b-done', afterTaskId: null });
    expect(moved).not.toHaveProperty('askTime');
    queue.rerender();
    expect(queue.result.current).toEqual({
      kind: 'task',
      id: 't1',
      groupId: 'g1',
      title: 'Budget',
    });
  });

  it('askTime false asks nothing', async () => {
    answer({ ...card, askTime: false });
    const queue = renderHook(() => useTimeAsk());
    await moveTask('t1', { bucketId: 'b-done', afterTaskId: null });
    expect(queue.result.current).toBeUndefined();
  });
});
