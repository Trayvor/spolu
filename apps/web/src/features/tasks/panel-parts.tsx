import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { bucketTitle, byPosition } from './board-model';
import { BackIcon } from './icons';

/**
 * The panel frame shared by the detail and the create mode: 560 px on the right from 1024 px,
 * full screen below. Escape closes (through the router, so the detail's unsaved-changes guard
 * still asks); closing hands the focus back to the card `taskId`, or to the board.
 */
export function PanelShell({
  groupId,
  taskId,
  children,
}: {
  groupId: string;
  taskId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const panel = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    return () => {
      if (!element?.contains(document.activeElement)) return;
      const card =
        taskId && document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"] a`);
      const board = document.querySelector<HTMLElement>('[data-bucket-id]')?.parentElement;
      if (card) card.focus();
      else if (board) {
        board.tabIndex = -1;
        board.focus();
      }
    };
  }, [taskId]);

  // Below 1024 px the panel covers the screen: the page behind must not scroll under a finger.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Open menus and lists handle their own Escape.
  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      target.closest('[role="menu"],[role="listbox"]') ||
      target.getAttribute('aria-expanded') === 'true'
    )
      return;
    void navigate({ to: '/groups/$groupId/tasks', params: { groupId } });
  }

  return (
    <aside
      ref={panel}
      onKeyDown={onKeyDown}
      aria-label={t('tasks.panel.label')}
      data-testid="task-panel"
      className={cn(
        'fixed inset-0 z-40 flex flex-col bg-background lg:left-auto lg:w-[560px] lg:border-l-2 lg:border-border',
        // Phones: every control in the sheet is at least 44 px to tap, except those that carry
        // their own larger hit area (`data-hit`). The formatting toolbar drops its gaps so its
        // eight 44 px buttons fit one line at 390 px, and wraps on narrower screens.
        'max-[640px]:[&_:is(button,a,select,input):not([data-hit])]:min-h-11 max-[640px]:[&_:is(button,a,select):not([data-hit])]:min-w-11 max-[640px]:[&_[role=toolbar]]:flex-wrap max-[640px]:[&_[role=toolbar]]:gap-0 max-[640px]:[&_[role=toolbar]]:px-0',
      )}
    >
      {children}
    </aside>
  );
}

/** The panel's top bar: "Back to the board" on phones, "Close" from 1024 px, then `children`. */
export function PanelHeader({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-2 border-b-2 border-border px-3 py-2 min-[641px]:px-4 min-[641px]:py-3">
      {/* Phones: a back arrow only (the label stays for screen readers), so the bucket select fits. */}
      <Button
        variant="ghost"
        onClick={onClose}
        className="lg:hidden max-[640px]:size-11 max-[640px]:px-0"
      >
        <BackIcon />
        <span className="max-[640px]:sr-only">{t('tasks.panel.back')}</span>
      </Button>
      <Button variant="ghost" onClick={onClose} className="max-lg:hidden">
        {t('tasks.panel.close')}
      </Button>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </header>
  );
}

/** The bucket a task is in (detail) or goes to (create), labelled "Bucket" for screen readers. */
export function BucketSelect({
  buckets,
  groupName,
  value,
  disabled,
  onChange,
}: {
  buckets: BucketDto[] | undefined;
  groupName: string;
  value: string;
  disabled: boolean;
  onChange: (bucketId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="task-bucket" className="sr-only">
        {t('tasks.panel.bucket')}
      </label>
      <Select
        id="task-bucket"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        // The header's height (38 px, like its buttons) instead of the field's 52 px; on phones it
        // takes the room the back arrow leaves.
        containerClassName="min-w-0 max-[640px]:flex-1"
        className="h-[38px] py-0 font-semibold min-[641px]:max-w-52"
      >
        {[...(buckets ?? [])].sort(byPosition).map((b) => (
          <option key={b.id} value={b.id}>
            {bucketTitle(t, b, groupName)}
          </option>
        ))}
      </Select>
    </>
  );
}

/** An inline bar above the form: a question or a warning with its actions. */
export function PanelNotice({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3">
      <p className="mr-auto text-button font-semibold">{text}</p>
      {children}
    </div>
  );
}
