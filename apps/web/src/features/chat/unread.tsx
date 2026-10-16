import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { chatUnreadQuery } from './api';

// Imported eagerly by the group layout and the groups list: keep it to `api.ts` and tiny.

/**
 * An unread count as a small ink pill (`99+` above 99), nothing at 0. Inside the active (ink)
 * group tab it turns white, so it stays visible. `label` replaces the default screen-reader text.
 */
export function UnreadPill({ count, label }: { count: number; label?: string }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-nano font-semibold text-primary-foreground tabular-nums in-data-[status=active]:bg-primary-foreground in-data-[status=active]:text-primary">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label ?? t('chat.unread', { count })}</span>
    </span>
  );
}

/** The groups list: one group's unread count (read once per visit of the list). */
export function GroupUnreadCount({ groupId }: { groupId: string }) {
  const { data } = useQuery(chatUnreadQuery);
  return <UnreadPill count={data?.[groupId] ?? 0} />;
}
