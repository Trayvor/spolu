import type { Active, Announcements, Over, ScreenReaderInstructions } from '@dnd-kit/core';
import type { TFunction } from 'i18next';

/**
 * The `data` every draggable and droppable on the board carries: a task card, a column (the
 * drop target at the end of a bucket) or a bucket (dragged by its grip handle; admins only).
 */
export type DragData =
  | { type: 'task'; title: string; bucketId: string }
  | { type: 'column'; bucketId: string }
  | { type: 'bucket'; title: string; bucketId: string };

export const dragData = (item: Active | Over | null): DragData | undefined =>
  item?.data.current as DragData | undefined;

const KEYS = {
  task: {
    pickedUp: 'tasks.dnd.pickedUp',
    over: 'tasks.dnd.over',
    dropped: 'tasks.dnd.dropped',
    cancelled: 'tasks.dnd.cancelled',
  },
  bucket: {
    pickedUp: 'tasks.dnd.bucketPickedUp',
    over: 'tasks.dnd.bucketOver',
    dropped: 'tasks.dnd.bucketDropped',
    cancelled: 'tasks.dnd.bucketCancelled',
  },
} as const;

/**
 * Translated screen reader texts for dragging tasks and buckets. `bucketTitle` names a bucket
 * by id (the fixed buckets have translated names).
 */
export function dndAccessibility(
  t: TFunction,
  bucketTitle: (bucketId: string) => string,
): { announcements: Announcements; screenReaderInstructions: ScreenReaderInstructions } {
  const say = (event: keyof (typeof KEYS)['task'], active: Active, over: Over | null = null) => {
    const data = dragData(active);
    const keys = data?.type === 'bucket' ? KEYS.bucket : KEYS.task;
    return t(keys[event], {
      title: data && 'title' in data ? data.title : '',
      bucket: bucketTitle(dragData(over)?.bucketId ?? ''),
    });
  };

  return {
    screenReaderInstructions: { draggable: t('tasks.dnd.instructions') },
    announcements: {
      onDragStart: ({ active }) => say('pickedUp', active),
      onDragOver: ({ active, over }) => (over ? say('over', active, over) : undefined),
      onDragEnd: ({ active, over }) =>
        over ? say('dropped', active, over) : say('cancelled', active),
      onDragCancel: ({ active }) => say('cancelled', active),
    },
  };
}
