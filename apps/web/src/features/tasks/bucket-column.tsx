import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type {
  BoardDto,
  BucketDto,
  TaskChatSummaries,
  TaskChatSummary,
  TaskDto,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { boardQuery, deleteBucket, updateBucket } from './api';
import { byPosition } from './board-model';
import { BucketMenu } from './bucket-menu';
import type { DragData } from './dnd-announcements';
import { columnDropId } from './drop';
import { GripIcon } from './icons';
import { TaskCard } from './task-card';

/** The 8 px square that says what step a fixed bucket is; custom buckets have none. */
const KIND_MARK: Record<BucketDto['kind'], string | null> = {
  todo: 'border-[1.5px] border-foreground',
  egrant_review: 'bg-brand-purple',
  client_review: 'bg-brand-blue',
  done: 'bg-success',
  custom: null,
};

/** Sortable id of a bucket column (dragged by its grip handle, admins only). */
export const bucketSortId = (bucketId: string) => `header:${bucketId}`;

/** Where a card from another bucket would land: before this card, or after the last one. */
export type DropMark = string | 'end' | null;

/** dnd-kit's drag offset as CSS; only translation, the board never scales items. */
function dragStyle(
  transform: { x: number; y: number } | null,
  transition: string | undefined,
): CSSProperties {
  // Under prefers-reduced-motion the global rule in theme.css cuts this transition to ~0 ms.
  return {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
}

/** A 2 px ink line just above or below a card: where the dragged card will land. */
const MARK_BEFORE =
  "before:absolute before:inset-x-0 before:-top-[5px] before:h-0.5 before:rounded-full before:bg-foreground before:content-['']";
const MARK_AFTER =
  "after:absolute after:inset-x-0 after:-bottom-[5px] after:h-0.5 after:rounded-full after:bg-foreground after:content-['']";

/** One card in the column's sortable list; the card's link is the drag handle. */
function SortableTask({
  task,
  bucketKind,
  today,
  disabled,
  mark,
  chat,
  onToggleDone,
}: {
  task: TaskDto;
  bucketKind: BucketDto['kind'];
  today: string;
  disabled: boolean;
  mark: 'before' | 'after' | null;
  chat?: TaskChatSummary;
  onToggleDone: (task: TaskDto) => void;
}) {
  const data: DragData = { type: 'task', title: task.title, bucketId: task.bucketId };
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data, disabled: { draggable: false, droppable: disabled } });
  return (
    <li
      ref={setNodeRef}
      data-task-id={task.id}
      style={dragStyle(transform, transition)}
      className={cn(
        'relative',
        // The slot the card left stays in the list, faded: the placeholder.
        isDragging && 'opacity-40',
        mark === 'before' && MARK_BEFORE,
        mark === 'after' && MARK_AFTER,
      )}
    >
      <TaskCard
        task={task}
        bucketKind={bucketKind}
        today={today}
        chat={chat}
        ref={setActivatorNodeRef}
        onToggleDone={() => onToggleDone(task)}
        // Not dnd-kit's role="button": the card stays a link (Enter opens it, Space lifts it).
        handleProps={{
          ...listeners,
          'aria-describedby': attributes['aria-describedby'],
          // A long press drags on touch; Android would open the link menu instead.
          onContextMenu: (event) => {
            if ((event.nativeEvent as PointerEvent).pointerType === 'touch') event.preventDefault();
          },
        }}
      />
    </li>
  );
}

/**
 * One column: header, scrolling card list, "+ Add task". The list is a droppable (a drop on it
 * puts the card last) holding one sortable per card; the column itself is sortable among the
 * buckets: admins lift any of them, fixed ones included, by its grip.
 */
