import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type PointerActivationConstraint,
  type PointerSensorOptions,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AddBucket } from './add-bucket';
import { boardQuery } from './api';
import { boardNoticeKey, showBoardNotice, type BoardNotice } from './board-cache';
import { byPosition, bucketTitle, tasksByBucket } from './board-model';
import { BucketColumn, bucketSortId, type DropMark } from './bucket-column';
import { todayInBratislava } from './dates';
import { dndAccessibility, dragData } from './dnd-announcements';
import {
  boardCollisions,
  columnDropId,
  computeBucketDrop,
  computeTaskDrop,
  handleBucketDrop,
  handleTaskDrop,
} from './drop';
import { TaskCard } from './task-card';
import { useBoardEvents } from './use-board-events';

export { bucketTitle } from './board-model';

/**
 * Mouse and pen only: touch has its own sensor (press and hold), so a swipe that scrolls the
 * board never starts a drag.
 */
class MousePointerSensor extends PointerSensor {
  static activators = PointerSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: ReactPointerEvent, options: PointerSensorOptions) =>
      event.nativeEvent.pointerType !== 'touch' && activator.handler(event, options),
  }));
}

const POINTER: PointerActivationConstraint = { distance: 5 };
const TOUCH: PointerActivationConstraint = { delay: 250, tolerance: 5 };
/** Space lifts and drops; Enter on a card still opens it (it is a link). */
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space'] };

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** To do stays first and Completed last while a custom bucket is dragged over them. */
const bucketStrategy: SortingStrategy = (args) =>
  horizontalListSortingStrategy(
    args.overIndex < 0
      ? args
      : { ...args, overIndex: Math.min(Math.max(args.overIndex, 1), args.rects.length - 2) },
  );

type Dragging =
  | { type: 'task'; id: string; bucketId: string; via: 'pointer' | 'keyboard' }
  | { type: 'bucket'; id: string };

