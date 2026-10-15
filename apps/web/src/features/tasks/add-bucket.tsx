import { useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BoardDto } from '@spolu/shared';
import { Input } from '@/components/ui/input';
import { boardQuery, createBucket } from './api';
import { byPosition } from './board-model';

/** "+ Add bucket" (admins): an inline name field; Enter creates, Esc cancels. */
export function AddBucket({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const close = () => {
    setOpen(false);
    setName('');
    setFailed(false);
  };

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy.current) return;
    busy.current = true;
    setFailed(false);
    try {
      const bucket = await createBucket(groupId, trimmed);
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (board) =>
          board && {
            ...board,
            buckets: board.buckets.some((b) => b.id === bucket.id)
              ? board.buckets
              : [...board.buckets, bucket].sort(byPosition),
          },
      );
      close();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      close();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 shrink-0 self-start whitespace-nowrap rounded-full bg-secondary px-4 text-tiny font-semibold text-secondary-foreground hover:bg-surface-3"
      >
        <span aria-hidden="true">+ </span>
        {t('tasks.board.addBucket')}
      </button>
    );
  }
  return (
    <div className="flex w-72 shrink-0 flex-col gap-1 self-start">
      <Input
        autoFocus
        value={name}
        maxLength={60}
        aria-label={t('tasks.board.bucketName')}
        aria-invalid={failed || undefined}
        placeholder={t('tasks.board.bucketName')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => !name.trim() && close()}
        className="px-3 py-2"
      />
      {failed && (
        <p role="alert" className="text-micro text-error-ink">
          {t('tasks.board.error')}
        </p>
      )}
    </div>
  );
}
