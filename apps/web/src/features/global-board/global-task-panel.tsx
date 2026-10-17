import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { GroupRoomProvider, useGroupRoom } from '@/features/groups/use-group-room';
import { taskQuery } from '@/features/tasks/api';
import { TaskPanel } from '@/features/tasks/task-panel';
import { ApiError } from '@/lib/api';
import { backOr, samePath } from '@/lib/back';
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
  const router = useRouter();
  // Closing goes back to the board it was opened on (Back does not reopen it); a gone task, or
  // one opened from outside, replaces itself with the board.
  const onExit = useCallback<Exit>(
    ({ replace }) => {
      const toBoard = () =>
        void navigate({
          to: '/tasks',
          replace: true,
          search: ((prev: Record<string, unknown>) => {
            const next = { ...prev };
            for (const key of PANEL_KEYS) delete next[key];
            return next;
          }) as never,
        });
      if (replace) toBoard();
      else backOr(router, toBoard, samePath(router, ['task']));
      void queryClient.invalidateQueries({ queryKey: globalBoardKey });
    },
    [navigate, queryClient, router],
  );
  // Only before the panel is open: once it is, `TaskPanel` itself closes on a gone task.
  const gone = query.error instanceof ApiError && query.error.status === 404 && !query.data;
  useEffect(() => {
    if (gone) onExit({ replace: true });
  }, [gone, onExit]);

  const groupId = query.data?.groupId;
  if (!groupId) return null;
  return <JoinedPanel groupId={groupId} taskId={taskId} onExit={onExit} />;
}
