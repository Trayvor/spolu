import type { ReactNode } from 'react';
import { ClientFilter } from '@/components/client-filter';
import type { ClientDirectory } from '../client-tag';

/**
 * Phase 34 part D: the admin group's picker searches every client. `clients` null is every client
 * (the default), else the chosen group ids; one choice shared by the three tabs.
 */
export type CrossClient = {
  directory: ClientDirectory;
  clients: string[] | null;
  setClients: (next: string[] | null) => void;
};

/**
 * The client filter at the top of a tab: "eGrant tím", then the viewer's clients with the manager
 * dot, then the others; `withoutAdminGroup` leaves "eGrant tím" out (tickets cannot be there).
 * Choosing every client is the same as the default, so it gives null. `children` sit in the bar.
 */
export function ClientBar({
  cross,
  withoutAdminGroup = false,
  disabled = false,
  children,
}: {
  cross: CrossClient;
  withoutAdminGroup?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const options = withoutAdminGroup
    ? cross.directory.options.filter((o) => !o.internal)
    : cross.directory.options;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="attach-client-filter">
      <ClientFilter
        groups={options}
        managedIds={cross.directory.managedIds}
        value={cross.clients}
        defaultAll
        disabled={disabled}
        onChange={(next) =>
          cross.setClients(next === null || options.every((o) => next.includes(o.id)) ? null : next)
        }
      />
      {children}
    </div>
  );
}
