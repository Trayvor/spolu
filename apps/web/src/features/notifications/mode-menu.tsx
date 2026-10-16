import '@/i18n/notifications-copy';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupModes, type GroupMode } from '@spolu/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BellAtIcon, BellIcon, BellOffIcon } from './icons';
import { useGroupMode } from './use-modes';

const ICONS: Record<GroupMode | 'mixed', () => ReactNode> = {
  all: BellIcon,
  mentions: BellAtIcon,
  off: BellOffIcon,
  mixed: BellIcon,
};

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
}: {
  value: GroupMode | 'mixed';
  onChange(mode: GroupMode): void;
  triggerLabel: string;
  showText?: boolean;
  onOpen?(): void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const title = useModeTitle();
  const Icon = ICONS[value];
  const withText = showText || value === 'mixed';
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpen?.()}>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        className={cn(
          'inline-flex h-[38px] min-w-[38px] shrink-0 items-center justify-center gap-2 rounded-full text-button font-medium text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-surface-3 hover:text-foreground data-[state=open]:bg-surface-3 data-[state=open]:text-foreground',
          withText && 'px-3',
        )}
      >
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The bell of one group: your mode there, and a menu to change it. Renders once modes load. */
export function GroupBell({ groupId, className }: { groupId: string; className?: string }) {
  const { t } = useTranslation();
  const title = useModeTitle();
  const { mode, setMode, isError, clearError } = useGroupMode(groupId);
  if (!mode) return null;
  return (
    <div className={cn('relative flex shrink-0', className)}>
      <ModeMenu
        value={mode}
        onChange={setMode}
        triggerLabel={t('notifications.mode.bellLabel', { mode: title(mode) })}
        onOpen={clearError}
      />
      {isError && (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-2 w-max max-w-[240px] rounded-lg bg-card p-3 text-micro text-error-ink shadow-lift"
        >
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
