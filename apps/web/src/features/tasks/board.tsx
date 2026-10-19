import { ColumnSkeletons } from '@/components/ui/skeleton';
import {
  useCallback,
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
} from '@dnd-kit/sortable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TaskDto } from '@spolu/shared';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { BoardFilterRow } from './board-filter-row';
import { isBoardFiltered, matchesBoardFilter, setActiveBoardFilter } from './board-filter';
import { BOARD_FILTER_KEYS, validateBoardSearch } from './board-search';
import { AddBucket } from './add-bucket';
import { boardQuery } from './api';
import { boardNoticeKey, showBoardNotice, type BoardNotice } from './board-cache';
import { byPosition, bucketTitle, tasksByBucket } from './board-model';
import { BucketColumn, bucketSortId, type DropMark } from './bucket-column';
import { taskChatsQuery } from './task-chats';
import { boardUnseenQuery } from './unseen';
import { todayInBratislava } from './dates';
import { dndAccessibility, dragData } from './dnd-announcements';
import {
  boardCollisions,
  columnDropId,
  computeBucketDrop,
  computeDoneToggle,
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

type Dragging =
  | { type: 'task'; id: string; bucketId: string; via: 'pointer' | 'keyboard' }
  | { type: 'bucket'; id: string };

/** The task board of a group: a horizontally scrolling row of bucket columns in position order. */
export function Board({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useSession();
  const admin = isAdmin(session);
  const viewerId = session?.id ?? null;
  // Phase 33 part P2: the Project and Event filter, and (2026-10-19) the Assignee one, in the URL
  // and remembered per group. It is set as the group's active filter before the board is read,
  // so `boardQuery` and every cache write address the filtered entry.
  const filter = validateBoardSearch(
    useRememberedFilters(
      `board.${groupId}`,
      BOARD_FILTER_KEYS,
      useSearch({ strict: false }) as Record<string, unknown>,
    ),
  );
  setActiveBoardFilter(groupId, filter, viewerId);
  const updateSearch = useUpdateSearch();
  useBoardEvents(groupId);
  const { data: rawBoard, isError, refetch } = useQuery(boardQuery(groupId));
  // A card edited out of the filter by this viewer leaves at once (live events do the same).
  const board = useMemo(
    () =>
      rawBoard && isBoardFiltered(filter)
        ? {
            ...rawBoard,
            tasks: rawBoard.tasks.filter((t) => matchesBoardFilter(t, filter, viewerId)),
          }
        : rawBoard,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter's three strings
    [rawBoard, filter.project, filter.event, filter.assignee, viewerId],
  );
  const { data: group } = useQuery(groupQuery(groupId));
  // One query for every card; the Tasks tab badge keeps it live. Without it cards just show no chat.
  const { data: chats } = useQuery(taskChatsQuery(groupId));
  // 2026-10-17: the cards with a change I have not seen; the Tasks tab badge keeps it live.
  const { data: unseen } = useQuery(boardUnseenQuery(groupId));
  // Set by a failed drop or by the task panel (see `showBoardNotice`); never fetched.
  const { data: notice } = useQuery<BoardNotice | null>({
    queryKey: boardNoticeKey(groupId),
    queryFn: () => null,
    enabled: false,
  });
  const grouped = useMemo(() => (board ? tasksByBucket(board) : null), [board]);
  const sortedBuckets = useMemo(() => (board ? [...board.buckets].sort(byPosition) : []), [board]);
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
  // Stable while the board is unchanged, so the memoized cards skip the redraws of a drag.
  const onToggleDone = useCallback(
    (task: TaskDto) => {
      if (!grouped) return;
      showBoardNotice(queryClient, groupId, null);
      const drop = computeDoneToggle(grouped, sortedBuckets, task);
      if (drop) void handleTaskDrop(queryClient, groupId, task.id, drop);
    },
    [queryClient, groupId, grouped, sortedBuckets],
  );
  const accessibility = useMemo(() => {
    const title = (bucketId: string) => {
      const bucket = board?.buckets.find((b) => b.id === bucketId);
      return bucket ? bucketTitle(t, bucket, groupName) : '';
    };
    return dndAccessibility(t, title);
  }, [t, board?.buckets, groupName]);

  const filterRow = (
    <BoardFilterRow
      groupId={groupId}
      value={filter}
      onChange={(next) =>
        updateSearch(
          (s) => {
            for (const key of BOARD_FILTER_KEYS) {
              if (next[key] === undefined) delete s[key];
              else s[key] = next[key];
            }
          },
          { replace: true },
        )
      }
    />
  );

  if (!board || !grouped) {
    return (
      <>
        {filterRow}
        {isError ? (
          <div role="alert" className="flex items-center gap-3 py-6 text-body">
            <span className="text-error-ink">{t('tasks.board.loadFailed')}</span>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t('tasks.board.retry')}
            </Button>
          </div>
        ) : (
          <div role="status">
            <span className="sr-only">{t('tasks.board.loading')}</span>
            <ColumnSkeletons />
          </div>
        )}
      </>
    );
  }
  const buckets = sortedBuckets;
  const columns = grouped;
  const today = todayInBratislava();
  const noTasks = board.tasks.length === 0;
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
      {filterRow}
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
        {/* `relative`: the cards' absolutely positioned `sr-only` texts must stay inside this
            scroller; otherwise they widen the page and a phone zooms out to fit them. */}
        <div className="relative flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3 min-[641px]:snap-none">
          <SortableContext
            id="buckets"
            items={buckets.map((bucket) => bucketSortId(bucket.id))}
            strategy={horizontalListSortingStrategy}
          >
            {buckets.map((bucket) => (
              <BucketColumn
                key={bucket.id}
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
                chats={chats}
                unseen={unseen}
                onToggleDone={onToggleDone}
                done={bucket.kind === 'done' ? board.done : undefined}
              />
            ))}
          </SortableContext>
          {admin && <AddBucket groupId={groupId} />}
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
                chat={chats?.[liftedTask.id]}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
