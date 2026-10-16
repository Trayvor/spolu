import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GroupMode, NotificationModes } from '@spolu/shared';
import { notificationModesQuery } from './api';
import { ModeMenu, useModeTitle } from './mode-menu';
import { useDefaultMode } from './use-modes';

/** The one mode every listed group has, or 'mixed' when they differ. */
export function allGroupsValue(groupIds: string[], modes: NotificationModes): GroupMode | 'mixed' {
  const base = modes.defaultMode ?? modes.roleDefault;
  const seen = new Set(groupIds.map((id) => modes.overrides[id] ?? base));
  if (seen.size > 1) return 'mixed';
  return [...seen][0] ?? base;
}

/** "All groups: <mode>": sets the default and clears every override. */
export function AllGroupsMode({ groupIds }: { groupIds: string[] }) {
  const { t } = useTranslation();
  const title = useModeTitle();
  const { data: modes } = useQuery(notificationModesQuery);
  const { setMode, isError, clearError } = useDefaultMode();
  if (!modes) return null;
  const value = allGroupsValue(groupIds, modes);
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-1 text-button text-muted-foreground">
      <span aria-hidden="true">{t('notifications.mode.allGroups')}</span>
      <ModeMenu
        value={value}
        onChange={setMode}
        triggerLabel={`${t('notifications.mode.allGroups')} ${title(value)}`}
        showText
        onOpen={clearError}
      />
      {isError && (
        <p role="alert" className="w-full text-right text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
