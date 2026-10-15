import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BoardEvents,
  type BoardBucketsEvent,
  type BoardDto,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type TaskDetailDto,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import { boardQuery, taskQuery } from './api';
import { removeTask, replaceBuckets, upsertTask } from './board-cache';

/** Prefix of every cached task detail (see `taskQuery`). */
const TASK_DETAILS_KEY = ['tasks', 'task'] as const;

/**
 * Applies the board events of the open group to the cached board. Room membership comes from
 * the group layout's `useGroupRoom`; after every later (re)join the board is refetched, since
 * events sent while the socket was out of the room are lost.
 */
export function useBoardEvents(groupId: string): void {
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const seenJoins = useRef(joins);

  useEffect(() => {
    const socket = getSocket();
    const key = boardQuery(groupId).queryKey;
    // Events that arrive before the board is cached are dropped; the initial fetch or the
    // rejoin refetch covers them.
    const update = (apply: (board: BoardDto) => BoardDto) =>
      queryClient.setQueryData<BoardDto>(key, (board) => board && apply(board));

    const onTask = ({ task }: BoardTaskEvent) => {
      if (task.groupId !== groupId) return;
      let unknownBucket = false;
      update((board) => {
        unknownBucket = !board.buckets.some((b) => b.id === task.bucketId);
        return upsertTask(board, task);
      });
      // A card in a bucket we do not know would not render: reload the board.
      if (unknownBucket) void queryClient.invalidateQueries({ queryKey: key, exact: true });
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
      if (removedBucket) void queryClient.invalidateQueries({ queryKey: key, exact: true });
    };

    socket.on(BoardEvents.task, onTask);
    socket.on(BoardEvents.taskDeleted, onTaskDeleted);
    socket.on(BoardEvents.buckets, onBuckets);
    return () => {
      socket.off(BoardEvents.task, onTask);
      socket.off(BoardEvents.taskDeleted, onTaskDeleted);
      socket.off(BoardEvents.buckets, onBuckets);
    };
  }, [groupId, queryClient]);

  useEffect(() => {
    if (seenJoins.current === joins) return;
    seenJoins.current = joins;
    void queryClient.invalidateQueries({ queryKey: boardQuery(groupId).queryKey, exact: true });
    // Task details cached meanwhile may have missed events too (an open panel refetches).
    void queryClient.invalidateQueries({ queryKey: TASK_DETAILS_KEY });
  }, [joins, groupId, queryClient]);
}
