import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { GroupRoomProvider, useGroupRoom } from '@/features/groups/use-group-room';
import { taskQuery } from '@/features/tasks/api';
import { TaskPanel } from '@/features/tasks/task-panel';
import { ApiError } from '@/lib/api';
import { globalBoardKey } from './api';

type Exit = (opts: { replace: boolean }) => void;

/** The panel's own params: closing it drops them with `task`, the board's filters stay. */
const PANEL_KEYS = ['task', 'tab', 'thread', 'message', 'c'];

/** The task panel of the group board (Phase 8), joined to the task's group room. */
function JoinedPanel({
  groupId,
  taskId,
  onExit,
}: {
  groupId: string;
  taskId: string;
  onExit: Exit;
}) {
  const joins = useGroupRoom(groupId);
  return (
    <GroupRoomProvider joins={joins}>
      <TaskPanel groupId={groupId} taskId={taskId} onExit={onExit} />
    </GroupRoomProvider>
  );
}

/**
 * The task panel over the global board (`/tasks?…&task=<id>`): it reads the task first to know its
 * group, then opens the group board's panel with `onExit`, so closing returns to the same filtered
 * board. Moving the task is the panel's bucket select (no drag on this board). A task that is gone
 * closes the panel.
 */
export function GlobalTaskPanel({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(taskQuery(taskId));
  const onExit = useCallback<Exit>(
    ({ replace }) => {
      void navigate({
        to: '/tasks',
        replace,
        search: ((prev: Record<string, unknown>) => {
          const next = { ...prev };
          for (const key of PANEL_KEYS) delete next[key];
          return next;
        }) as never,
      });
      void queryClient.invalidateQueries({ queryKey: globalBoardKey });
    },
    [navigate, queryClient],
  );
  const gone = query.error instanceof ApiError && query.error.status === 404;
  useEffect(() => {
    if (gone) onExit({ replace: true });
  }, [gone, onExit]);

  const groupId = query.data?.groupId;
  if (!groupId) return null;
  return <JoinedPanel groupId={groupId} taskId={taskId} onExit={onExit} />;
}
