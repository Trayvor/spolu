import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { plainExcerpt, type GroupPerson, type TaskPerson } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileChip } from '@/features/files/file-chip';
import { EditIcon } from '@/features/chat/icons';
import { isOverdue } from '@/features/tasks/dates';
import { TaskCardMeta } from '@/features/tasks/task-card';
import { cn } from '@/lib/utils';
import type { ReviewCard } from './review-model';

/** The summary shows at most this much of the description (two lines are clamped by CSS). */
const DESCRIPTION_EXCERPT = 400;

const CheckIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
);

/** The title as shown and as the card's accessible name. */
export function useCardTitle(card: ReviewCard): string {
  const { t } = useTranslation();
  return card.draft.title.trim() || t('taskSplit.untitled');
}

/**
 * Reject and Approve, 44 px pills. Approve is a toggle (`aria-pressed`): pressed it fills with
 * the success green, the one color that marks a decided card.
 */
export function DecisionButtons({
  card,
  onApprove,
  onReject,
}: {
  card: ReviewCard;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const approved = card.decision === 'approved';
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="lg" className="px-4" aria-pressed={false} onClick={onReject}>
        {t('taskSplit.reject')}
      </Button>
      <Button
        variant="outline"
        size="lg"
        aria-pressed={approved}
        onClick={onApprove}
        className={cn(
          'px-4',
          approved && 'border-success bg-success text-primary-foreground hover:bg-success/90',
        )}
      >
        {approved && <CheckIcon />}
        {t('taskSplit.approve')}
      </Button>
    </div>
  );
}

/**
 * One proposed card in the list. Compact by default (urgent pill, title, two lines of
 * description, the board card's meta row, file chips, Reject / Approve); `expanded` replaces the
 * summary with the card's form in place (desktop); a rejected card is one struck-through line
 * with Undo. A new `focusSignal` (any change but 0) moves the focus into the card: its Undo, or
 * its summary after Undo or Done.
 */
export function ReviewCardView({
  card,
  people,
  today,
  expanded,
  focusSignal = 0,
  onOpen,
  onCollapse,
  onApprove,
  onReject,
  onUndo,
}: {
  card: ReviewCard;
  people: GroupPerson[] | undefined;
  today: string;
  /** The card's form, when it is open in place. */
  expanded?: ReactNode;
  focusSignal?: number;
  onOpen: () => void;
  onCollapse: () => void;
  onApprove: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const title = useCardTitle(card);
  const target = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusSignal) target.current?.focus();
  }, [focusSignal]);

  if (card.decision === 'rejected') {
    return (
      <article
        aria-labelledby={titleId}
        className="flex min-h-14 items-center gap-3 rounded-lg border-2 border-dashed border-surface-3 py-1 pr-1 pl-4"
      >
        <span
          id={titleId}
          className="min-w-0 flex-1 truncate text-button text-muted-foreground line-through"
        >
          {title}
        </span>
        <span className="sr-only">{t('taskSplit.rejected')}</span>
        <Button ref={target} variant="ghost" size="lg" className="px-4" onClick={onUndo}>
          {t('taskSplit.undo')}
        </Button>
      </article>
    );
  }

  const approved = card.decision === 'approved';
  // A decided card carries a 4 px success edge, so the list reads at a glance.
  const edge = approved && 'shadow-[inset_4px_0_0_var(--color-success)]';

  if (expanded) {
    return (
      <article
        aria-label={title}
        className={cn('rounded-xl bg-card p-4 ring-2 ring-foreground', edge)}
      >
        {expanded}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t-2 border-border pt-4">
          <Button variant="secondary" size="lg" className="px-5" onClick={onCollapse}>
            {t('taskSplit.done')}
          </Button>
          <DecisionButtons card={card} onApprove={onApprove} onReject={onReject} />
        </div>
      </article>
    );
  }

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const assignees: TaskPerson[] = card.draft.assigneeIds
    .map((id) => byId.get(id))
    .filter((p): p is GroupPerson => p !== undefined)
    .map(({ id, name }) => ({ id, name }));
  const nameOf = (id: string) => byId.get(id)?.name;
  const description = plainExcerpt(
    card.draft.description,
    nameOf,
    DESCRIPTION_EXCERPT,
    t('chat.mention.all'),
  );
  const hasMeta = assignees.length > 0 || card.draft.dueDate !== null;
  const files = card.files.filter((f) => card.draft.fileIds.includes(f.id));

  return (
    <article aria-labelledby={titleId} className={cn('rounded-xl bg-card', edge)}>
      <button
        ref={target}
        type="button"
        aria-label={t('taskSplit.open', { title })}
        onClick={onOpen}
        className="group flex w-full flex-col items-start gap-1.5 rounded-lg px-4 pt-3 text-left"
      >
        {card.draft.urgent && <Badge variant="destructive">{t('tasks.card.urgent')}</Badge>}
        <span className="flex w-full items-start gap-2">
          <span
            id={titleId}
            className="line-clamp-3 min-w-0 flex-1 break-words text-button font-semibold group-hover:underline group-hover:underline-offset-4"
          >
            {title}
          </span>
          <span className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground">
            <EditIcon />
          </span>
        </span>
        {description && (
          <span className="line-clamp-2 break-words text-tiny text-muted-foreground">
            {description}
          </span>
        )}
      </button>
      {(hasMeta || files.length > 0) && (
        <div className="flex flex-col gap-2 px-4 pt-2">
          {hasMeta && (
            <TaskCardMeta
              assignees={assignees}
              dueDate={card.draft.dueDate}
              overdue={isOverdue(card.draft.dueDate, 'todo', today)}
              fileCount={0}
            />
          )}
          {files.length > 0 && (
            <ul role="list" className="flex flex-wrap gap-2">
              {files.map((file) => (
                <li key={file.id} className="min-w-0 max-w-full">
                  <FileChip file={file} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-end px-2 pt-1 pb-2">
        <DecisionButtons card={card} onApprove={onApprove} onReject={onReject} />
      </div>
    </article>
  );
}
