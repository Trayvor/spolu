import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FinanceEvents } from '@spolu/shared';
import { withNamespaces } from '@/i18n/namespaces';
import { getSocket } from '@/lib/socket';
import { finishTimeAsk, useTimeAsk, type TimeAsk } from './time-queue';

type DialogProps = { ask: TimeAsk; onDone: () => void };

/** The dialog's own lazy chunk with the `tasks` texts: loaded on the first ask only. */
const LazyTimeDialog = lazy((): Promise<{ default: ComponentType<DialogProps> }> =>
  withNamespaces(['tasks'], () => import('./time-dialog'))().then(
    (module) => ({ default: module.TimeDialog }),
    // A failed chunk (offline, new deploy): no dialog; the request stays on the dashboard.
    () => ({ default: () => null }),
  ),
);

/**
 * Time on done (Phase 32): one place for the time dialog on every admin screen (the board, the
 * global board's panel, a ticket, the dashboard). It shows the head of the queue (`time-queue.ts`)
 * and refetches the dashboard's My tasks and any open "My time" when the user's open requests change (`time:requests`,
 * from any device). Mounted by the signed-in layout for admins only.
 */
export function TimeDialogHost() {
  const ask = useTimeAsk();
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const onRequests = () => {
      for (const queryKey of [
        ['home', 'tasks'],
        ['tasks', 'time'],
        ['tickets', 'time'],
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    socket.on(FinanceEvents.timeRequests, onRequests);
    return () => {
      socket.off(FinanceEvents.timeRequests, onRequests);
    };
  }, [queryClient]);
  if (!ask) return null;
  return (
    <Suspense fallback={null}>
      <LazyTimeDialog key={`${ask.kind}:${ask.id}`} ask={ask} onDone={finishTimeAsk} />
    </Suspense>
  );
}
