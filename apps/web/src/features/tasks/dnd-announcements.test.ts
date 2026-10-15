import { describe, expect, it } from 'vitest';
import type { Active, Over } from '@dnd-kit/core';
import { i18n, setLanguage } from '@/i18n';
import { dndAccessibility, type DragData } from './dnd-announcements';

const item = (id: string, data: DragData) =>
  ({ id, data: { current: data } }) as unknown as Active & Over;
const card = item('t1', { type: 'task', title: 'Budget', bucketId: 'b1' });
const column = item('bucket:b2', { type: 'column', bucketId: 'b2' });
const names: Record<string, string> = { b1: 'To do', b2: 'eGrant review' };

function texts() {
  const { announcements, screenReaderInstructions } = dndAccessibility(
    i18n.t,
    (id) => names[id] ?? '',
  );
  return {
    instructions: screenReaderInstructions.draggable,
    start: announcements.onDragStart({ active: card }),
    over: announcements.onDragOver({ active: card, over: column }),
    end: announcements.onDragEnd({ active: card, over: column }),
    cancel: announcements.onDragCancel({ active: card, over: null }),
  };
}

describe('drag announcements', () => {
  it('English', () => {
    setLanguage('en');
    expect(texts()).toEqual({
      instructions:
        'To pick up a task, press Space. Use the arrow keys to move it and press Space again to drop it. Press Escape to cancel.',
      start: 'Picked up Budget.',
      over: 'Budget is over eGrant review.',
      end: 'Budget was dropped in eGrant review.',
      cancel: 'Moving Budget was cancelled.',
    });
  });

  it('Slovak', () => {
    setLanguage('sk');
    expect(texts()).toMatchObject({
      start: 'Úloha Budget je zdvihnutá.',
      over: 'Úloha Budget je nad stĺpcom eGrant review.',
      end: 'Úloha Budget je položená v stĺpci eGrant review.',
      cancel: 'Presun úlohy Budget je zrušený.',
    });
    setLanguage('en');
  });

  it('a bucket has its own texts', () => {
    setLanguage('en');
    const bucket = item('header:b3', { type: 'bucket', title: 'Mine', bucketId: 'b3' });
    const target = item('header:b2', { type: 'bucket', title: 'eGrant review', bucketId: 'b2' });
    const { announcements } = dndAccessibility(i18n.t, (id) => names[id] ?? '');
    expect(announcements.onDragStart({ active: bucket })).toBe('Picked up the bucket Mine.');
    expect(announcements.onDragEnd({ active: bucket, over: target })).toBe(
      'The bucket Mine was dropped next to eGrant review.',
    );
  });
});
