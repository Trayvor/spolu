import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { homeKeys, sidebarQuery } from './api';
import { ClientSidebarList } from './client-sidebar';
import { readCollapsed, writeCollapsed } from './sidebar-collapse';
import { useAdminActivityRefetch } from './use-admin-activity';

// The lazy `admin-shell` chunk: loaded by the signed-in layout only for admins from 1024 px.

const SIDEBAR_KEYS = [homeKeys.sidebar] as const;

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

/** The loading rows: static grey bars (no shimmer). */
export function SidebarRowsPlaceholder({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-2">
          <span className="size-6 rounded-md bg-secondary" />
          <span className="h-3 flex-1 rounded-full bg-secondary" />
        </div>
      ))}
    </div>
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
  return (
    <aside
      className={cn(
        'sticky top-4 flex max-h-[calc(100dvh-2rem)] shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-xl bg-card p-2',
        collapsed ? 'w-14' : 'w-[232px]',
      )}
    >
      {children}
    </aside>
  );
}

/**
 * The admin's client sidebar beside every signed-in screen from 1024 px: the clients in the
 * server's order with their unread (black) and assigned-to-me (yellow) counts, live through
 * `admin:activity` and `chat:read`. It collapses to a 56 px rail of logos, remembered per device.
 */
export function AdminSidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { groupId } = useParams({ strict: false });
  const sidebar = useQuery(sidebarQuery);
  useAdminActivityRefetch(SIDEBAR_KEYS);

  const toggle = () => {
    setCollapsed((was) => {
      writeCollapsed(!was);
      return !was;
    });
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
