import { useTranslation } from 'react-i18next';
import type { GroupManager } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { cn } from '@/lib/utils';

const MAX_AVATARS = 3;
/** Phones (under 641px) have room for one avatar less on the row's second line. */
const MAX_AVATARS_PHONE = 2;

/**
 * Up to 3 overlapping 24px avatars of a group's managers (2 on phones), then "+N". The avatars
 * and the count are decorative; screen readers get the names in a visually hidden list.
 * Nothing when empty.
 */
export function ManagerAvatars({
  managers,
  groupName,
}: {
  managers: GroupManager[];
  groupName: string;
}) {
  const { t } = useTranslation();
  if (managers.length === 0) return null;
  const shown = managers.slice(0, MAX_AVATARS);
  const extra = managers.length - shown.length;
  const extraPhone = Math.max(managers.length - MAX_AVATARS_PHONE, 0);
  return (
    <div data-manager-avatars="" className="flex shrink-0 items-center">
      <span aria-hidden="true" className="flex items-center">
        {shown.map((manager, index) => (
          <Avatar
            key={manager.id}
            userId={manager.id}
            name={manager.name}
            size={24}
            className={cn(
              '-ml-1.5 border-2 border-card first:ml-0',
              index >= MAX_AVATARS_PHONE && 'max-[640px]:hidden',
            )}
          />
        ))}
      </span>
      {extraPhone > 0 && (
        <span
          aria-hidden="true"
          className="ml-1 text-micro font-semibold text-muted-foreground min-[641px]:hidden"
        >
          {t('groups.managers.more', { count: extraPhone })}
        </span>
      )}
      {extra > 0 && (
        <span
          aria-hidden="true"
          className="ml-1 text-micro font-semibold text-muted-foreground max-[640px]:hidden"
        >
          {t('groups.managers.more', { count: extra })}
        </span>
      )}
      <ul aria-label={t('groups.managers.listLabel', { name: groupName })} className="sr-only">
        {managers.map((manager) => (
          <li key={manager.id}>{manager.name}</li>
        ))}
      </ul>
    </div>
  );
}
