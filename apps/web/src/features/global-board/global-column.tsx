import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlobalColumn as Column, GlobalTaskDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { GroupLogo } from '@/features/groups/group-logo';
import { TaskCard } from '@/features/tasks/task-card';
import type { GlobalBoardSearch } from '@/router';

/** The 8 px square of the group board's columns; custom columns and "Other steps" have none. */
const KIND_MARK: Record<Column['kind'], string | null> = {
  todo: 'border-[1.5px] border-foreground',
  custom: null,
  other: null,
  egrant_review: 'bg-brand-purple',
  client_review: 'bg-brand-blue',
  done: 'bg-success',
};

/** The client line on top of a global card: its 16 px logo and name, and the custom step. */
function GroupLine({ task, showBucket }: { task: GlobalTaskDto; showBucket: boolean }) {
  return (
    <span className="flex w-full min-w-0 flex-col gap-0.5 text-micro text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <GroupLogo
          groupId={task.groupId}
          name={task.groupName}
          hasLogo={task.groupHasLogo}
          version={task.groupUpdatedAt}
          size={16}
          className="rounded-sm"
        />
        <span className="truncate">{task.groupName}</span>
      </span>
      {showBucket && task.bucketName && (
        <span className="truncate font-semibold text-foreground">{task.bucketName}</span>
      )}
    </span>
  );
}

/**
 * One column of the global board: the group board's column look (288 px on `muted`), its heading
 * (a custom column's merged bucket name, like a custom bucket on the group board) with the total, the cards (no drag: a card opens the task panel over this board) and
 * "Show 50 more".
 */
export function GlobalColumn({
  kind,
  name,
  total,
  items,
  hasMore,
  loadingMore,
  moreFailed,
  onMore,
  search,
  today,
}: {
  kind: Column['kind'];
  /** Custom columns only. */
  name: string | null;
  total: number;
  items: GlobalTaskDto[];
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  onMore: () => void;
  search: GlobalBoardSearch;
  today: string;
}) {
  const { t } = useTranslation();
  const mark = KIND_MARK[kind];
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-h-[calc(100dvh-16rem)] min-h-40 w-[calc(100vw-56px)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted p-3 min-[641px]:w-72"
    >
      <header className="flex min-h-8 items-center gap-2">
        {mark && <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${mark}`} />}
        <h2 id={headingId} className="min-w-0 truncate text-button font-semibold">
          {kind === 'custom' ? name : t(`adminHome.board.columns.${kind}`)}
        </h2>
        <span className="text-micro text-muted-foreground tabular-nums">
          <span aria-hidden="true">{total}</span>
          <span className="sr-only">{t('adminHome.board.count', { count: total })}</span>
        </span>
      </header>
      <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {items.map((task) => (
          <li key={task.id} data-task-id={task.id}>
            <TaskCard
              task={task}
              bucketKind={task.bucketKind}
              today={today}
              showDone={false}
              unseen={task.unseen}
              groupLine={<GroupLine task={task} showBucket={kind === 'other'} />}
              link={{ to: '/tasks', search: { ...search, task: task.id } }}
            />
          </li>
        ))}
      </ul>
      {moreFailed && (
        <p role="alert" className="text-micro text-error-ink">
          {t('adminHome.board.moreFailed')}
        </p>
      )}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={loadingMore}
          onClick={onMore}
        >
          {t('adminHome.board.more')}
        </Button>
      )}
    </section>
  );
}
