import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_WORK } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TaskSummary } from '../work-cards';
import { taskSearchQuery } from './api';
import { PickRow } from './pick-row';
import { toggled, useSearchText, type PickedTask } from './picked';

/** The Tasks tab: this group's tasks, open first, searched by title; the server pages by 20. */
export function TasksTab({
  groupId,
  chosen,
  setChosen,
}: {
  groupId: string;
  chosen: PickedTask[];
  setChosen: (update: (list: PickedTask[]) => PickedTask[]) => void;
}) {
  const { t } = useTranslation();
  const { text, setText, q } = useSearchText();
  // The tasks' search starts at two characters.
  const query = useInfiniteQuery(taskSearchQuery(groupId, q.length >= 2 ? q : ''));
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= MESSAGE_MAX_WORK;
  return (
    <>
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('chat.work.searchTasks')}
        aria-label={t('chat.work.searchTasks')}
      />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-busy={query.isPending}>
        {items.map((task) => {
          const on = chosen.some((c) => c.id === task.id);
          return (
            <PickRow
              key={task.id}
              checked={on}
              disabled={!on && full}
              onChange={() => setChosen((list) => toggled(list, task, MESSAGE_MAX_WORK))}
            >
              <TaskSummary task={task} />
            </PickRow>
          );
        })}
        {query.isSuccess && items.length === 0 && (
          <li className="px-2 py-4 text-body text-muted-foreground">
            {q ? t('chat.work.noResults') : t('chat.work.noTasks')}
          </li>
        )}
        {query.isError && (
          <li role="alert" className="px-2 py-4 text-body text-error-ink">
            {t('errors.generic')}
          </li>
        )}
        {query.hasNextPage && (
          <li className="px-2 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('chat.knowledge.loadMore')}
            </Button>
          </li>
        )}
      </ul>
      {full && (
        <p className="text-micro text-muted-foreground">
          {t('chat.work.limitTasks', { count: MESSAGE_MAX_WORK })}
        </p>
      )}
    </>
  );
}
