import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { BucketDto } from '@spolu/shared';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { bucketTitle, byPosition } from './board-model';

/**
 * The panel frame shared by the detail and the create mode: 560 px on the right from 1024 px,
 * full screen below. Escape closes (through the router, so the detail's unsaved-changes guard
 * still asks); closing hands the focus back to the card `taskId`, or to the board.
 */
export function PanelShell({
  groupId,
  taskId,
  onExit,
  children,
}: {
  groupId: string;
  taskId?: string;
  /** Closes the panel instead of going to the group's board (the global board, Phase 20). */
  onExit?: (opts: { replace: boolean }) => void;
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
  useScrollLock(true, '(max-width: 1023px)');

  // Open menus, lists and dialogs handle their own Escape; so do layers in a portal (React
  // bubbles their keys through the panel), such as the chat's action sheet.
  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      !panel.current?.contains(target) ||
      target.closest('[role="menu"],[role="listbox"],[role="dialog"]') ||
      target.getAttribute('aria-expanded') === 'true'
    )
      return;
    if (onExit) onExit({ replace: false });
    else void navigate({ to: '/groups/$groupId/tasks', params: { groupId } });
  }

  return (
    <aside
      ref={panel}
      onKeyDown={onKeyDown}
      aria-label={t('tasks.panel.label')}
      data-testid="task-panel"
      className={cn(
        // Full screen under 1024 px: it rises in and its top clears the notch; from 1024 px a
        // column on the right that fades in.
        'fixed inset-0 z-40 flex flex-col bg-background max-lg:animate-sheet-in max-lg:pt-[env(safe-area-inset-top)] lg:left-auto lg:w-[560px] lg:animate-fade-in lg:border-l-2 lg:border-border',
        // Phones: every control in the sheet is at least 44 px to tap, except those that carry
        // their own larger hit area (`data-hit`) and the task chat (`data-own-touch`), which is
        // sized for phones already, like the group chat. The formatting toolbar drops its gaps so
        // its eight 44 px buttons fit one line at 390 px, and wraps on narrower screens.
        'max-[640px]:[&_:is(button,a,select,input:not([type=checkbox],[type=radio])):not([data-hit],[data-own-touch]_*)]:min-h-11 max-[640px]:[&_:is(button,a,select):not([data-hit],[data-own-touch]_*)]:min-w-11 max-[640px]:[&_[role=toolbar]:not([data-own-touch]_*)]:flex-wrap max-[640px]:[&_[role=toolbar]:not([data-own-touch]_*)]:gap-0 max-[640px]:[&_[role=toolbar]:not([data-own-touch]_*)]:px-0',
      )}
    >
      {children}
    </aside>
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

export { PanelNotice } from '@/components/ui/panel-notice';

export type PanelTab = 'details' | 'chat';
const PANEL_TABS: PanelTab[] = ['details', 'chat'];

/** The id of a tab's button and of its panel, for `aria-controls` / `aria-labelledby`. */
export const panelTabIds = (tab: PanelTab) => ({
  tab: `task-panel-tab-${tab}`,
  panel: `task-panel-${tab}`,
});

/**
 * "Details" and "Chat (N)" under the task title: underlined tabs on the panel's 2px rule (the
 * group's pills name pages; these switch views inside one panel). Arrow keys, Home and End move
 * between them and select at once (automatic activation; both views are cheap to show).
 */
export function PanelTabs({
  tab,
  chatCount,
  onChange,
}: {
  tab: PanelTab;
  chatCount: number;
  onChange: (tab: PanelTab) => void;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = PANEL_TABS.indexOf(tab);
    const last = PANEL_TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = PANEL_TABS[next]!;
    onChange(target);
    list.current?.querySelector<HTMLElement>(`#${panelTabIds(target).tab}`)?.focus();
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t('tasks.panel.tabs.label')}
      onKeyDown={onKeyDown}
      className="flex shrink-0 gap-6 border-b-2 border-border px-4 min-[641px]:px-6"
    >
      {PANEL_TABS.map((key) => {
        const selected = key === tab;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={panelTabIds(key).tab}
            aria-selected={selected}
            aria-controls={panelTabIds(key).panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(key)}
            className={cn(
              // Sits on the list's 2px rule, so the selected tab's ink line replaces it.
              '-mb-0.5 h-10 border-b-2 text-button font-semibold tabular-nums max-[640px]:h-11',
              selected
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {key === 'chat'
              ? t('tasks.panel.tabs.chat', { count: chatCount })
              : t('tasks.panel.tabs.details')}
          </button>
        );
      })}
    </div>
  );
}
