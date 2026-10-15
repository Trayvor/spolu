import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * The round "done" control left of a task title: an empty ring, or a filled `success` circle
 * with a white check when the task is in Completed. Its name says what a press does. The
 * 18 px circle has a 44 px hit area (`before:`), so it is easy to tap on a card.
 */
export function DoneCircle({
  done,
  onToggle,
  disabled,
  className,
  inert,
}: {
  done: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  className?: string;
  /** A picture only (the lifted copy of a dragged card): not focusable, not announced. */
  inert?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={inert ? undefined : t(done ? 'tasks.card.markNotDone' : 'tasks.card.markDone')}
      aria-hidden={inert || undefined}
      tabIndex={inert ? -1 : undefined}
      title={inert ? undefined : t(done ? 'tasks.card.markNotDone' : 'tasks.card.markDone')}
      data-checked={done}
      data-hit
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 before:absolute before:-inset-[13px] before:content-['']",
        done
          ? 'border-success bg-success text-primary-foreground'
          : 'border-input bg-card text-transparent hover:border-foreground hover:text-foreground',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}
