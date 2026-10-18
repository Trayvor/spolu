import { useCallback } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { TaskPanel } from '@/features/tasks/task-panel';
import { backOr, samePath } from '@/lib/back';

type Exit = (opts: { replace: boolean }) => void;

/** The panel's own params: closing it drops them with `task`; `project` stays. */
const PANEL_KEYS = ['task', 'tab', 'thread', 'message', 'c'];

/**
 * The task panel over the Prehľad tab (`/groups/<id>/overview?task=<id>`, spec §7.2), as over
 * the global board: closing goes back to the overview it was opened on, a gone task replaces
 * itself with the overview. The group layout keeps the socket in the group's room. A lazy chunk
 * of its own, loaded with the `tasks` texts only when a task is opened.
 */
export function OverviewTaskPanel({ groupId, taskId }: { groupId: string; taskId: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const onExit = useCallback<Exit>(
    ({ replace }) => {
      const toOverview = () =>
        void navigate({
          to: '/groups/$groupId/overview',
          params: { groupId },
          replace: true,
          search: ((prev: Record<string, unknown>) => {
            const next = { ...prev };
            for (const key of PANEL_KEYS) delete next[key];
            return next;
          }) as never,
        });
      if (replace) toOverview();
      else backOr(router, toOverview, samePath(router, ['task']));
    },
    [groupId, navigate, router],
  );
  return <TaskPanel groupId={groupId} taskId={taskId} onExit={onExit} />;
}
