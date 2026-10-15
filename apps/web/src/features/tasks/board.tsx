import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { AddBucket } from './add-bucket';
import { boardQuery } from './api';
import { byPosition, bucketTitle, tasksByBucket } from './board-model';
import { BucketColumn } from './bucket-column';
import { todayInBratislava } from './dates';
import { useBoardEvents } from './use-board-events';

export { bucketTitle } from './board-model';

/** The task board of a group: a horizontally scrolling row of bucket columns in position order. */
export function Board({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  useBoardEvents(groupId);
  const { data: board, isError, refetch } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));
  const grouped = useMemo(() => (board ? tasksByBucket(board) : null), [board]);

  if (!board || !grouped) {
    return isError ? (
      <div role="alert" className="flex items-center gap-3 py-6 text-body">
        <span className="text-error-ink">{t('tasks.board.loadFailed')}</span>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          {t('tasks.board.retry')}
        </Button>
      </div>
    ) : (
      <p role="status" className="py-6 text-body text-muted-foreground">
        {t('tasks.board.loading')}
      </p>
    );
  }
  const buckets = [...board.buckets].sort(byPosition);
  const groupName = group?.name ?? '';
  const today = todayInBratislava();
  const noTasks = board.tasks.length === 0;
  // "+ Add bucket" sits after the last custom bucket, or right after To do when there is none.
  const lastCustom = buckets.findLastIndex((b) => b.kind === 'custom');
  const addAfter = lastCustom >= 0 ? lastCustom : buckets.findIndex((b) => b.kind === 'todo');

  return (
    <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3 min-[641px]:snap-none">
      {buckets.map((bucket, index) => (
        <div key={bucket.id} className="contents">
          <BucketColumn
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
          />
          {admin && index === addAfter && <AddBucket groupId={groupId} />}
        </div>
      ))}
    </div>
  );
}
