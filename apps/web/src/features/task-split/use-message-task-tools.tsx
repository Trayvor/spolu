import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MessageDto, TaskDetailDto } from '@spolu/shared';
import { Toast } from '@/components/ui/toast';
import type { MessageAction } from '@/features/chat/conversation';
import { renderMessageTasks } from '@/features/chat/message-tasks';
import { withNamespaces } from '@/i18n/namespaces';
import { aiStatusQuery } from './api';

// The review dialog (and the task form inside it) loads only when a message is chosen.
// Its form fields need the `forms` namespace, which the chat and task panel routes load already.
const ReviewDialog = lazy(withNamespaces(['forms'], () => import('./review-dialog')));

const NO_ACTIONS: MessageAction[] = [];

/** Sparkle: the AI action in the message menu. */
const TasksIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 4.5 10.6 9l4.4 1.5-4.4 1.6L9 16.5l-1.6-4.4L3 10.5 7.4 9z" />
    <path d="M17.5 3v4M15.5 5h4M18 15v5M15.5 17.5h5" />
  </svg>
);

/**
 * What a chat needs for "Turn into tasks": the message action (only while the server has the
 * AI on), the "Turned into tasks:" footer under each message (`renderMessageTasks`), and
 * `element` — the lazy review dialog for the chosen message and the "N tasks created" toast.
 * `ChatTab` and `TaskChat` render `element` next to their `<Conversation>`.
 */
export function useMessageTaskTools(groupId: string): {
  messageActions: MessageAction[];
  renderMessageFooter: (message: MessageDto) => ReactNode;
  element: ReactNode;
} {
  const { t } = useTranslation();
  const enabled = useQuery(aiStatusQuery).data?.taskSplit === true;
  const [message, setMessage] = useState<MessageDto | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  const messageActions = useMemo<MessageAction[]>(
    () =>
      enabled
        ? [
            {
              id: 'turn-into-tasks',
              label: t('chat.actions.turnIntoTasks'),
              icon: <TasksIcon />,
              inMenu: true,
              isAvailable: (m) => m.body.trim() !== '',
              onSelect: (m) => {
                setCreated(null);
                setMessage(m);
              },
            },
          ]
        : NO_ACTIONS,
    [enabled, t],
  );

  // "Turned into tasks:" under a message; one function per group, so rows never re-render for it.
  const renderMessageFooter = useMemo(() => renderMessageTasks(groupId), [groupId]);

  const close = useCallback(() => setMessage(null), []);
  const onCreated = useCallback((tasks: TaskDetailDto[]) => {
    setMessage(null);
    setCreated(tasks.length);
  }, []);

  const element = (
    <>
      {message && (
        <Suspense fallback={null}>
          <ReviewDialog
            key={message.id}
            groupId={groupId}
            message={message}
            onClose={close}
            onCreated={onCreated}
          />
        </Suspense>
      )}
      {created !== null && (
        <Toast onClose={() => setCreated(null)}>
          <span>{t('taskSplit.created', { count: created })}</span>
          <Link
            to="/groups/$groupId/tasks"
            params={{ groupId }}
            onClick={() => setCreated(null)}
            className="font-semibold underline underline-offset-4 hover:text-neutral"
          >
            {t('taskSplit.openBoard')}
          </Link>
        </Toast>
      )}
    </>
  );

  return { messageActions, renderMessageFooter, element };
}
