import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { bucketTitle, byPosition } from './board-model';

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
      className="fixed inset-0 z-40 flex flex-col bg-background lg:left-auto lg:w-[560px] lg:border-l-2 lg:border-border"
    >
      {children}
    </aside>
  );
}

/** The panel's top bar: "Back to the board" on phones, "Close" from 1024 px, then `children`. */
export function PanelHeader({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-2 border-b-2 border-border px-4 py-3">
      <Button variant="ghost" onClick={onClose} className="lg:hidden">
        {t('tasks.panel.back')}
      </Button>
      <Button variant="ghost" onClick={onClose} className="max-lg:hidden">
        {t('tasks.panel.close')}
      </Button>
      <div className="ml-auto flex items-center gap-2">{children}</div>
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
      <select
        id="task-bucket"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-[38px] max-w-52 rounded-full border-2 border-input bg-card px-4 text-button font-semibold text-foreground focus:border-foreground"
      >
        {[...(buckets ?? [])].sort(byPosition).map((b) => (
          <option key={b.id} value={b.id}>
            {bucketTitle(t, b, groupName)}
          </option>
        ))}
      </select>
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
