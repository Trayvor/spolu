import { useEffect, useRef } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import {
  BoardEvents,
  RemindersEvents,
  type BoardBucketsEvent,
  type BoardDto,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type TaskDetailDto,
  type TaskRemindersEvent,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import { firstJoinCheck } from '@/lib/socket-history';
import { boardQuery, taskQuery } from './api';
import { removeTask, replaceBuckets, setUpcomingReminders, upsertTask } from './board-cache';
import { activeBoardFilter, activeBoardViewer, matchesBoardFilter } from './board-filter';

/** Prefix of every cached task detail (see `taskQuery`). */
const TASK_DETAILS_KEY = ['tasks', 'task'] as const;

/**
 * Applies the board events of the open group to the cached board. Room membership comes from
 * the group layout's `useGroupRoom`; after every later (re)join the board is refetched, since
 * events sent while the socket was out of the room are lost. The first join after the mount
 * refetches only what `firstJoinCheck` says may have missed events (a board cached before the
 * mount, anything after the socket was down), not the board the mount is loading anyway.
 */
export function useBoardEvents(groupId: string): void {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const seenJoins = useRef(joins);
  // Set while the room is not joined yet; `null` once its first join has been handled.
  const firstJoin = useRef<ReturnType<typeof firstJoinCheck> | null>(null);

  useEffect(() => {
    const socket = getSocket();
    // Read at each event: the board's Project / Event filter (Phase 33) picks the cache entry.
    const boardKey = () => boardQuery(groupId).queryKey;
    // Events that arrive before the board is cached are dropped; the initial fetch or the
    // rejoin refetch covers them.
    const update = (apply: (board: BoardDto) => BoardDto) =>
      queryClient.setQueryData<BoardDto>(boardKey(), (board) => board && apply(board));

    const onTask = ({ task }: BoardTaskEvent) => {
      if (task.groupId !== groupId) return;
      let unknownBucket = false;
      const filter = activeBoardFilter(groupId);
      update((board) => {
        // A task edited out of the filtered project, event or assignee leaves the filtered board.
        if (!matchesBoardFilter(task, filter, activeBoardViewer(groupId)))
          return removeTask(board, task.id);
        unknownBucket = !board.buckets.some((b) => b.id === task.bucketId);
        return upsertTask(board, task);
      });
      // A card in a bucket we do not know would not render: reload the board.
      if (unknownBucket) {
        void queryClient.invalidateQueries({ queryKey: boardKey(), exact: true });
      }
      // A cached task detail (open panel or one closed a moment ago) is now out of date.
      const detailKey = taskQuery(task.id).queryKey;
      const detail = queryClient.getQueryData<TaskDetailDto>(detailKey);
      if (detail && detail.updatedAt !== task.updatedAt)
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
    };
    const onTaskDeleted = (event: BoardTaskDeletedEvent) => {
      if (event.groupId === groupId) update((board) => removeTask(board, event.taskId));
    };
    const onBuckets = (event: BoardBucketsEvent) => {
      if (event.groupId !== groupId) return;
      let removedBucket = false;
      update((board) => {
        const result = replaceBuckets(board, event.buckets);
        removedBucket = result.removedBucket;
        return result.board;
      });
      // A deleted bucket's tasks moved to To do on the server without task events.
      if (removedBucket) {
        void queryClient.invalidateQueries({ queryKey: boardKey(), exact: true });
      }
    };

    // A task's upcoming custom reminders changed (a save, or the fire job): the card's bell.
    const onReminders = (event: TaskRemindersEvent) => {
      if (event.groupId !== groupId) return;
      update((board) => setUpcomingReminders(board, event.taskId, event.upcomingReminders));
    };

    socket.on(BoardEvents.task, onTask);
    socket.on(BoardEvents.taskDeleted, onTaskDeleted);
    socket.on(BoardEvents.buckets, onBuckets);
    socket.on(RemindersEvents.task, onReminders);
    return () => {
      socket.off(BoardEvents.task, onTask);
      socket.off(BoardEvents.taskDeleted, onTaskDeleted);
      socket.off(BoardEvents.buckets, onBuckets);
      socket.off(RemindersEvents.task, onReminders);
    };
  }, [groupId, queryClient]);

  useEffect(() => {
    if (joins === 0) {
      // Not in the room yet (the mount, or a group switch): its first join may skip a refetch.
      seenJoins.current = 0;
      firstJoin.current = firstJoinCheck(getSocket());
      return;
    }
    if (seenJoins.current === joins) return;
    seenJoins.current = joins;
    const stale = firstJoin.current;
    firstJoin.current = null;
    const predicate = stale ? (query: Query) => stale(query.state) : undefined;
    const key = boardQuery(groupId).queryKey;
    void queryClient.invalidateQueries({ queryKey: key, exact: true, predicate });
    // Task details cached meanwhile may have missed events too (an open panel refetches).
    void queryClient.invalidateQueries({ queryKey: TASK_DETAILS_KEY, predicate });
  }, [joins, groupId, queryClient]);
}
