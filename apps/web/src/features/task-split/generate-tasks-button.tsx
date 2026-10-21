import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SparkleIcon } from '@/components/icons';
import { Toast } from '@/components/ui/toast';
import { withNamespaces } from '@/i18n/namespaces';
import { aiStatusQuery } from './api';

const GenerateTasksDialog = lazy(
  withNamespaces(['forms', 'tasks', 'taskSplit'], () => import('./generate-tasks-dialog')),
);

/**
 * "Generate tasks from text" at the top of a task board: shown only while the server has the AI
 * on. `groupId` is the board's client (preselected); with `pickGroup` (the global board) the
 * dialog asks for the client first. The caller decides who may see it (whoever creates tasks
 * there). The board loads this file lazily, with the `taskSplit` texts.
 */
export function GenerateTasksButton({
  groupId,
  pickGroup = false,
}: {
  groupId: string | null;
  pickGroup?: boolean;
}) {
  const { t } = useTranslation();
  const enabled = useQuery(aiStatusQuery).data?.taskSplit === true;
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ count: number; groupId: string } | null>(null);
  if (!enabled) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <SparkleIcon />
        {t('taskSplit.fromText.button')}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <GenerateTasksDialog
            groupId={groupId}
            pickGroup={pickGroup}
            onClose={() => setOpen(false)}
            onCreated={(target, tasks) => {
              setOpen(false);
              setCreated({ count: tasks.length, groupId: target });
            }}
          />
        </Suspense>
      )}
      {created && (
        <Toast onClose={() => setCreated(null)}>
          <span>{t('taskSplit.created', { count: created.count })}</span>
          {pickGroup && (
            <Link
              to="/groups/$groupId/tasks"
              params={{ groupId: created.groupId }}
              onClick={() => setCreated(null)}
              className="font-semibold underline underline-offset-4 hover:text-neutral"
            >
              {t('taskSplit.openBoard')}
            </Link>
          )}
        </Toast>
      )}
    </>
  );
}

export default GenerateTasksButton;
