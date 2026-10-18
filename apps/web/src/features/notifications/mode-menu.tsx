import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupModes, type GroupMode } from '@spolu/shared';
import { Link } from '@tanstack/react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BellAtIcon, BellIcon, BellOffIcon } from './icons';
import { useGroupMode } from './use-modes';
import { ErrorBubble } from '@/components/ui/error-bubble';

const ICONS: Record<GroupMode | 'mixed', () => ReactNode> = {
  all: BellIcon,
  mentions: BellAtIcon,
  off: BellOffIcon,
  mixed: BellIcon,
};

const triggerClass = (withText: boolean) =>
  cn(
    "relative inline-flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-full after:absolute after:-inset-[3px] after:rounded-full after:content-[''] text-button font-medium text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-surface-3 hover:text-foreground data-[state=open]:bg-surface-3 data-[state=open]:text-foreground",
    withText && 'px-3',
  );

/** The title of a mode ("All messages"), or "Mixed". */
export function useModeTitle() {
  const { t } = useTranslation();
  return (value: GroupMode | 'mixed') => t(`notifications.mode.${value}`);
}

/**
 * A round bell button that opens the three modes. 38px like the user menu; with `showText` it
 * grows into a pill and names the mode. `'mixed'` is the bell with "Mixed" and no check.
 */
export function ModeMenu({
  value,
  onChange,
  triggerLabel,
  showText = false,
  onOpen,
  note,
  defaultOpen = false,
  settingsLink = false,
}: {
  value: GroupMode | 'mixed';
  onChange(mode: GroupMode): void;
  triggerLabel: string;
  showText?: boolean;
  onOpen?(): void;
  /** One muted line under the options (why the mode is what it is). */
  note?: string;
  /** Open on mount (the on-demand bell mounts the menu by its first click). */
  defaultOpen?: boolean;
  /** End with a link to every notification setting (`/settings/notifications`, UX review X7). */
  settingsLink?: boolean;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const title = useModeTitle();
  const Icon = ICONS[value];
  const withText = showText || value === 'mixed';
  return (
    <DropdownMenu defaultOpen={defaultOpen} onOpenChange={(open) => open && onOpen?.()}>
      <DropdownMenuTrigger aria-label={triggerLabel} className={triggerClass(withText)}>
        <Icon />
        {withText && <span>{title(value)}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(320px,calc(100vw-24px))]">
        <DropdownMenuRadioGroup
          value={value === 'mixed' ? '' : value}
          onValueChange={(mode) => onChange(mode as GroupMode)}
        >
          {GroupModes.map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              className="items-start"
              aria-labelledby={`${hintId}-${mode}-title`}
              aria-describedby={`${hintId}-${mode}`}
            >
              <span className="flex flex-col gap-0.5">
                <span id={`${hintId}-${mode}-title`}>{t(`notifications.mode.${mode}`)}</span>
                <span
                  id={`${hintId}-${mode}`}
                  className="text-micro font-normal text-muted-foreground"
                >
                  {t(`notifications.mode.${mode}Hint`)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {note && <p className="px-3 pt-2 pb-1 text-micro text-muted-foreground">{note}</p>}
        {settingsLink && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/notifications">{t('notifications.mode.allSettings')}</Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bell of one group: your mode there, and a menu to change it. Renders once modes load.
 * When the mode comes from managing the group, the menu says so under the options.
 */
export function GroupBell({
  groupId,
  className,
  defaultOpen,
}: {
  groupId: string;
  className?: string;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const title = useModeTitle();
  const { mode, managed, setMode, isError, clearError } = useGroupMode(groupId);
  if (!mode) return null;
  return (
    <div className={cn('relative flex shrink-0', className)}>
      <ModeMenu
        value={mode}
        onChange={setMode}
        triggerLabel={t('notifications.mode.bellLabel', { mode: title(mode) })}
        onOpen={clearError}
        note={managed ? t('notifications.mode.managerNote') : undefined}
        defaultOpen={defaultOpen}
        settingsLink
      />
      {isError && <ErrorBubble>{t('errors.generic')}</ErrorBubble>}
    </div>
  );
}

/**
 * A long list's bell (the groups page): until the first click a plain button that looks like the
 * bell, drawn from the mode the list computed once (`groupModeOf`); the click mounts the real
 * `GroupBell` (its queries, mutation and Radix menu), open at once, and it stays mounted. So a
 * list of thousands of groups does not mount a menu, a query and a mutation per row.
 */
export function GroupBellOnDemand({
  groupId,
  mode,
  className,
}: {
  groupId: string;
  mode: GroupMode | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const title = useModeTitle();
  const [armed, setArmed] = useState(false);
  if (armed) return <GroupBell groupId={groupId} className={className} defaultOpen />;
  if (!mode) return null;
  const Icon = ICONS[mode];
  return (
    <div className={cn('relative flex shrink-0', className)}>
      <button
        type="button"
        aria-label={t('notifications.mode.bellLabel', { mode: title(mode) })}
        aria-haspopup="menu"
        aria-expanded={false}
        className={triggerClass(false)}
        onClick={() => setArmed(true)}
      >
        <Icon />
      </button>
    </div>
  );
}