/** The task board of a group: a horizontally scrolling row of bucket columns in position order. */
export function Board({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const admin = isAdmin(useSession());
  useBoardEvents(groupId);
  const { data: board, isError, refetch } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));
  // Set by a failed drop or by the task panel (see `showBoardNotice`); never fetched.
  const { data: notice } = useQuery<BoardNotice | null>({
    queryKey: boardNoticeKey(groupId),
    queryFn: () => null,
    enabled: false,
  });
  const grouped = useMemo(() => (board ? tasksByBucket(board) : null), [board]);
  const groupName = group?.name ?? '';
  const [dragging, setDragging] = useState<Dragging | null>(null);
  // While a card hovers over another bucket: the card (or 'end') it would land before.
  const [dropTarget, setDropTarget] = useState<{ bucketId: string; mark: DropMark } | null>(null);

  // A card dropped with the keyboard re-renders in its new column: once the board has it
  // there, give it the focus back.
  const refocusId = useRef<string | null>(null);
  useEffect(() => {
    const id = refocusId.current;
    const card = id && document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"] a`);
    if (!card) return;
    refocusId.current = null;
    if (document.activeElement !== card) card.focus();
  }, [board]);

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: POINTER }),
    useSensor(TouchSensor, { activationConstraint: TOUCH }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
      scrollBehavior: prefersReducedMotion() ? 'auto' : 'smooth',
    }),
  );
  const accessibility = useMemo(() => {
    const title = (bucketId: string) => {
      const bucket = board?.buckets.find((b) => b.id === bucketId);
      return bucket ? bucketTitle(t, bucket, groupName) : '';
    };
    return dndAccessibility(t, title);
  }, [t, board?.buckets, groupName]);

  if (!board || !grouped) {
    return isError ? (
      <div role="alert" className="flex items-center gap-3 py-6 text-body">
        <span className="text-error-ink">{t('tasks.board.loadFailed')}</span>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          {t('tasks.board.retry')}
        </Button>
      </div>
    ) : (
      <p role="status" className="py-6 text-body text-muted-foreground">
        {t('tasks.board.loading')}
      </p>
    );
  }
  const buckets = [...board.buckets].sort(byPosition);
  const columns = grouped;
  const today = todayInBratislava();
  const noTasks = board.tasks.length === 0;
  // "+ Add bucket" sits after the last custom bucket, or right after To do when there is none.
  const lastCustom = buckets.findLastIndex((b) => b.kind === 'custom');
  const addAfter = lastCustom >= 0 ? lastCustom : buckets.findIndex((b) => b.kind === 'todo');
  const liftedTask =
    dragging?.type === 'task' ? board.tasks.find((task) => task.id === dragging.id) : undefined;
  const liftedKind = buckets.find((b) => b.id === liftedTask?.bucketId)?.kind;

  function onDragStart({ active, activatorEvent }: DragStartEvent) {
    showBoardNotice(queryClient, groupId, null);
    const data = dragData(active);
    if (data?.type === 'task') {
      const via = activatorEvent instanceof KeyboardEvent ? 'keyboard' : 'pointer';
      setDragging({ type: 'task', id: String(active.id), bucketId: data.bucketId, via });
    } else if (data?.type === 'bucket') {
      setDragging({ type: 'bucket', id: data.bucketId });
    }
  }

  function onDragOver({ over }: DragOverEvent) {
    const target = dragData(over);
    if (dragging?.type !== 'task' || !over || !target || target.bucketId === dragging.bucketId) {
      setDropTarget(null);
      return;
    }
    const mark = over.id === columnDropId(target.bucketId) ? 'end' : String(over.id);
    setDropTarget({ bucketId: target.bucketId, mark });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    setDropTarget(null);
    const from = dragData(active);
    const to = dragData(over);
    if (!over || !from || !to) return;
    if (from.type === 'task') {
      const drop = computeTaskDrop(columns, String(active.id), String(over.id), to.bucketId);
      if (!drop) return;
      if (dragging?.type === 'task' && dragging.via === 'keyboard') refocusId.current = dragging.id;
      void handleTaskDrop(queryClient, groupId, String(active.id), drop);
    } else if (from.type === 'bucket') {
      const drop = computeBucketDrop(buckets, from.bucketId, to.bucketId);
      if (drop) void handleBucketDrop(queryClient, groupId, from.bucketId, drop.afterBucketId);
    }
  }

  function onDragCancel() {
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <>
      {notice && (
        <p role="alert" className="mb-3 text-body text-error-ink">
          {t(`tasks.board.${notice}`)}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisions}
        accessibility={accessibility}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3 min-[641px]:snap-none">
          <SortableContext
            id="buckets"
            items={buckets.map((bucket) => bucketSortId(bucket.id))}
            strategy={bucketStrategy}
          >
            {buckets.map((bucket, index) => (
              <div key={bucket.id} className="contents">
                <BucketColumn
                  bucket={bucket}
                  title={bucketTitle(t, bucket, groupName)}
                  tasks={grouped.get(bucket.id) ?? []}
                  today={today}
                  admin={admin}
                  emptyText={
                    noTasks && bucket.kind === 'todo'
                      ? t('tasks.board.emptyBoard')
                      : t('tasks.board.empty')
                  }
                  dragging={dragging?.type ?? null}
                  dropMark={dropTarget?.bucketId === bucket.id ? dropTarget.mark : null}
                />
                {admin && index === addAfter && (
                  // Kept in the layout but hidden while a bucket is dragged: columns slide over it.
                  <div className={cn('contents', dragging?.type === 'bucket' && '[&>*]:invisible')}>
                    <AddBucket groupId={groupId} />
                  </div>
                )}
              </div>
            ))}
          </SortableContext>
        </div>
        {/* The lifted card follows the pointer (or the arrow keys); no drop animation. */}
        <DragOverlay dropAnimation={null}>
          {liftedTask && dragging?.type === 'task' && (
            <div aria-hidden="true">
              <TaskCard
                task={liftedTask}
                bucketKind={liftedKind ?? 'todo'}
                today={today}
                lifted={dragging.via}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
