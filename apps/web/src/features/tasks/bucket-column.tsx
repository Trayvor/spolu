import { useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AddTaskInline } from './add-task-inline';
import { boardQuery, deleteBucket, updateBucket } from './api';
import { byPosition } from './board-model';
import { BucketMenu } from './bucket-menu';
import { TaskCard } from './task-card';

/** The 8 px square that says what step a fixed bucket is; custom buckets have none. */
const KIND_MARK: Record<BucketDto['kind'], string | null> = {
  todo: 'border-[1.5px] border-foreground',
  egrant_review: 'bg-brand-purple',
  client_review: 'bg-brand-blue',
  done: 'bg-success',
  custom: null,
};

/**
 * One column: header, scrolling card list, "+ Add task". The list is a plain `<ul>` of
 * `<li>` cards so the drag layer can make it a droppable and each item sortable.
 */
export function BucketColumn({
  bucket,
  title,
  tasks,
  today,
  admin,
  emptyText,
}: {
  bucket: BucketDto;
  title: string;
  tasks: TaskDto[];
  today: string;
  admin: boolean;
  emptyText: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view');
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mark = KIND_MARK[bucket.kind];
  const key = boardQuery(bucket.groupId).queryKey;

  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setFailed(false);
    try {
      await action();
      setMode('view');
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }

  const rename = () =>
    run(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === bucket.name) return;
      const updated = await updateBucket(bucket.id, { name: trimmed });
      queryClient.setQueryData<BoardDto>(
        key,
        (board) =>
          board && {
            ...board,
            buckets: board.buckets.map((b) => (b.id === updated.id ? updated : b)).sort(byPosition),
          },
      );
    });

  const remove = () =>
    run(async () => {
      await deleteBucket(bucket.id);
      // Its tasks moved to To do on the server without task events: reload the board.
      await queryClient.invalidateQueries({ queryKey: key, exact: true });
    });

  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void rename();
    } else if (event.key === 'Escape') {
      setMode('view');
    }
  }

  return (
    <section
      aria-label={title}
      data-bucket-id={bucket.id}
      className="flex max-h-[calc(100dvh-14rem)] min-h-40 w-[calc(100vw-56px)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted p-3 min-[641px]:w-72"
    >
      <header className="flex min-h-8 items-center gap-2">
        {mode === 'rename' ? (
          <Input
            autoFocus
            value={name}
            maxLength={60}
            aria-label={t('tasks.board.bucketName')}
            aria-invalid={failed || undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onRenameKey}
            onBlur={() => !busy.current && setMode('view')}
            className="px-3 py-1"
          />
        ) : (
          <>
            {mark && (
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-[2px]', mark)} />
            )}
            <h2 className="min-w-0 flex-1 truncate text-button font-semibold">{title}</h2>
            <span
              className="text-micro text-muted-foreground"
              aria-label={t('tasks.board.count', { count: tasks.length })}
            >
              {tasks.length}
            </span>
            {admin && bucket.kind === 'custom' && (
              <BucketMenu
                title={title}
                onRename={() => {
                  setName(bucket.name ?? '');
                  setFailed(false);
                  setMode('rename');
                }}
                onDelete={() => {
                  setFailed(false);
                  setMode('confirm');
                }}
              />
            )}
          </>
        )}
      </header>

      {mode === 'confirm' && (
        <div
          role="alertdialog"
          aria-label={title}
          className="flex flex-col gap-2 rounded-lg bg-card p-3"
        >
          <p className="text-button">{t('tasks.board.deleteBucketConfirm')}</p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('tasks.board.delete')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMode('view')}>
              {t('tasks.board.cancel')}
            </Button>
          </div>
        </div>
      )}
      {failed && mode !== 'view' && (
        <p role="alert" className="text-micro text-error-ink">
          {t('tasks.board.error')}
        </p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskCard task={task} bucketKind={bucket.kind} today={today} />
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="px-1 py-2 text-button text-muted-foreground">{emptyText}</li>
        )}
      </ul>

      <AddTaskInline groupId={bucket.groupId} bucketId={bucket.id} />
    </section>
  );
}
