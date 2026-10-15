import { useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TaskDtoSchema, type BoardDto } from '@spolu/shared';
import { Input } from '@/components/ui/input';
import { createTask, boardQuery } from './api';
import { upsertTask } from './board-cache';

/** "+ Add task" at the foot of a column: an inline title field; Enter creates, Esc cancels. */
export function AddTaskInline({ groupId, bucketId }: { groupId: string; bucketId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const close = () => {
    setOpen(false);
    setTitle('');
    setFailed(false);
  };

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || busy.current) return;
    busy.current = true;
    setFailed(false);
    try {
      const detail = await createTask(groupId, {
        title: trimmed,
        description: '',
        assigneeIds: [],
        dueDate: null,
        urgent: false,
        fileIds: [],
        bucketId,
      });
      const task = TaskDtoSchema.parse(detail); // drop the detail-only fields
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (board) => board && upsertTask(board, task),
      );
      setTitle(''); // stay open for the next card
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
        className="rounded-lg px-3 py-2 text-left text-button font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <span aria-hidden="true">+ </span>
        {t('tasks.board.addTask')}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={title}
        maxLength={200}
        aria-label={t('tasks.board.taskTitle')}
        aria-invalid={failed || undefined}
        placeholder={t('tasks.board.taskTitle')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => !title.trim() && close()}
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
