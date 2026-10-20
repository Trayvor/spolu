import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * A small "×" at the left of an unsaved-changes prompt: it only dismisses the prompt and returns
 * to editing. Labelled "Close" (`forms.panel.close`, the `forms` namespace must be loaded).
 * Escape on it does the same.
 */
export function DismissButton({
  onDismiss,
  autoFocus,
}: {
  onDismiss: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('forms.panel.close')}
      onClick={onDismiss}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDismiss();
      }}
      autoFocus={autoFocus}
      className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent touch:size-11"
    >
      <Icon>
        <path d="M18 6 6 18M6 6l12 12" />
      </Icon>
    </button>
  );
}

/**
 * An inline bar above the form: a question or a warning with its actions. With `onDismiss`, a
 * "Close" × at the left puts the question away.
 */
export function PanelNotice({
  text,
  children,
  onDismiss,
}: {
  text: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3',
        onDismiss && 'pl-2',
      )}
    >
      {onDismiss && <DismissButton onDismiss={onDismiss} autoFocus />}
      <p className="mr-auto text-button font-semibold">{text}</p>
      {children}
    </div>
  );
}
