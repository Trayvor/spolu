import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { sidebarQuery } from './api';
import { ClientSidebarList, SidebarRowsPlaceholder } from './client-sidebar';
import { useCollapsed, writeCollapsed } from './sidebar-collapse';
import { useSidebarLive } from './use-sidebar-live';

// The lazy `admin-shell` chunk: loaded by the signed-in layout only for admins from 1024 px.

function Chevron({ left }: { left: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={left ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** The frame the layout shows while the chunk loads: the same width, so nothing shifts. */
export function SidebarFrame({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  // `contain: size` keeps the sidebar out of the row's height: a long client list must never
  // make the row (and the chat card that fills it) taller than the window. The column still
  // stretches to the row, and the sidebar scrolls inside it.
  return (
    <div className={cn('shrink-0 [contain:size]', collapsed ? 'w-14' : 'w-[232px]')}>
      <aside className="sticky top-4 flex max-h-[min(100%,calc(100dvh-2rem))] flex-col gap-3 overflow-y-auto rounded-xl bg-card p-2">
        {children}
      </aside>
    </div>
  );
}

/**
 * The admin's client sidebar beside every signed-in screen from 1024 px: the clients in the
 * server's order with one black badge each (unread messages and the tasks and tickets with an unseen change), live through
 * `admin:activity` and `chat:read`, one patched row at a time (`useSidebarLive`). It collapses to a 56 px rail of logos, remembered per device.
 */
export function AdminSidebar() {
  const { t } = useTranslation();
  const collapsed = useCollapsed();
  const { groupId } = useParams({ strict: false });
  const sidebar = useQuery(sidebarQuery);
  // Ticket events too: the badge counts the tickets with an unseen change (2026-10-17). Only the
  // rows of the groups named by the events are refetched and patched in (2026-10-18).
  useSidebarLive();

  const toggle = () => {
    writeCollapsed(!collapsed);
  };

  return (
    <SidebarFrame collapsed={collapsed}>
      <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        {!collapsed && (
          <h2 className="px-2 text-button font-semibold">{t('adminHome.sidebar.title')}</h2>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'adminHome.sidebar.expand' : 'adminHome.sidebar.collapse')}
          onClick={toggle}
        >
          <Chevron left={!collapsed} />
        </Button>
      </div>
      {sidebar.isPending ? (
        <SidebarRowsPlaceholder />
      ) : sidebar.isError ? (
        collapsed ? null : (
          <div role="alert" className="flex flex-col items-start gap-2 px-2">
            <p className="text-micro text-muted-foreground">{t('adminHome.shell.loadError')}</p>
            <Button variant="secondary" size="sm" onClick={() => void sidebar.refetch()}>
              {t('adminHome.shell.retry')}
            </Button>
          </div>
        )
      ) : (
        <ClientSidebarList
          clients={sidebar.data}
          currentGroupId={groupId}
          rowHeight={40}
          collapsed={collapsed}
        />
      )}
    </SidebarFrame>
  );
}