export function BucketColumn({
  bucket,
  title,
  tasks,
  today,
  admin,
  emptyText,
  dragging,
  dropMark,
  chats,
  onToggleDone,
}: {
  bucket: BucketDto;
  title: string;
  tasks: TaskDto[];
  today: string;
  admin: boolean;
  emptyText: string;
  /** What is being dragged on the board: only matching drop targets are enabled. */
  dragging: 'task' | 'bucket' | null;
  dropMark: DropMark;
  /** The group's task chat summaries, by task id. */
  chats?: TaskChatSummaries;
  /** The done circle of one of the column's cards was pressed. */
  onToggleDone: (task: TaskDto) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view');
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mark = KIND_MARK[bucket.kind];
  const key = boardQuery(bucket.groupId).queryKey;
  const movable = admin;
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: bucketSortId(bucket.id),
    data: { type: 'bucket', title, bucketId: bucket.id } satisfies DragData,
    disabled: { draggable: !movable, droppable: dragging !== 'bucket' },
  });
  const { setNodeRef: setListRef } = useDroppable({
    id: columnDropId(bucket.id),
    data: { type: 'column', bucketId: bucket.id } satisfies DragData,
    disabled: dragging === 'bucket',
  });

  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setFailed(false);
    try {
      await action();
      setMode('view');
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }

  const rename = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === bucket.name) return;
      const updated = await updateBucket(bucket.id, { name: trimmed });
      queryClient.setQueryData<BoardDto>(
        key,
        (board) =>
          board && {
            ...board,
            buckets: board.buckets.map((b) => (b.id === updated.id ? updated : b)).sort(byPosition),
          },
      );
    });

  const remove = () =>
    run(async () => {
      await deleteBucket(bucket.id);
      // Its tasks moved to To do on the server without task events: reload the board.
      await queryClient.invalidateQueries({ queryKey: key, exact: true });
    });

  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void rename();
    } else if (event.key === 'Escape') {
      setMode('view');
    }
  }

  return (
    <section
      ref={setNodeRef}
      style={dragStyle(transform, transition)}
      aria-label={title}
      data-bucket-id={bucket.id}
      className={cn(
        'flex max-h-[calc(100dvh-14rem)] min-h-40 w-[calc(100vw-56px)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted p-3 min-[641px]:w-72',
        isDragging && 'relative z-10 shadow-lift',
      )}
    >
      <header className="flex min-h-8 items-center gap-2">
        {mode === 'rename' ? (
          <Input
            autoFocus
            value={name}
            maxLength={60}
            aria-label={t('tasks.board.bucketName')}
            aria-invalid={failed || undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onRenameKey}
            onBlur={() => !busy.current && setMode('view')}
            className="px-3 py-1"
          />
        ) : (
          <>
            {movable && (
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...listeners}
                aria-describedby={attributes['aria-describedby']}
                aria-label={t('tasks.dnd.moveBucket', { title })}
                className={cn(
                  '-ml-1 flex size-8 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground hover:bg-accent max-[640px]:size-11',
                  isDragging && 'cursor-grabbing',
                )}
              >
                <GripIcon />
              </button>
            )}
            {mark && (
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[2px]', mark)} />
            )}
            <h2 className="min-w-0 flex-1 truncate text-button font-semibold">{title}</h2>
            <span className="text-micro text-muted-foreground">
              <span aria-hidden="true">{tasks.length}</span>
              <span className="sr-only">{t('tasks.board.count', { count: tasks.length })}</span>
            </span>
            {admin && bucket.kind === 'custom' && (
              <BucketMenu
                title={title}
                onRename={() => {
                  setName(bucket.name ?? '');
                  setFailed(false);
                  setMode('rename');
                }}
                onDelete={() => {
                  setFailed(false);
                  setMode('confirm');
                }}
              />
            )}
          </>
        )}
      </header>

      {mode === 'confirm' && (
        <div
          role="alertdialog"
          aria-label={title}
          className="flex flex-col gap-2 rounded-lg bg-card p-3"
        >
          <p className="text-button">{t('tasks.board.deleteBucketConfirm')}</p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('tasks.board.delete')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMode('view')}>
              {t('tasks.board.cancel')}
            </Button>
          </div>
        </div>
      )}
      {failed && mode !== 'view' && (
        <p role="alert" className="text-micro text-error-ink">
          {t('tasks.board.error')}
        </p>
      )}

      <ul
        ref={setListRef}
        // py-1.5 leaves room for the drop line above the first and below the last card.
        className="-my-1.5 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-1.5"
      >
        <SortableContext
          id={bucket.id}
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task, index) => (
            <SortableTask
              key={task.id}
              task={task}
              bucketKind={bucket.kind}
              today={today}
              chat={chats?.[task.id]}
              disabled={dragging === 'bucket'}
              onToggleDone={onToggleDone}
              mark={
                dropMark === task.id
                  ? 'before'
                  : dropMark === 'end' && index === tasks.length - 1
                    ? 'after'
                    : null
              }
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <li
            className={cn(
              'relative px-1 py-2 text-button text-muted-foreground',
              dropMark === 'end' && MARK_BEFORE,
            )}
          >
            {emptyText}
          </li>
        )}
      </ul>

      <Link
        to="/groups/$groupId/tasks/new"
        params={{ groupId: bucket.groupId }}
        search={{ bucket: bucket.id }}
        className="rounded-lg px-3 py-2 text-left text-button font-semibold text-muted-foreground hover:bg-accent hover:text-foreground max-[640px]:min-h-11"
      >
        <span aria-hidden="true">+ </span>
        {t('tasks.board.addTask')}
      </Link>
    </section>
  );
}
